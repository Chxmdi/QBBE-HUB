-- Workspace OS forms, part 2 (V1-6, wave 1 unit U11): conditional fields,
-- file answers and created records.
--
--   * A property may carry `showIf` {key, op, value}: the question is asked
--     only while an EARLIER question's answer meets the condition. Hidden
--     questions are skipped on the server too: their answers are dropped and
--     they are never required, whatever the browser sent.
--   * A `file` property takes a document id. The file must be a library
--     document (public.document, kind 'file') the submitter uploaded; it keeps
--     the library's virus scan, so nothing opens before the scan passes.
--   * A response to a form of any type other than `task` now creates a
--     record: an object row of that type in the registry (public.object,
--     written here with definer rights because nothing writes it through the
--     API) plus a property_value row for every answered question whose key
--     and kind match a custom property of the type. The type and its
--     properties are created from the form when the type does not exist yet.
--     Native types other than task (project, meeting, document ...) are not
--     created by forms: their rows live in their own tables and screens, so a
--     new form cannot use one of their keys. A form already published with
--     one keeps answering as before (the response is its own record).
--   * form_v2_response records what was created (created_object_type and
--     created_object_id) so the responses screen can link to it.
--
-- Everything is checked again in app.form_v2_properties_problem and
-- app.form_v2_answers_normalized, which the app mirrors in
-- src/features/forms-v2/properties.ts. Still behind the wos_forms_v2 switch.

alter table public.form_v2_response
  add column created_object_type text,
  add column created_object_id uuid;

comment on column public.form_v2_response.created_object_id is
  'The record this response created: a task id, or an object id for any other type. Null for responses that created nothing.';

-- Tasks were already created; custom-type responses before this migration
-- created nothing (their object_id is the response id).
update public.form_v2_response
set created_object_type = 'task', created_object_id = object_id
where object_type = 'task';

-- ---------------------------------------------------------------------------
-- Property list checks, now with showIf
-- ---------------------------------------------------------------------------

