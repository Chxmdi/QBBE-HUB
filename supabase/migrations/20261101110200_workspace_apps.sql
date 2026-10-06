-- Workspace OS: apps (V2-3, epic #199, stream S1b).
--
-- An app is a named bundle of screens (lenses, pages, forms, dashboards) with
-- its own navigation, actions and permissions. The definition is JSON checked
-- by src/features/apps/schema.ts; screens point at lenses, pages, forms and
-- actions by key, so an app never holds a copy of anyone's data.
--
-- Permissions use the Workspace OS capability names (contracts.ts):
-- a grant gives an organization role or one person a set of capabilities on
-- the app (view, edit_content, run_workflow, manage). Using an app never
-- widens access to what it shows: every screen still reads through the
-- viewer's own RLS (public.can on each object), and every action still checks
-- its capability on each target. The app check is an extra gate, never a
-- bypass.
--
-- Owners and admins (with two-step sign-in) manage every app and can open
-- drafts. Everyone else sees an app only once it is published and a grant
-- names their role or them.

create table public.workspace_app (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{1,47}$'),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 80),
  name_fr text not null check (char_length(btrim(name_fr)) between 1 and 80),
  description_en text not null default '' check (char_length(description_en) <= 300),
  description_fr text not null default '' check (char_length(description_fr) <= 300),
  icon text check (icon is null or icon ~ '^[a-z0-9-]{1,40}$'),
  definition jsonb not null check (jsonb_typeof(definition) = 'object' and pg_column_size(definition) <= 131072),
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create index workspace_app_org_idx on public.workspace_app (organization_id, name_en);

comment on table public.workspace_app is
  'Workspace OS apps (V2-3): named screens, navigation, actions and dashboards over existing objects.';

create table public.workspace_app_grant (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  app_id uuid not null references public.workspace_app (id) on delete cascade,
  org_role public.org_role,
  user_id uuid references public.user_profile (id) on delete cascade,
  capabilities text[] not null check (
    cardinality(capabilities) between 1 and 4
    and capabilities <@ array['view', 'edit_content', 'run_workflow', 'manage']::text[]
  ),
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint workspace_app_grant_one_grantee check ((org_role is null) <> (user_id is null))
);

create unique index workspace_app_grant_role_uq on public.workspace_app_grant (app_id, org_role) where org_role is not null;
create unique index workspace_app_grant_user_uq on public.workspace_app_grant (app_id, user_id) where user_id is not null;
create index workspace_app_grant_user_idx on public.workspace_app_grant (user_id) where user_id is not null;

-- A grant must belong to its app's organization.
create or replace function app.workspace_app_grant_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.workspace_app a
    where a.id = new.app_id and a.organization_id = new.organization_id
  ) then
    raise exception 'A grant must be in its app''s organization.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger workspace_app_grant_org
before insert or update on public.workspace_app_grant
for each row execute function app.workspace_app_grant_org();

create or replace function app.workspace_app_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), old.updated_by);
  return new;
end;
$$;

create trigger workspace_app_touch
before update on public.workspace_app
for each row execute function app.workspace_app_touch();

-- ---------------------------------------------------------------------------
-- The access question for apps: can the caller use this app for this
-- capability? `manage` includes the others.
-- ---------------------------------------------------------------------------
create or replace function app.can_use_app(p_app uuid, p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app public.workspace_app;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_app is null
     or p_capability not in ('view', 'edit_content', 'run_workflow', 'manage') then
    return false;
  end if;
  select * into v_app from public.workspace_app where id = p_app;
  if not found then
    return false;
  end if;
  if app.is_org_admin(v_app.organization_id) then
    return true;
  end if;
  if v_app.published_at is null or v_app.archived_at is not null then
    return false;
  end if;
  return exists (
    select 1
    from public.organization_membership m
    join public.workspace_app_grant g
      on g.app_id = v_app.id
     and (g.org_role = m.role or g.user_id = m.user_id)
    where m.organization_id = v_app.organization_id
      and m.user_id = v_uid
      and m.status = 'active'
      and (p_capability = any (g.capabilities) or 'manage' = any (g.capabilities))
  );
end;
$$;

create or replace function public.can_use_app(p_app uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_use_app(p_app, p_capability);
$$;

revoke all on function app.can_use_app(uuid, text) from public, anon, authenticated;
revoke all on function public.can_use_app(uuid, text) from public, anon;
grant execute on function app.can_use_app(uuid, text) to service_role;
grant execute on function public.can_use_app(uuid, text) to authenticated, service_role;
revoke all on function app.workspace_app_grant_org() from public, anon, authenticated;
revoke all on function app.workspace_app_touch() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.workspace_app enable row level security;
alter table public.workspace_app_grant enable row level security;

-- The admin check comes first and reads the row itself: can_use_app looks the
-- app up by id, which cannot see a row still being inserted (INSERT … RETURNING).
create policy workspace_app_read on public.workspace_app
for select to authenticated using (
  app.is_org_admin(organization_id) or public.can_use_app(id, 'view')
);

create policy workspace_app_admin_insert on public.workspace_app
for insert to authenticated with check (app.is_org_admin(organization_id));

-- `manage` on an app lets its managers change it; only admins create, delete or publish.
create policy workspace_app_manage_update on public.workspace_app
for update to authenticated
using (public.can_use_app(id, 'manage'))
with check (public.can_use_app(id, 'manage'));

create policy workspace_app_admin_delete on public.workspace_app
for delete to authenticated using (app.is_org_admin(organization_id));

create policy workspace_app_grant_read on public.workspace_app_grant
for select to authenticated using (
  app.is_org_admin(organization_id)
  or (user_id = (select auth.uid()) and app.is_org_member(organization_id))
);

create policy workspace_app_grant_admin_write on public.workspace_app_grant
for all to authenticated
using (app.is_org_admin(organization_id))
with check (app.is_org_admin(organization_id));

revoke all on public.workspace_app, public.workspace_app_grant from anon, authenticated;
grant select, delete on public.workspace_app to authenticated;
grant insert (organization_id, slug, name_en, name_fr, description_en, description_fr, icon, definition)
  on public.workspace_app to authenticated;
grant update (name_en, name_fr, description_en, description_fr, icon, definition)
  on public.workspace_app to authenticated;
grant select, insert, update, delete on public.workspace_app_grant to authenticated;
grant all on public.workspace_app, public.workspace_app_grant to service_role;

-- Publishing and archiving are admin decisions, so they are not column grants.
create or replace function public.workspace_app_set_published(p_app uuid, p_published boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.workspace_app where id = p_app for update;
  if v_org is null or not app.is_org_admin(v_org) then
    raise exception 'Only an owner or admin can publish an app.' using errcode = 'insufficient_privilege';
  end if;
  update public.workspace_app
  set published_at = case when p_published then coalesce(published_at, now()) else null end
  where id = p_app;
end;
$$;

revoke all on function public.workspace_app_set_published(uuid, boolean) from public, anon;
grant execute on function public.workspace_app_set_published(uuid, boolean) to authenticated, service_role;
