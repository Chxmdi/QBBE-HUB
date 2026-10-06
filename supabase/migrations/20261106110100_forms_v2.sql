-- Workspace OS forms for any type (V1-6, stream S6b, epic #199).
--
-- A form exposes chosen properties of one object type. Each response creates
-- an object of that type:
--   * `task` (native): a task row, through the task table, so every existing
--     task trigger and rule still runs. The submitter is its requester.
--   * any other type key: until the object registry (M1) lands, the response
--     row itself is the object (object_id = response id). Integration moves
--     these into `object` when M1 merges (see the PR's "Contract additions").
--
-- The existing forms (#145, form_definition / form_submission) are untouched.
-- Their definitions and submissions can be copied into this model with
-- public.forms_v2_convert_legacy and the copy removed again with
-- public.forms_v2_revert_legacy, so the conversion is reversible and nothing
-- the old screens read ever changes.
--
-- Access, mirroring form_definition:
--   * owners and admins (with MFA, through app.is_org_admin) build forms;
--   * the audience (members, or staff only) reads published forms;
--   * a person reads their own responses; admins read every response;
--   * responses are written only by public.submit_form_v2, never directly.
--
-- Hidden behind the wos_forms_v2 switch in the app.

create table public.form_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  type_key text not null check (type_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  target_project_id uuid references public.project (id) on delete set null,
  title_en text not null check (char_length(btrim(title_en)) between 1 and 200),
  title_fr text not null check (char_length(btrim(title_fr)) between 1 and 200),
  description_en text check (description_en is null or char_length(description_en) <= 2000),
  description_fr text check (description_fr is null or char_length(description_fr) <= 2000),
  audience text not null default 'members' check (audience in ('staff', 'members')),
  properties jsonb not null default '[]'::jsonb check (jsonb_typeof(properties) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  legacy_form_id uuid unique references public.form_definition (id) on delete set null,
  created_by uuid references public.user_profile (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index idx_form_v2_org_status on public.form_v2 (organization_id, status, updated_at desc);

comment on table public.form_v2 is
  'Workspace OS forms (V1-6): chosen properties of one object type; responses create objects.';

create table public.form_v2_response (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  form_id uuid not null references public.form_v2 (id) on delete cascade,
  submitted_by uuid references public.user_profile (id),
  submitted_at timestamptz not null default now(),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  object_type text not null,
  object_id uuid not null,
  legacy_submission_id uuid unique references public.form_submission (id) on delete set null
);

create index idx_form_v2_response_form on public.form_v2_response (form_id, submitted_at desc);
create index idx_form_v2_response_submitter on public.form_v2_response (submitted_by, submitted_at desc);

comment on table public.form_v2_response is
  'Responses to Workspace OS forms. object_id is the created object (a task id, or the response id until M1).';

-- ---------------------------------------------------------------------------
-- Property list checks
-- ---------------------------------------------------------------------------

-- The task properties a form may expose, with the kind each must have. Keys
-- are the system property keys in src/lib/objects/stubs.ts.
create or replace function app.form_v2_task_property_kind(p_key text) returns text
language sql immutable set search_path = '' as $$
  select case p_key
    when 'title' then 'text'
    when 'description' then 'text'
    when 'priority' then 'select'
    when 'start' then 'date'
    when 'due' then 'date'
    when 'estimate' then 'number'
  end;
$$;

create or replace function app.form_v2_properties_problem(p_type_key text, p_properties jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  p jsonb;
  v_keys text[] := '{}';
  v_key text;
  v_kind text;
  o jsonb;
begin
  if jsonb_typeof(p_properties) <> 'array' then return 'Properties must be a list'; end if;
  if jsonb_array_length(p_properties) > 50 then return 'A form has at most 50 properties'; end if;
  for p in select value from jsonb_array_elements(p_properties) loop
    if jsonb_typeof(p) <> 'object' then return 'Each property must be an object'; end if;
    if exists (select 1 from jsonb_object_keys(p) k
               where k not in ('key', 'kind', 'label', 'required', 'options')) then
      return 'Unknown property setting';
    end if;
    v_key := p->>'key';
    if jsonb_typeof(p->'key') is distinct from 'string' or v_key !~ '^[a-z][a-z0-9_]{0,39}$' then
      return 'Property keys are lower-case letters, digits and underscores';
    end if;
    if v_key = any (v_keys) then return format('Property %s is used twice', v_key); end if;
    v_keys := v_keys || v_key;
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
  end loop;
  if p_type_key = 'task' and not exists (
    select 1 from jsonb_array_elements(p_properties) x
    where x->>'key' = 'title' and (x->>'required')::boolean) then
    return 'A task form must ask for the title, as required';
  end if;
  return null;
end;
$$;

revoke all on function app.form_v2_task_property_kind(text) from public, anon;
revoke all on function app.form_v2_properties_problem(text, jsonb) from public, anon;
grant execute on function app.form_v2_task_property_kind(text) to authenticated, service_role;
grant execute on function app.form_v2_properties_problem(text, jsonb) to authenticated, service_role;

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
    -- Only the conversion copies a legacy form's status; a form built in the
    -- app starts as a draft. The flag is set, transaction-locally, by
    -- app.forms_v2_convert_legacy and cannot be set through the API.
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
  v_problem := app.form_v2_properties_problem(new.type_key, new.properties);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_form_v2() from public, anon, authenticated;

create trigger form_v2_protect before insert or update on public.form_v2
for each row execute function app.protect_form_v2();

-- ---------------------------------------------------------------------------
-- Answers
-- ---------------------------------------------------------------------------

-- Checks every answer against the frozen property list and returns the
-- answers as stored: known keys only, checkboxes always true or false.
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
  for p in select value from jsonb_array_elements(p_properties) loop
    v_key := p->>'key';
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
      else
        -- File answers need the scanning pipeline; converted forms that ask for
        -- files stay drafts until a file property is supported here.
        raise exception 'Answer for % cannot be given on this form yet', v_label using errcode = '22023';
    end case;
    v_out := v_out || jsonb_build_object(v_key, v);
  end loop;
  return v_out;
end;
$$;
revoke all on function app.form_v2_answers_normalized(jsonb, jsonb) from public, anon;
grant execute on function app.form_v2_answers_normalized(jsonb, jsonb) to authenticated, service_role;

-- Whether the signed-in person is in a published form's audience.
create or replace function app.can_answer_form_v2(p_form public.form_v2) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and p_form.status = 'published'
    and case p_form.audience
      when 'members' then app.is_org_member(p_form.organization_id)
      when 'staff' then app.is_org_staff(p_form.organization_id)
      else false
    end;
$$;
revoke all on function app.can_answer_form_v2(public.form_v2) from public, anon, authenticated;

-- The one way to answer a form: checks the audience and every answer, then
-- creates the object and the response in one transaction.
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
begin
  select * into v_form from public.form_v2 f where f.id = p_form_id;
  if not found or not app.can_answer_form_v2(v_form) then
    raise exception 'This form is not open to you' using errcode = '42501';
  end if;
  v_answers := app.form_v2_answers_normalized(v_form.properties, p_answers);

  if v_form.type_key = 'task' then
    if v_form.target_project_id is not null then
      select p.program_id into v_program_id from public.project p where p.id = v_form.target_project_id;
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
    v_object_id := v_response_id;
  end if;

  insert into public.form_v2_response (id, organization_id, form_id, submitted_by, answers, object_type, object_id)
  values (v_response_id, v_form.organization_id, v_form.id, v_uid, v_answers, v_form.type_key, v_object_id);

  return query select v_response_id, v_form.type_key, v_object_id;
end;
$$;
revoke all on function public.submit_form_v2(uuid, jsonb) from public, anon;
grant execute on function public.submit_form_v2(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reversible conversion of the existing forms (#145)
-- ---------------------------------------------------------------------------

-- Copies one organization's form_definition rows (and their submissions) that
-- have not been copied yet. Legacy text has one language, so both labels start
-- with it until someone translates them. Forms asking for a file or a
-- signature are copied as drafts: this model cannot take those answers yet.
create or replace function app.forms_v2_convert_legacy(p_organization_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform set_config('app.forms_v2_converting', 'on', true);
  with source as (
    select d.*,
      exists (select 1 from jsonb_array_elements(d.fields) f where f->>'type' = 'file')
        or d.requires_signature as needs_review
    from public.form_definition d
    where d.organization_id = p_organization_id
      and not exists (select 1 from public.form_v2 v where v.legacy_form_id = d.id)
  ), inserted as (
    insert into public.form_v2 (
      organization_id, type_key, title_en, title_fr, description_en, description_fr,
      audience, properties, status, legacy_form_id, created_by
    )
    select s.organization_id, 'form_response', s.title, s.title, s.description, s.description,
      s.audience,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'key', f.value->>'key',
            'kind', case f.value->>'type'
              when 'money' then 'currency'
              when 'choice' then 'select'
              else f.value->>'type' end,
            'label', jsonb_build_object('en', f.value->>'label', 'fr', f.value->>'label'),
            'required', (f.value->>'required')::boolean
          ) || case when f.value->>'type' = 'choice' then jsonb_build_object('options', (
            select jsonb_agg(jsonb_build_object(
              'key', 'option_' || o.ordinality,
              'label', jsonb_build_object('en', o.value #>> '{}', 'fr', o.value #>> '{}')
            ) order by o.ordinality)
            from jsonb_array_elements(f.value->'options') with ordinality o
          )) else '{}'::jsonb end
          order by f.ordinality)
        from jsonb_array_elements(s.fields) with ordinality f
      ), '[]'::jsonb),
      case when s.needs_review or jsonb_array_length(s.fields) = 0 then 'draft' else s.status end,
      s.id, s.created_by
    from source s
    returning id, legacy_form_id
  )
  select count(*) into v_count from inserted;

  -- Submissions keep their answers; choice answers become the option keys.
  insert into public.form_v2_response (
    organization_id, form_id, submitted_by, submitted_at, answers, object_type, object_id, legacy_submission_id
  )
  select s.organization_id, v.id, s.submitted_by, s.submitted_at,
    coalesce((
      select jsonb_object_agg(a.key, case
        when f.value->>'type' = 'choice' then coalesce((
          select to_jsonb('option_' || o.ordinality)
          from jsonb_array_elements(f.value->'options') with ordinality o
          where o.value = a.value), a.value)
        else a.value end)
      from jsonb_each(s.answers) a
      left join lateral (
        select x.value from jsonb_array_elements(d.fields) x where x.value->>'key' = a.key
      ) f on true
    ), '{}'::jsonb),
    'form_response', s.id, s.id
  from public.form_submission s
  join public.form_definition d on d.id = s.form_id
  join public.form_v2 v on v.legacy_form_id = d.id
  where s.organization_id = p_organization_id
    and not exists (select 1 from public.form_v2_response r where r.legacy_submission_id = s.id);

  perform set_config('app.forms_v2_converting', '', true);
  return v_count;
end;
$$;

-- Removes the copies again. A copied form that has had new responses through
-- this model is kept, because deleting it would lose those answers.
create or replace function app.forms_v2_revert_legacy(p_organization_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.form_v2_response r
  using public.form_v2 v
  where r.form_id = v.id and v.organization_id = p_organization_id
    and v.legacy_form_id is not null and r.legacy_submission_id is not null
    and not exists (
      select 1 from public.form_v2_response n where n.form_id = v.id and n.legacy_submission_id is null);
  with deleted as (
    delete from public.form_v2 v
    where v.organization_id = p_organization_id and v.legacy_form_id is not null
      and not exists (select 1 from public.form_v2_response r where r.form_id = v.id)
    returning 1
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;

revoke all on function app.forms_v2_convert_legacy(uuid) from public, anon, authenticated;
revoke all on function app.forms_v2_revert_legacy(uuid) from public, anon, authenticated;
grant execute on function app.forms_v2_convert_legacy(uuid) to service_role;
grant execute on function app.forms_v2_revert_legacy(uuid) to service_role;

-- Admins run the conversion for their own organization from the forms screen.
create or replace function public.forms_v2_convert_legacy(p_organization_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_org_admin(p_organization_id) then
    raise exception 'Only an owner or admin can convert forms' using errcode = '42501';
  end if;
  return app.forms_v2_convert_legacy(p_organization_id);
end;
$$;

create or replace function public.forms_v2_revert_legacy(p_organization_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_org_admin(p_organization_id) then
    raise exception 'Only an owner or admin can undo the conversion' using errcode = '42501';
  end if;
  return app.forms_v2_revert_legacy(p_organization_id);
end;
$$;

revoke all on function public.forms_v2_convert_legacy(uuid) from public, anon;
revoke all on function public.forms_v2_revert_legacy(uuid) from public, anon;
grant execute on function public.forms_v2_convert_legacy(uuid) to authenticated, service_role;
grant execute on function public.forms_v2_revert_legacy(uuid) to authenticated, service_role;

-- Existing forms are copied once now; old screens keep reading the originals.
select app.forms_v2_convert_legacy(o.id) from public.organization o;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.form_v2 enable row level security;
alter table public.form_v2_response enable row level security;

create policy form_v2_read on public.form_v2
for select to authenticated using (
  app.is_org_admin(organization_id)
  or (status = 'published' and (
        (audience = 'members' and app.is_org_member(organization_id))
        or (audience = 'staff' and app.is_org_staff(organization_id))))
  or exists (
    select 1 from public.form_v2_response r
    where r.form_id = form_v2.id and r.submitted_by = (select auth.uid())
      and app.is_org_member(form_v2.organization_id))
);

create policy form_v2_insert on public.form_v2
for insert to authenticated with check (app.is_org_admin(organization_id));

create policy form_v2_update on public.form_v2
for update to authenticated
using (app.is_org_admin(organization_id))
with check (app.is_org_admin(organization_id));

create policy form_v2_delete_draft on public.form_v2
for delete to authenticated using (app.is_org_admin(organization_id) and status = 'draft');

create policy form_v2_response_read on public.form_v2_response
for select to authenticated using (
  (submitted_by = (select auth.uid()) and app.is_org_member(organization_id))
  or app.is_org_admin(organization_id)
);

grant select, insert, update, delete on public.form_v2 to authenticated;
grant select on public.form_v2_response to authenticated;
grant all on public.form_v2, public.form_v2_response to service_role;