create or replace function app.form_v2_properties_problem(p_type_key text, p_properties jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  p jsonb;
  v_keys text[] := '{}';
  v_kinds jsonb := '{}'::jsonb;
  v_key text;
  v_kind text;
  o jsonb;
  s jsonb;
  v_op text;
  v_ref_kind text;
  v_ref jsonb;
begin
  if jsonb_typeof(p_properties) <> 'array' then return 'Properties must be a list'; end if;
  if jsonb_array_length(p_properties) > 50 then return 'A form has at most 50 properties'; end if;
  for p in select value from jsonb_array_elements(p_properties) loop
    if jsonb_typeof(p) <> 'object' then return 'Each property must be an object'; end if;
    if exists (select 1 from jsonb_object_keys(p) k
               where k not in ('key', 'kind', 'label', 'required', 'options', 'showIf')) then
      return 'Unknown property setting';
    end if;
    v_key := p->>'key';
    if jsonb_typeof(p->'key') is distinct from 'string' or v_key !~ '^[a-z][a-z0-9_]{0,39}$' then
      return 'Property keys are lower-case letters, digits and underscores';
    end if;
    if v_key = any (v_keys) then return format('Property %s is used twice', v_key); end if;
    if jsonb_typeof(p->'label') is distinct from 'object'
       or char_length(btrim(coalesce(p->'label'->>'en', ''))) not between 1 and 200
       or char_length(btrim(coalesce(p->'label'->>'fr', ''))) not between 1 and 200 then
      return 'Every property needs an English and a French label';
    end if;
    if jsonb_typeof(p->'required') is distinct from 'boolean' then
      return 'Every property says whether it is required';
    end if;
    v_kind := p->>'kind';
    if v_kind is null or v_kind not in
       ('text', 'number', 'currency', 'date', 'select', 'checkbox', 'url', 'email', 'file') then
      return 'Unknown property kind';
    end if;
    if p_type_key = 'task' and app.form_v2_task_property_kind(v_key) is distinct from v_kind then
      return format('Tasks have no %s property of that kind', v_key);
    end if;
    if v_kind = 'select' then
      if jsonb_typeof(p->'options') is distinct from 'array'
         or jsonb_array_length(p->'options') not between 1 and 50 then
        return 'A select property needs 1 to 50 options';
      end if;
      for o in select value from jsonb_array_elements(p->'options') loop
        if jsonb_typeof(o) <> 'object'
           or coalesce(o->>'key', '') !~ '^[a-z0-9_]{1,40}$'
           or char_length(btrim(coalesce(o->'label'->>'en', ''))) not between 1 and 200
           or char_length(btrim(coalesce(o->'label'->>'fr', ''))) not between 1 and 200 then
          return 'Each option needs a key and an English and a French label';
        end if;
      end loop;
      if (select count(distinct x->>'key') from jsonb_array_elements(p->'options') x)
         <> jsonb_array_length(p->'options') then
        return 'Option keys must differ';
      end if;
      if p_type_key = 'task' and exists (
        select 1 from jsonb_array_elements(p->'options') x
        where x->>'key' not in ('low', 'medium', 'high', 'critical')) then
        return 'Task priority options are low, medium, high and critical';
      end if;
    elsif p ? 'options' then
      return 'Only select properties have options';
    end if;

    -- showIf: {key, op, value?}, pointing at an earlier property.
    if p ? 'showIf' then
      s := p->'showIf';
      if jsonb_typeof(s) <> 'object' then return 'A condition must be an object'; end if;
      if exists (select 1 from jsonb_object_keys(s) k where k not in ('key', 'op', 'value')) then
        return 'Unknown condition setting';
      end if;
      if jsonb_typeof(s->'key') is distinct from 'string' or not ((s->>'key') = any (v_keys)) then
        return 'A condition can only depend on an earlier property';
      end if;
      if p_type_key = 'task' and v_key = 'title' then
        return 'The task title is always asked';
      end if;
      v_op := s->>'op';
      if v_op is null or v_op not in ('eq', 'neq', 'is_empty', 'is_not_empty', 'contains') then
        return 'Unknown condition';
      end if;
      v_ref_kind := v_kinds->>(s->>'key');
      if v_op in ('is_empty', 'is_not_empty') then
        if s ? 'value' and jsonb_typeof(s->'value') <> 'null' then
          return 'An emptiness condition has no value';
        end if;
      else
        if v_ref_kind = 'file' then
          return 'A file can only be checked for being present';
        end if;
        if coalesce(jsonb_typeof(s->'value'), 'missing') not in ('string', 'number', 'boolean')
           or (jsonb_typeof(s->'value') = 'string'
               and char_length(btrim(s->>'value')) not between 1 and 200) then
          return 'A condition needs a value';
        end if;
        if v_ref_kind = 'checkbox' and (v_op = 'contains' or jsonb_typeof(s->'value') <> 'boolean') then
          return 'A checkbox condition is ticked or not';
        end if;
        if v_ref_kind = 'select' and v_op in ('eq', 'neq') then
          select x.value into v_ref from jsonb_array_elements(p_properties) x where x.value->>'key' = s->>'key';
          if not exists (select 1 from jsonb_array_elements(v_ref->'options') x where x->>'key' = s->>'value') then
            return 'A choice condition must name one of the choices';
          end if;
        end if;
      end if;
    end if;

    v_keys := v_keys || v_key;
    v_kinds := v_kinds || jsonb_build_object(v_key, v_kind);
  end loop;
  if p_type_key = 'task' and not exists (
    select 1 from jsonb_array_elements(p_properties) x
    where x->>'key' = 'title' and (x->>'required')::boolean) then
    return 'A task form must ask for the title, as required';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Which properties are asked, given the answers so far
-- ---------------------------------------------------------------------------

-- Keys of the properties shown for these answers, in order. A property with
-- no showIf is shown; one with showIf is shown when the property it depends
-- on is itself shown and its answer meets the condition. "Empty" is missing,
-- null, blank text or an unticked box. Comparisons are on the text of the
-- answer, so a number compares as its digits and a choice as its key.
create or replace function app.form_v2_visible_keys(p_properties jsonb, p_answers jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  p jsonb;
  s jsonb;
  v_shown text[] := '{}';
  v_answer jsonb;
  v_text text;
  v_empty boolean;
  v_wanted text;
  v_ok boolean;
begin
  for p in select value from jsonb_array_elements(p_properties) loop
    s := p->'showIf';
    if s is null or jsonb_typeof(s) <> 'object' then
      v_shown := v_shown || (p->>'key');
      continue;
    end if;
    if not ((s->>'key') = any (v_shown)) then
      continue;
    end if;
    v_answer := p_answers->(s->>'key');
    v_text := case when v_answer is null or jsonb_typeof(v_answer) in ('null', 'object', 'array') then null
                   else btrim(v_answer #>> '{}') end;
    v_empty := v_text is null or v_text = '' or (jsonb_typeof(v_answer) = 'boolean' and v_answer = 'false'::jsonb);
    v_wanted := case when s ? 'value' and jsonb_typeof(s->'value') <> 'null' then s->'value' #>> '{}' end;
    v_ok := case s->>'op'
      when 'is_empty' then v_empty
      when 'is_not_empty' then not v_empty
      when 'eq' then not v_empty and v_text = v_wanted
      when 'neq' then v_empty or v_text is distinct from v_wanted
      when 'contains' then not v_empty and position(lower(coalesce(v_wanted, '')) in lower(v_text)) > 0
      else false
    end;
    if v_ok then
      v_shown := v_shown || (p->>'key');
    end if;
  end loop;
  return v_shown;
end;
$$;
revoke all on function app.form_v2_visible_keys(jsonb, jsonb) from public, anon;
grant execute on function app.form_v2_visible_keys(jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Answers: hidden properties skipped, files as document ids
-- ---------------------------------------------------------------------------

create or replace function app.form_v2_answers_normalized(p_properties jsonb, p_answers jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  p jsonb;
  v jsonb;
  v_key text;
  v_label text;
  v_kind text;
  v_out jsonb := '{}'::jsonb;
  v_date date;
  v_shown text[];
begin
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Answers must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_answers) k
    where not exists (select 1 from jsonb_array_elements(p_properties) x where x->>'key' = k)
  ) then
    raise exception 'An answer does not match any property on this form' using errcode = '22023';
  end if;
  v_shown := app.form_v2_visible_keys(p_properties, p_answers);
  for p in select value from jsonb_array_elements(p_properties) loop
    v_key := p->>'key';
    -- A hidden property is not asked: its answer is dropped and never required.
    if not (v_key = any (v_shown)) then
      continue;
    end if;
    v_label := p->'label'->>'en';
    v_kind := p->>'kind';
    v := p_answers->v_key;
    if v is null or jsonb_typeof(v) = 'null'
       or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if v_kind = 'checkbox' then
        v := 'false'::jsonb;
      elsif (p->>'required')::boolean then
        raise exception 'Answer required: %', v_label using errcode = '23514';
      else
        continue;
      end if;
    end if;
    case v_kind
      when 'text' then
        if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 5000 then
          raise exception 'Answer for % must be text of up to 5,000 characters', v_label using errcode = '22023';
        end if;
        v := to_jsonb(btrim(v #>> '{}'));
      when 'url' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~* '^https?://[^\s]{1,2000}$' then
          raise exception 'Answer for % must be a web address', v_label using errcode = '22023';
        end if;
      when 'email' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[^@\s]{1,200}@[^@\s]{1,200}\.[^@\s]{1,50}$' then
          raise exception 'Answer for % must be an email address', v_label using errcode = '22023';
        end if;
      when 'number' then
        if jsonb_typeof(v) <> 'number' or abs((v #>> '{}')::numeric) > 1e12 then
          raise exception 'Answer for % must be a number', v_label using errcode = '22023';
        end if;
      when 'currency' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]+$'
           or (v #>> '{}')::numeric > 100000000000 then
          raise exception 'Answer for % must be an amount in whole cents', v_label using errcode = '22023';
        end if;
      when 'date' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'Answer for % must be a date', v_label using errcode = '22023';
        end if;
        begin
          v_date := (v #>> '{}')::date;
        exception when others then
          raise exception 'Answer for % must be a date', v_label using errcode = '22023';
        end;
      when 'select' then
        if jsonb_typeof(v) <> 'string' or not exists (
          select 1 from jsonb_array_elements(p->'options') o where o->>'key' = v #>> '{}') then
          raise exception 'Answer for % must be one of its options', v_label using errcode = '22023';
        end if;
      when 'checkbox' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'Answer for % must be ticked or not', v_label using errcode = '22023';
        end if;
        if (p->>'required')::boolean and v = 'false'::jsonb then
          raise exception 'Answer required: %', v_label using errcode = '23514';
        end if;
      when 'file' then
        -- A document id; whose document it is, public.submit_form_v2 checks.
        if jsonb_typeof(v) <> 'string'
           or (v #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'Answer for % must be an uploaded file', v_label using errcode = '22023';
        end if;
        v := to_jsonb(lower(v #>> '{}'));
      else
        raise exception 'Answer for % cannot be given on this form', v_label using errcode = '22023';
    end case;
    v_out := v_out || jsonb_build_object(v_key, v);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- The type a form creates
-- ---------------------------------------------------------------------------

-- The object type for a form's type key, created from the form when it does
-- not exist yet, with a custom property for every form property the type
-- does not define. Refuses the native types (except task, handled apart):
-- their records are made in their own screens.
-- p_strict (when a form is opened) refuses a form whose question clashes with
-- an existing property of the type: same key, another kind, or archived. At
-- answer time the clash only means that answer is not copied to the record
-- (it stays in the response).
create or replace function app.form_v2_ensure_type(
  p_organization_id uuid, p_type_key text, p_properties jsonb, p_strict boolean default false
)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_type_id uuid;
  v_kind text;
  v_position integer;
  p jsonb;
  v_existing public.property_definition%rowtype;
begin
  if p_type_key = 'task' then
    raise exception 'Tasks are created through the task table' using errcode = '23514';
  end if;
  select t.id, t.kind into v_type_id, v_kind
  from public.object_type t
  where t.organization_id = p_organization_id and t.key = p_type_key;
  if v_kind = 'native' then
    raise exception 'A form cannot create % records; they are made in their own screens', p_type_key
      using errcode = '23514';
  end if;
  if v_type_id is null then
    -- Two first answers at once both get here; the second finds the first's.
    insert into public.object_type (organization_id, key, name_en, name_fr, kind, default_lens)
    values (p_organization_id, p_type_key,
      initcap(replace(p_type_key, '_', ' ')), initcap(replace(p_type_key, '_', ' ')),
      'custom', 'table')
    on conflict (organization_id, key) do nothing;
    select t.id into v_type_id from public.object_type t
    where t.organization_id = p_organization_id and t.key = p_type_key;
  end if;
  select coalesce(max(d.position), 0) into v_position
  from public.property_definition d where d.type_id = v_type_id;
  for p in select value from jsonb_array_elements(p_properties) loop
    select * into v_existing from public.property_definition d
    where d.type_id = v_type_id and d.key = p->>'key';
    if found then
      if p_strict and (v_existing.kind <> p->>'kind' or v_existing.archived_at is not null
                       or v_existing.system_column is not null) then
        raise exception 'The % type already has a % property that this question cannot fill',
          p_type_key, p->>'key' using errcode = '23514';
      end if;
    else
      v_position := v_position + 1;
      insert into public.property_definition
        (organization_id, type_id, key, name_en, name_fr, kind, options, position)
      values (p_organization_id, v_type_id, p->>'key',
        btrim(p->'label'->>'en'), btrim(p->'label'->>'fr'), p->>'kind',
        case when p->>'kind' = 'select' then jsonb_build_object('choices', (
          select jsonb_agg(jsonb_build_object('key', o->>'key', 'label', o->'label', 'color', null))
          from jsonb_array_elements(p->'options') o))
        else '{}'::jsonb end,
        v_position)
      on conflict (type_id, key) do nothing;
    end if;
  end loop;
  return v_type_id;
end;
$$;
revoke all on function app.form_v2_ensure_type(uuid, text, jsonb, boolean) from public, anon, authenticated;

-- A form may not borrow a native type's key (task aside). Opening a form
-- also makes sure its type exists, so the record type is there before the
-- first answer.
create or replace function app.protect_form_v2() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_problem text;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.published_at := null;
    if (select auth.uid()) is not null then
      new.created_by := (select auth.uid());
    end if;
    if coalesce(current_setting('app.forms_v2_converting', true), '') <> 'on'
       and (new.status <> 'draft' or new.legacy_form_id is not null) then
      raise exception 'A new form starts as a draft' using errcode = '42501';
    end if;
    if new.status <> 'draft' then
      new.published_at := now();
    end if;
  else
    if (new.organization_id, new.created_by, new.created_at, new.legacy_form_id)
       is distinct from (old.organization_id, old.created_by, old.created_at, old.legacy_form_id) then
      raise exception 'Form ownership is server managed' using errcode = '42501';
    end if;
    if old.status <> 'draft' then
      if (new.type_key, new.properties, new.audience, new.target_project_id)
         is distinct from (old.type_key, old.properties, old.audience, old.target_project_id) then
        raise exception 'A published form cannot be changed; make a new one' using errcode = '42501';
      end if;
      if new.status = 'draft' then
        raise exception 'A published form cannot go back to draft' using errcode = '42501';
      end if;
    end if;
    if old.status = 'draft' and new.status = 'published' then
      if jsonb_array_length(new.properties) = 0 then
        raise exception 'Add at least one property before publishing' using errcode = '23514';
      end if;
      new.published_at := now();
    elsif old.status = 'draft' and new.status = 'closed' then
      raise exception 'Publish a draft before closing it' using errcode = '23514';
    else
      new.published_at := old.published_at;
    end if;
  end if;
  if new.target_project_id is not null and not exists (
    select 1 from public.project p
    where p.id = new.target_project_id and p.organization_id = new.organization_id) then
    raise exception 'The project belongs to another organization' using errcode = '42501';
  end if;
  if new.type_key <> 'task' and (tg_op = 'INSERT' or new.type_key is distinct from old.type_key) and exists (
    select 1 from public.object_type t
    where t.organization_id = new.organization_id and t.key = new.type_key and t.kind = 'native') then
    raise exception 'A form cannot create % records; they are made in their own screens', new.type_key
      using errcode = '23514';
  end if;
  v_problem := app.form_v2_properties_problem(new.type_key, new.properties);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'published' and new.type_key <> 'task' then
    perform app.form_v2_ensure_type(new.organization_id, new.type_key, new.properties, true);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Answering: the record is created, and the response points at it
-- ---------------------------------------------------------------------------

create or replace function public.submit_form_v2(p_form_id uuid, p_answers jsonb)
returns table (response_id uuid, object_type text, object_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_form public.form_v2%rowtype;
  v_answers jsonb;
  v_uid uuid := (select auth.uid());
  v_response_id uuid := gen_random_uuid();
  v_object_id uuid;
  v_program_id uuid;
  v_type_id uuid;
  v_title text;
  p jsonb;
  v_key text;
  v_kind text;
  v_value jsonb;
  v_property_id uuid;
  v_type_kind text;
  v_created_type text;
  v_created_id uuid;
begin
  select * into v_form from public.form_v2 f where f.id = p_form_id;
  if not found or not app.can_answer_form_v2(v_form) then
    raise exception 'This form is not open to you' using errcode = '42501';
  end if;
  v_answers := app.form_v2_answers_normalized(v_form.properties, p_answers);

  -- A file answer is one of the submitter's own library documents.
  for p in select value from jsonb_array_elements(v_form.properties) x where x.value->>'kind' = 'file' loop
    v_key := p->>'key';
    if v_answers ? v_key and not exists (
      select 1 from public.document d
      where d.id = (v_answers->>v_key)::uuid
        and d.organization_id = v_form.organization_id
        and d.kind = 'file'
        and d.archived_at is null
        and d.created_by = v_uid) then
      raise exception 'The file for % is not one you uploaded', p->'label'->>'en'
        using errcode = '42501', detail = v_key;
    end if;
  end loop;

  if v_form.type_key = 'task' then
    if v_form.target_project_id is not null then
      select pr.program_id into v_program_id from public.project pr where pr.id = v_form.target_project_id;
    end if;
    insert into public.task (
      organization_id, program_id, project_id, title, description, priority,
      start_at, due_at, estimate_hours, requester_id, created_by
    ) values (
      v_form.organization_id, v_program_id, v_form.target_project_id,
      v_answers->>'title', v_answers->>'description',
      coalesce(v_answers->>'priority', 'medium')::public.task_priority,
      (v_answers->>'start')::date, (v_answers->>'due')::date,
      (v_answers->>'estimate')::numeric, v_uid, v_uid
    ) returning id into v_object_id;
  else
    select t.id, t.kind into v_type_id, v_type_kind from public.object_type t
    where t.organization_id = v_form.organization_id and t.key = v_form.type_key;
    -- Opening a form makes its type; one converted while already open is made
    -- by its first answer.
    if v_type_id is null then
      v_type_id := app.form_v2_ensure_type(v_form.organization_id, v_form.type_key, v_form.properties);
      v_type_kind := 'custom';
    end if;
  end if;

  if v_form.type_key = 'task' then
    v_created_type := 'task';
    v_created_id := v_object_id;
  elsif v_type_kind = 'native' then
    -- A form published with a native type's key before this migration:
    -- answered as before, the response is its own record.
    v_object_id := v_response_id;
  else
    -- The record's title: the first text answer, else the form's title.
    select btrim(v_answers->>(x.value->>'key')) into v_title
    from jsonb_array_elements(v_form.properties) x
    where x.value->>'kind' = 'text' and coalesce(btrim(v_answers->>(x.value->>'key')), '') <> ''
    limit 1;
    v_title := left(coalesce(v_title, v_form.title_en || ' · ' || to_char(now(), 'YYYY-MM-DD')), 200);
    -- The submitter owns the record they made (the owner grant lets them see it).
    insert into public.object (organization_id, type_id, title, owner_id, created_by, updated_by)
    values (v_form.organization_id, v_type_id, v_title, v_uid, v_uid, v_uid)
    returning id into v_object_id;
    -- Every answered question that matches a custom property of the type.
    for p in select value from jsonb_array_elements(v_form.properties) loop
      v_key := p->>'key';
      v_kind := p->>'kind';
      v_value := v_answers->v_key;
      if v_value is null then continue; end if;
      select d.id into v_property_id
      from public.property_definition d
      where d.type_id = v_type_id and d.key = v_key and d.kind = v_kind
        and d.system_column is null and d.archived_at is null;
      if v_property_id is null then continue; end if;
      insert into public.property_value (object_id, property_id, organization_id,
        value_text, value_number, value_date, value_bool, value_uuids)
      values (v_object_id, v_property_id, v_form.organization_id,
        case when v_kind in ('text', 'url', 'email', 'select') then v_value #>> '{}' end,
        case when v_kind in ('number', 'currency') then (v_value #>> '{}')::numeric end,
        case when v_kind = 'date' then (v_value #>> '{}')::date end,
        case when v_kind = 'checkbox' then (v_value #>> '{}')::boolean end,
        case when v_kind = 'file' then array[(v_value #>> '{}')::uuid] end);
    end loop;
    v_created_type := v_form.type_key;
    v_created_id := v_object_id;
  end if;

  insert into public.form_v2_response (
    id, organization_id, form_id, submitted_by, answers, object_type, object_id,
    created_object_type, created_object_id)
  values (
    v_response_id, v_form.organization_id, v_form.id, v_uid, v_answers, v_form.type_key, v_object_id,
    v_created_type, v_created_id);

  return query select v_response_id, v_form.type_key, v_object_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- A form's file is private to its uploader and the response's readers
-- ---------------------------------------------------------------------------

-- Members register library files as organization-wide (the only visibility
-- the document insert policy lets them use); a form's file is then narrowed
-- to staff visibility with nothing attached, which app.can_read_document
-- opens only to its creator, owners, admins and leadership viewers: the
-- people who read the response. Only the uploader may narrow their file.
create or replace function public.form_v2_keep_file_private(p_document_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.document d
  set visibility = 'staff'
  where d.id = p_document_id
    and d.created_by = (select auth.uid())
    and d.kind = 'file'
    and d.project_id is null and d.program_id is null and d.meeting_id is null
    and d.event_id is null and d.crm_organization_id is null;
  if not found then
    raise exception 'Only the uploader can keep a form file private' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.form_v2_keep_file_private(uuid) from public, anon;
grant execute on function public.form_v2_keep_file_private(uuid) to authenticated, service_role;
