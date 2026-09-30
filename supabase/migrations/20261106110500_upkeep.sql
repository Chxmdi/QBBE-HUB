-- Workspace OS workspace upkeep reports (V3-2, stream S6b, epic #199).
--
-- Four reports, each a security-invoker function: they run as the person
-- asking, so every row they return is one that person could already open. An
-- admin sees the whole workspace; everyone else sees their own corner of it.
-- None of them calls into the app schema, which signed-in roles cannot reach.
--
--   upkeep_stale_pages   documents and page objects nobody has touched or
--                        reviewed for N days, with their owner
--   upkeep_broken_links  link documents whose host is no longer approved, and
--                        open work still attached to an archived project
--   upkeep_orphans       open tasks with no project, program or assignee, and
--                        documents filed nowhere
--   upkeep_duplicates    open tasks, projects and documents that look the same
--                        (same normalized title; documents also by address)
--   upkeep_unused        custom object types with no objects, and saved views
--                        that point at a project that is archived or gone
--
-- Unused properties and lenses join upkeep_unused when property_definition
-- (M2) and lenses (M8) exist; today neither table does.
--
-- Owners review stale pages: upkeep_review records "still current" (which
-- resets the clock) or "archive". Hidden behind the wos_objects switch.

create table public.upkeep_review (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  object_type text not null check (object_type in ('document', 'page')),
  object_id uuid not null,
  decision text not null check (decision in ('current', 'archive')),
  note text check (note is null or char_length(note) <= 500),
  reviewed_by uuid not null references public.user_profile (id) on delete cascade default auth.uid(),
  reviewed_at timestamptz not null default now()
);

create index idx_upkeep_review_object on public.upkeep_review (object_id, reviewed_at desc);

comment on table public.upkeep_review is
  'Owner reviews of stale pages (V3-2). The latest review resets how long a page counts as idle.';

-- Whether the person may review this page: its owner, or someone who can manage it.
create or replace function app.upkeep_can_review(p_object_type text, p_object_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_object_type
    when 'document' then exists (
      select 1 from public.document d
      where d.id = p_object_id
        and (d.owner_id = (select auth.uid()) or app.can_manage_document(d.id)))
    when 'page' then exists (
      select 1 from public.object o
      where o.id = p_object_id
        and (o.owner_id = (select auth.uid()) or app.can(o.id, 'manage')))
    else false
  end;
$$;
revoke all on function app.upkeep_can_review(text, uuid) from public, anon;
grant execute on function app.upkeep_can_review(text, uuid) to authenticated, service_role;

alter table public.upkeep_review enable row level security;

create policy upkeep_review_read on public.upkeep_review
for select to authenticated using (
  app.is_org_member(organization_id)
  and (reviewed_by = (select auth.uid()) or app.is_org_staff(organization_id))
);

create policy upkeep_review_insert on public.upkeep_review
for insert to authenticated with check (
  reviewed_by = (select auth.uid())
  and app.is_org_member(organization_id)
  and app.upkeep_can_review(object_type, object_id)
);

-- Reviews are a record: nobody edits or deletes them through the API.
revoke update, delete on public.upkeep_review from anon, authenticated;
grant select, insert on public.upkeep_review to authenticated;
grant all on public.upkeep_review to service_role;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create or replace function public.upkeep_normalize(p_text text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:]]+', ' ', 'g'), '\s+', ' ', 'g'));
$$;
grant execute on function public.upkeep_normalize(text) to authenticated, service_role;

create or replace function public.upkeep_stale_pages(p_days integer default 180)
returns table (object_type text, object_id uuid, title text, owner_id uuid, owner_name text, last_touched timestamptz, days_idle integer)
language sql stable security invoker set search_path = '' as $$
  with candidates as (
    select 'document'::text as object_type, d.id, d.title, d.owner_id, d.updated_at
    from public.document d
    where d.archived_at is null
    union all
    select 'page', o.id, o.title, o.owner_id, o.updated_at
    from public.object o
    join public.object_type t on t.id = o.type_id and t.key = 'page'
    where o.archived_at is null and o.deleted_at is null
  ), touched as (
    select c.*, greatest(c.updated_at, (
      select max(r.reviewed_at) from public.upkeep_review r
      where r.object_id = c.id and r.decision = 'current')) as last_touched
    from candidates c
  )
  select t.object_type, t.id, t.title, t.owner_id, p.full_name, t.last_touched,
    floor(extract(epoch from (now() - t.last_touched)) / 86400)::integer
  from touched t
  left join public.user_profile p on p.id = t.owner_id
  where t.last_touched < now() - make_interval(days => greatest(coalesce(p_days, 180), 1))
  order by t.last_touched
  limit 500;
$$;

create or replace function public.upkeep_broken_links()
returns table (issue text, object_type text, object_id uuid, title text, detail text)
language sql stable security invoker set search_path = '' as $$
  select 'unapproved_host', 'document', d.id, d.title,
    lower(substring(d.url from '^[a-zA-Z]+://([^/:?#]+)'))
  from public.document d
  where d.archived_at is null and d.kind = 'link' and d.url is not null
    and not exists (
      select 1 from public.approved_document_host h
      where h.organization_id = d.organization_id
        and h.host = lower(substring(d.url from '^[a-zA-Z]+://([^/:?#]+)')))
  union all
  select 'archived_project', 'task', t.id, t.title, p.name
  from public.task t
  join public.project p on p.id = t.project_id
  where p.archived_at is not null and t.archived_at is null
    and t.status not in ('completed', 'cancelled')
  union all
  select 'archived_project', 'document', d.id, d.title, p.name
  from public.document d
  join public.project p on p.id = d.project_id
  where p.archived_at is not null and d.archived_at is null
  limit 500;
$$;

create or replace function public.upkeep_orphans(p_days integer default 30)
returns table (object_type text, object_id uuid, title text, created_at timestamptz, detail text)
language sql stable security invoker set search_path = '' as $$
  select 'task', t.id, t.title, t.created_at, 'no_home_no_assignee'
  from public.task t
  where t.archived_at is null and t.status not in ('completed', 'cancelled')
    and t.project_id is null and t.program_id is null and t.assignee_id is null
    and t.created_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
  union all
  select 'document', d.id, d.title, d.created_at, 'filed_nowhere'
  from public.document d
  where d.archived_at is null
    and d.project_id is null and d.program_id is null and d.meeting_id is null and d.folder_id is null
    and d.created_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
  order by 4
  limit 500;
$$;

create or replace function public.upkeep_duplicates()
returns table (object_type text, match_key text, object_ids uuid[], titles text[])
language sql stable security invoker set search_path = '' as $$
  select 'task', public.upkeep_normalize(t.title),
    array_agg(t.id order by t.created_at), array_agg(t.title order by t.created_at)
  from public.task t
  where t.archived_at is null and t.status not in ('completed', 'cancelled')
    and public.upkeep_normalize(t.title) <> ''
  group by t.organization_id, t.project_id, public.upkeep_normalize(t.title)
  having count(*) > 1
  union all
  select 'project', public.upkeep_normalize(p.name),
    array_agg(p.id order by p.created_at), array_agg(p.name order by p.created_at)
  from public.project p
  where p.archived_at is null and public.upkeep_normalize(p.name) <> ''
  group by p.organization_id, public.upkeep_normalize(p.name)
  having count(*) > 1
  union all
  select 'document', coalesce(d.url, public.upkeep_normalize(d.title)),
    array_agg(d.id order by d.created_at), array_agg(d.title order by d.created_at)
  from public.document d
  where d.archived_at is null
  group by d.organization_id, coalesce(d.url, public.upkeep_normalize(d.title))
  having count(*) > 1
  limit 500;
$$;

create or replace function public.upkeep_unused()
returns table (issue text, object_id uuid, title text, detail text)
language sql stable security invoker set search_path = '' as $$
  select 'type_without_objects', t.id, coalesce(t.name_en, t.key), t.key
  from public.object_type t
  where t.kind = 'custom' and t.archived_at is null
    and not exists (select 1 from public.object o where o.type_id = t.id and o.deleted_at is null)
  union all
  select 'view_for_missing_project', v.id, v.name, v.query->>'project'
  from public.saved_view v
  where (v.query->>'project') ~ '^[0-9a-fA-F-]{36}$'
    and not exists (
      select 1 from public.project p
      where p.id = (v.query->>'project')::uuid and p.archived_at is null)
  limit 500;
$$;

revoke all on function public.upkeep_stale_pages(integer) from public, anon;
revoke all on function public.upkeep_broken_links() from public, anon;
revoke all on function public.upkeep_orphans(integer) from public, anon;
revoke all on function public.upkeep_duplicates() from public, anon;
revoke all on function public.upkeep_unused() from public, anon;
grant execute on function public.upkeep_stale_pages(integer) to authenticated, service_role;
grant execute on function public.upkeep_broken_links() to authenticated, service_role;
grant execute on function public.upkeep_orphans(integer) to authenticated, service_role;
grant execute on function public.upkeep_duplicates() to authenticated, service_role;
grant execute on function public.upkeep_unused() to authenticated, service_role;
