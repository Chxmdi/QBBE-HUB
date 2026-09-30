-- Workspace OS templates (V1-13, stream S6b, epic #199).
--
-- A template describes an object, a page or a whole space, in English and
-- Quebec French, with every date given as a number of days after a start date
-- chosen when the template is used. The gallery lists the published ones.
--
-- What each scope creates today, before the object registry (M1), pages (M4a)
-- and spaces (M10a) exist:
--   * object, type `task`:    one task, in a chosen project.
--   * object, type `project`: a project with its tasks, in a chosen program.
--   * space:                  several projects with their tasks, in a chosen
--                             program (today's program spaces, design note A6).
--   * page:                   nothing yet; the gallery previews it and the
--                             editor (S3) applies its blocks once pages exist.
--
-- public.apply_template_v2 runs as the caller (security invoker), so the
-- existing project and task insert rules decide what someone may create; a
-- template never grants a right its user does not already have.
--
-- The existing project and program templates (20260918230000) are untouched.
-- Hidden behind the wos_objects switch in the app (no separate switch exists
-- for templates; see the PR).

create table public.template_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  scope text not null check (scope in ('object', 'page', 'space')),
  type_key text check (type_key is null or type_key in ('task', 'project')),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 200),
  name_fr text not null check (char_length(btrim(name_fr)) between 1 and 200),
  description_en text check (description_en is null or char_length(description_en) <= 2000),
  description_fr text check (description_fr is null or char_length(description_fr) <= 2000),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid references public.user_profile (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_v2_object_has_type check ((scope = 'object') = (type_key is not null))
);

create index idx_template_v2_gallery on public.template_v2 (organization_id, status, scope, name_en);

comment on table public.template_v2 is
  'Workspace OS templates (V1-13): objects, pages and spaces, bilingual, dates relative to a start date.';

-- ---------------------------------------------------------------------------
-- Body checks
-- ---------------------------------------------------------------------------

create or replace function app.template_v2_text_ok(p jsonb, p_max integer) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
    and char_length(btrim(coalesce(p->>'en', ''))) between 1 and p_max
    and char_length(btrim(coalesce(p->>'fr', ''))) between 1 and p_max;
$$;

create or replace function app.template_v2_offset_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) k where k not in ('start', 'due'))
    and (p->'start' is null or (jsonb_typeof(p->'start') = 'number'
         and (p->>'start') ~ '^\d{1,4}$' and (p->>'start')::integer <= 3650))
    and (p->'due' is null or (jsonb_typeof(p->'due') = 'number'
         and (p->>'due') ~ '^\d{1,4}$' and (p->>'due')::integer <= 3650))
    and (p->'start' is null or p->'due' is null or (p->>'start')::integer <= (p->>'due')::integer)
  );
$$;

-- A task item: {title, description?, priority?, offsets?}
create or replace function app.template_v2_task_problem(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p) is distinct from 'object' then return 'Each task must be an object'; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('title', 'description', 'priority', 'offsets')) then
    return 'Unknown task setting';
  end if;
  if not app.template_v2_text_ok(p->'title', 200) then
    return 'Every task needs an English and a French title';
  end if;
  if p ? 'description' and not app.template_v2_text_ok(p->'description', 5000) then
    return 'A task description needs English and French text';
  end if;
  if p ? 'priority' and coalesce(p->>'priority', '') not in ('low', 'medium', 'high', 'critical') then
    return 'Priority is low, medium, high or critical';
  end if;
  if not app.template_v2_offset_ok(p->'offsets') then
    return 'Dates are whole days (0 to 3650) after the start, and a start comes before its due date';
  end if;
  return null;
end;
$$;

create or replace function app.template_v2_project_problem(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  t jsonb;
  v_problem text;
begin
  if jsonb_typeof(p) is distinct from 'object' then return 'Each project must be an object'; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('title', 'description', 'offsets', 'tasks')) then
    return 'Unknown project setting';
  end if;
  if not app.template_v2_text_ok(p->'title', 200) then
    return 'Every project needs an English and a French name';
  end if;
  if p ? 'description' and not app.template_v2_text_ok(p->'description', 5000) then
    return 'A project description needs English and French text';
  end if;
  if not app.template_v2_offset_ok(p->'offsets') then
    return 'Dates are whole days (0 to 3650) after the start, and a start comes before its due date';
  end if;
  if p ? 'tasks' then
    if jsonb_typeof(p->'tasks') <> 'array' or jsonb_array_length(p->'tasks') > 200 then
      return 'A project has at most 200 tasks';
    end if;
    for t in select value from jsonb_array_elements(p->'tasks') loop
      v_problem := app.template_v2_task_problem(t);
      if v_problem is not null then return v_problem; end if;
    end loop;
  end if;
  return null;
end;
$$;

create or replace function app.template_v2_body_problem(p_scope text, p_type_key text, p_body jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  b jsonb;
  v_problem text;
begin
  if jsonb_typeof(p_body) is distinct from 'object' then return 'A template body must be an object'; end if;
  if p_scope = 'object' and p_type_key = 'task' then
    return app.template_v2_task_problem(p_body);
  elsif p_scope = 'object' and p_type_key = 'project' then
    return app.template_v2_project_problem(p_body);
  elsif p_scope = 'page' then
    if exists (select 1 from jsonb_object_keys(p_body) k where k not in ('title', 'blocks')) then
      return 'Unknown page setting';
    end if;
    if not app.template_v2_text_ok(p_body->'title', 200) then
      return 'A page needs an English and a French title';
    end if;
    if jsonb_typeof(p_body->'blocks') is distinct from 'array' or jsonb_array_length(p_body->'blocks') > 500 then
      return 'A page has a list of at most 500 blocks';
    end if;
    for b in select value from jsonb_array_elements(p_body->'blocks') loop
      if jsonb_typeof(b) <> 'object'
         or coalesce(b->>'kind', '') not in ('heading', 'paragraph', 'todo')
         or exists (select 1 from jsonb_object_keys(b) k where k not in ('kind', 'text', 'offsets'))
         or not app.template_v2_text_ok(b->'text', 5000)
         or not app.template_v2_offset_ok(b->'offsets') then
        return 'Each block is a heading, paragraph or to-do with English and French text';
      end if;
    end loop;
    return null;
  elsif p_scope = 'space' then
    if exists (select 1 from jsonb_object_keys(p_body) k where k not in ('title', 'projects')) then
      return 'Unknown space setting';
    end if;
    if not app.template_v2_text_ok(p_body->'title', 200) then
      return 'A space needs an English and a French name';
    end if;
    if jsonb_typeof(p_body->'projects') is distinct from 'array'
       or jsonb_array_length(p_body->'projects') not between 1 and 50 then
      return 'A space has 1 to 50 projects';
    end if;
    for b in select value from jsonb_array_elements(p_body->'projects') loop
      v_problem := app.template_v2_project_problem(b);
      if v_problem is not null then return v_problem; end if;
    end loop;
    return null;
  end if;
  return 'Unknown template scope';
end;
$$;

revoke all on function app.template_v2_text_ok(jsonb, integer) from public, anon;
revoke all on function app.template_v2_offset_ok(jsonb) from public, anon;
revoke all on function app.template_v2_task_problem(jsonb) from public, anon;
revoke all on function app.template_v2_project_problem(jsonb) from public, anon;
revoke all on function app.template_v2_body_problem(text, text, jsonb) from public, anon;
grant execute on function app.template_v2_text_ok(jsonb, integer) to authenticated, service_role;
grant execute on function app.template_v2_offset_ok(jsonb) to authenticated, service_role;
grant execute on function app.template_v2_task_problem(jsonb) to authenticated, service_role;
grant execute on function app.template_v2_project_problem(jsonb) to authenticated, service_role;
grant execute on function app.template_v2_body_problem(text, text, jsonb) to authenticated, service_role;

create or replace function app.protect_template_v2() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_problem text;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    if (select auth.uid()) is not null then
      new.created_by := (select auth.uid());
    end if;
  elsif (new.organization_id, new.created_by, new.created_at)
        is distinct from (old.organization_id, old.created_by, old.created_at) then
    raise exception 'Template ownership is server managed' using errcode = '42501';
  end if;
  v_problem := app.template_v2_body_problem(new.scope, new.type_key, new.body);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_template_v2() from public, anon, authenticated;

create trigger template_v2_protect before insert or update on public.template_v2
for each row execute function app.protect_template_v2();

-- ---------------------------------------------------------------------------
-- Using a template
-- ---------------------------------------------------------------------------

-- Creates the template's records in the caller's language. It calls nothing in
-- the app schema, which signed-in roles cannot reach, because it runs as them.
--
-- Creates the template's records in the caller's language, every date counted
-- from p_start. Runs with the caller's rights: project and task insert rules
-- decide, exactly as if the person had made each record by hand.
create or replace function public.apply_template_v2(
  p_template_id uuid,
  p_start date,
  p_locale text default 'en',
  p_program_id uuid default null,
  p_project_id uuid default null
)
returns table (object_type text, object_id uuid)
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_template public.template_v2%rowtype;
  v_uid uuid := (select auth.uid());
  v_locale text := case when p_locale = 'fr-CA' then 'fr-CA' else 'en' end;
  v_program_id uuid;
  v_project_id uuid;
  v_task_id uuid;
  p jsonb;
  t jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in to use a template' using errcode = '42501';
  end if;
  if p_start is null then
    raise exception 'Choose a start date' using errcode = '22023';
  end if;
  select * into v_template from public.template_v2 tv
  where tv.id = p_template_id and tv.status = 'published';
  if not found then
    raise exception 'This template is not available' using errcode = '42501';
  end if;

  if v_template.scope = 'page' then
    raise exception 'Page templates are applied from the page editor' using errcode = '0A000';
  end if;

  if v_template.scope = 'object' and v_template.type_key = 'task' then
    if p_project_id is not null then
      select pr.program_id into v_program_id from public.project pr where pr.id = p_project_id;
    end if;
    insert into public.task (organization_id, program_id, project_id, title, description, priority,
                             start_at, due_at, created_by, requester_id)
    values (v_template.organization_id, v_program_id, p_project_id,
      (case when v_locale = 'fr-CA' then v_template.body->'title'->>'fr' else v_template.body->'title'->>'en' end),
      (case when v_locale = 'fr-CA' then v_template.body->'description'->>'fr' else v_template.body->'description'->>'en' end),
      coalesce(v_template.body->>'priority', 'medium')::public.task_priority,
      (case when v_template.body->'offsets' ? 'start' then p_start + (v_template.body->'offsets'->>'start')::integer end),
      (case when v_template.body->'offsets' ? 'due' then p_start + (v_template.body->'offsets'->>'due')::integer end),
      v_uid, v_uid)
    returning id into v_task_id;
    return query select 'task'::text, v_task_id;
    return;
  end if;

  for p in
    select value from jsonb_array_elements(
      case when v_template.scope = 'space' then v_template.body->'projects'
           else jsonb_build_array(v_template.body) end)
  loop
    insert into public.project (organization_id, program_id, name, description, owner_id,
                                start_date, target_date, created_by)
    values (v_template.organization_id, p_program_id,
      (case when v_locale = 'fr-CA' then p->'title'->>'fr' else p->'title'->>'en' end),
      (case when v_locale = 'fr-CA' then p->'description'->>'fr' else p->'description'->>'en' end),
      v_uid,
      (case when p->'offsets' ? 'start' then p_start + (p->'offsets'->>'start')::integer end),
      (case when p->'offsets' ? 'due' then p_start + (p->'offsets'->>'due')::integer end),
      v_uid)
    returning id into v_project_id;
    return query select 'project'::text, v_project_id;

    for t in select value from jsonb_array_elements(coalesce(p->'tasks', '[]'::jsonb)) loop
      insert into public.task (organization_id, program_id, project_id, title, description, priority,
                               start_at, due_at, created_by, requester_id)
      values (v_template.organization_id, p_program_id, v_project_id,
        (case when v_locale = 'fr-CA' then t->'title'->>'fr' else t->'title'->>'en' end),
        (case when v_locale = 'fr-CA' then t->'description'->>'fr' else t->'description'->>'en' end),
        coalesce(t->>'priority', 'medium')::public.task_priority,
        (case when t->'offsets' ? 'start' then p_start + (t->'offsets'->>'start')::integer end),
        (case when t->'offsets' ? 'due' then p_start + (t->'offsets'->>'due')::integer end),
        v_uid, v_uid)
      returning id into v_task_id;
      return query select 'task'::text, v_task_id;
    end loop;
  end loop;
end;
$$;
revoke all on function public.apply_template_v2(uuid, date, text, uuid, uuid) from public, anon;
grant execute on function public.apply_template_v2(uuid, date, text, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.template_v2 enable row level security;

-- Members browse the published gallery; a draft is seen by its author and admins.
create policy template_v2_read on public.template_v2
for select to authenticated using (
  app.is_org_member(organization_id)
  and (status = 'published' or created_by = (select auth.uid()) or app.is_org_admin(organization_id))
);

-- Staff write templates; each person edits their own, admins edit any.
create policy template_v2_insert on public.template_v2
for insert to authenticated with check (app.is_org_staff(organization_id));

create policy template_v2_update on public.template_v2
for update to authenticated
using ((created_by = (select auth.uid()) and app.is_org_staff(organization_id)) or app.is_org_admin(organization_id))
with check ((created_by = (select auth.uid()) and app.is_org_staff(organization_id)) or app.is_org_admin(organization_id));

create policy template_v2_delete on public.template_v2
for delete to authenticated
using ((created_by = (select auth.uid()) and app.is_org_staff(organization_id)) or app.is_org_admin(organization_id));

grant select, insert, update, delete on public.template_v2 to authenticated;
grant all on public.template_v2 to service_role;

-- ---------------------------------------------------------------------------
-- Starter gallery: one template of each scope for every organization, now and
-- when an organization is created. created_by is null for these.
-- ---------------------------------------------------------------------------

create or replace function app.template_v2_add_starters(p_organization_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, description_en, description_fr, status, created_by, body)
  select p_organization_id, s.scope, s.type_key, s.name_en, s.name_fr, s.description_en, s.description_fr, 'published', null, s.body::jsonb
  from (values
    ('object', 'task', 'Follow up after a meeting', 'Suivi après une réunion',
     'One task, due two days after the meeting.', 'Une tâche, due deux jours après la réunion.',
     '{"title":{"en":"Send the meeting follow-up","fr":"Envoyer le suivi de la réunion"},"priority":"medium","offsets":{"due":2}}'),
    ('object', 'project', 'Volunteer onboarding', 'Accueil des bénévoles',
     'A four-week project with the usual steps.', 'Un projet de quatre semaines avec les étapes habituelles.',
     '{"title":{"en":"Volunteer onboarding","fr":"Accueil des bénévoles"},"offsets":{"start":0,"due":28},"tasks":[{"title":{"en":"Send the welcome email","fr":"Envoyer le courriel de bienvenue"},"offsets":{"due":1}},{"title":{"en":"Check references","fr":"Vérifier les références"},"offsets":{"due":7}},{"title":{"en":"First shift with a mentor","fr":"Premier quart avec un mentor"},"offsets":{"start":14,"due":14}}]}'),
    ('page', null, 'Meeting notes', 'Notes de réunion',
     'Agenda, decisions and next steps.', 'Ordre du jour, décisions et prochaines étapes.',
     '{"title":{"en":"Meeting notes","fr":"Notes de réunion"},"blocks":[{"kind":"heading","text":{"en":"Agenda","fr":"Ordre du jour"}},{"kind":"heading","text":{"en":"Decisions","fr":"Décisions"}},{"kind":"todo","text":{"en":"Share the notes","fr":"Diffuser les notes"},"offsets":{"due":1}}]}'),
    ('space', null, 'Community event', 'Événement communautaire',
     'Planning and promotion projects for an event six weeks away.', 'Projets de planification et de promotion pour un événement dans six semaines.',
     '{"title":{"en":"Community event","fr":"Événement communautaire"},"projects":[{"title":{"en":"Event logistics","fr":"Logistique de l’événement"},"offsets":{"start":0,"due":42},"tasks":[{"title":{"en":"Book the venue","fr":"Réserver la salle"},"priority":"high","offsets":{"due":7}},{"title":{"en":"Confirm catering","fr":"Confirmer le traiteur"},"offsets":{"due":28}}]},{"title":{"en":"Promotion","fr":"Promotion"},"offsets":{"start":7,"due":42},"tasks":[{"title":{"en":"Publish the invitation","fr":"Publier l’invitation"},"offsets":{"due":14}}]}]}')
  ) as s(scope, type_key, name_en, name_fr, description_en, description_fr, body)
  where not exists (
      select 1 from public.template_v2 t
      where t.organization_id = p_organization_id and t.created_by is null and t.name_en = s.name_en);
end;
$$;
revoke all on function app.template_v2_add_starters(uuid) from public, anon, authenticated;

create or replace function app.template_v2_starters_for_new_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.template_v2_add_starters(new.id);
  return new;
end;
$$;
revoke all on function app.template_v2_starters_for_new_organization() from public, anon, authenticated;

create trigger organization_template_v2_starters after insert on public.organization
for each row execute function app.template_v2_starters_for_new_organization();

select app.template_v2_add_starters(o.id) from public.organization o;
