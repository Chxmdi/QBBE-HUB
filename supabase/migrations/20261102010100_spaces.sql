-- Workspace OS spaces (M10a, epic #199, stream S2).
--
-- A space is where objects live (workspace-os-object-layer.md, section 7).
-- Every organization gets:
--   * one Workspace space, for its staff;
--   * one Private space per member, which only that member can see;
--   * one space per program. A program space has the program's own id, so a
--     program link and a space link name the same thing, and the program's
--     existing grants (program_access_grant, lead_id) decide who is in it:
--     they are read through, never copied, so there is one source of truth;
--   * any number of custom spaces (Board, Admin, ...) created by an admin.
--
-- Spaces are kept in step by triggers on organization, organization_membership
-- and program, and backfilled below, so no row is ever missing one.
--
-- Who can do what in a space (app.space_capabilities) uses the Workspace OS
-- capability names (contracts.ts, workspaceCapabilities). M10b adds grants
-- to people, teams and roles on top of these defaults; until then:
--
--   workspace  owner/admin: everything (view only without two-step sign-in)
--              staff: view, comment, edit_content
--              leadership_viewer: view
--              volunteer, guest: nothing
--   program    today's program rules, through has_program_capability, with
--              the same mapping the app.can stand-in uses
--   private    its owner: everything (owner/admin roles: view only without
--              two-step sign-in, as everywhere else); nobody else, admins
--              included
--   custom     owner/admin: everything (view only without two-step sign-in)
--
-- An archived space keeps only view and manage (so it can be restored).

create table public.space (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  kind text not null,
  program_id uuid,
  owner_id uuid references public.user_profile (id) on delete cascade,
  name_en text not null,
  name_fr text not null,
  description text,
  icon text,
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint space_kind_check check (kind in ('workspace', 'program', 'private', 'custom')),
  constraint space_kind_shape check (
    (kind = 'program' and program_id is not null and program_id = id and owner_id is null)
    or (kind = 'private' and owner_id is not null and program_id is null)
    or (kind in ('workspace', 'custom') and program_id is null and owner_id is null)
  ),
  constraint space_name_en_length check (char_length(btrim(name_en)) between 1 and 120),
  constraint space_name_fr_length check (char_length(btrim(name_fr)) between 1 and 120),
  constraint space_description_length check (description is null or char_length(description) <= 2000),
  constraint space_icon_length check (icon is null or char_length(icon) <= 64),
  constraint space_program_org_fk foreign key (program_id, organization_id)
    references public.program (id, organization_id) on delete cascade,
  constraint space_id_organization_unique unique (id, organization_id)
);

create unique index space_one_workspace_per_org
  on public.space (organization_id) where kind = 'workspace';
create unique index space_one_private_per_member
  on public.space (organization_id, owner_id) where kind = 'private';
create unique index space_one_per_program
  on public.space (program_id) where program_id is not null;
create index space_org_kind_idx on public.space (organization_id, kind);

comment on table public.space is
  'Workspace OS spaces (M10a): one workspace space per organization, one private space per member, one space per program (same id as the program), and custom spaces.';

create trigger space_set_updated_at
  before update on public.space
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Capability names
-- ---------------------------------------------------------------------------

create or replace function app.wos_capabilities()
returns text[]
language sql immutable
set search_path = ''
as $$
  select array['view', 'comment', 'edit_content', 'edit_structure', 'manage', 'run_workflow', 'share'];
$$;

-- Today's record capabilities that satisfy one Workspace OS capability. The
-- same map as the app.can stand-in (20261101000200).
create or replace function app.wos_legacy_capabilities(p_capability text)
returns text[]
language sql immutable
set search_path = ''
as $$
  select case lower(coalesce(p_capability, ''))
    when 'view' then array['read']
    when 'comment' then array['manage', 'collaborate', 'review', 'approve']
    when 'edit_content' then array['manage', 'collaborate']
    when 'edit_structure' then array['manage']
    when 'manage' then array['manage']
    when 'share' then array['manage']
    when 'run_workflow' then array['manage']
    else array[]::text[]
  end;
$$;

revoke all on function app.wos_capabilities() from public, anon;
revoke all on function app.wos_legacy_capabilities(text) from public, anon;
grant execute on function app.wos_capabilities() to authenticated, service_role;
grant execute on function app.wos_legacy_capabilities(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What the signed-in person can do in a space
-- ---------------------------------------------------------------------------

create or replace function app.space_capabilities(p_space uuid)
returns text[]
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_space public.space%rowtype;
  v_role public.org_role;
  v_aal2 boolean := coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2';
  v_all constant text[] := app.wos_capabilities();
  v_result text[] := array[]::text[];
  v_capability text;
begin
  if v_uid is null or p_space is null then
    return array[]::text[];
  end if;

  select * into v_space from public.space s where s.id = p_space;
  if not found then
    return array[]::text[];
  end if;

  select m.role into v_role
  from public.organization_membership m
  where m.organization_id = v_space.organization_id
    and m.user_id = v_uid
    and m.status = 'active';
  if not found then
    return array[]::text[];
  end if;

  if v_space.kind = 'private' then
    if v_space.owner_id = v_uid then
      v_result := v_all;
    end if;
  elsif v_space.kind = 'program' then
    foreach v_capability in array v_all loop
      if exists (
        select 1 from unnest(app.wos_legacy_capabilities(v_capability)) legacy
        where app.has_program_capability(v_space.program_id, legacy)
      ) then
        v_result := v_result || v_capability;
      end if;
    end loop;
  elsif v_role in ('owner', 'admin') then
    v_result := v_all;
  elsif v_space.kind = 'workspace' and v_role = 'staff' then
    v_result := array['view', 'comment', 'edit_content'];
  elsif v_space.kind = 'workspace' and v_role = 'leadership_viewer' then
    v_result := array['view'];
  end if;

  -- The two-step sign-in rule, as in every existing predicate: owners and
  -- admins without it may only read.
  if v_role in ('owner', 'admin') and not v_aal2 then
    v_result := array(select c from unnest(v_result) c where c = 'view');
  end if;

  if v_space.archived_at is not null then
    v_result := array(select c from unnest(v_result) c where c in ('view', 'manage'));
  end if;

  return v_result;
end;
$$;

create or replace function app.space_can(p_space uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select lower(coalesce(p_capability, '')) = any (app.space_capabilities(p_space));
$$;

-- API and policy wrappers, the same split as public.can.
create or replace function public.space_capabilities(space_id uuid)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select app.space_capabilities(space_id);
$$;

create or replace function public.can_in_space(space_id uuid, capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.space_can(space_id, capability);
$$;

-- Named in the object layer design (section 3): custom objects are inserted
-- with this check. Creating content in a space needs edit_content there.
create or replace function public.can_create_in_space(space_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.space_can(space_id, 'edit_content');
$$;

revoke all on function app.space_capabilities(uuid) from public, anon, authenticated;
revoke all on function app.space_can(uuid, text) from public, anon, authenticated;
revoke all on function public.space_capabilities(uuid) from public, anon;
revoke all on function public.can_in_space(uuid, text) from public, anon;
revoke all on function public.can_create_in_space(uuid) from public, anon;
grant execute on function app.space_capabilities(uuid) to service_role;
grant execute on function app.space_can(uuid, text) to service_role;
grant execute on function public.space_capabilities(uuid) to authenticated, service_role;
grant execute on function public.can_in_space(uuid, text) to authenticated, service_role;
grant execute on function public.can_create_in_space(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Keeping spaces in step
-- ---------------------------------------------------------------------------

create or replace function app.sync_organization_space()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.space (organization_id, kind, name_en, name_fr, created_by)
  values (new.id, 'workspace', 'Workspace', 'Espace de travail', null)
  on conflict (organization_id) where kind = 'workspace' do nothing;
  return new;
end;
$$;

create or replace function app.sync_member_private_space()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    insert into public.space (organization_id, kind, owner_id, name_en, name_fr, created_by)
    values (new.organization_id, 'private', new.user_id, 'Private', 'Privé', null)
    on conflict (organization_id, owner_id) where kind = 'private' do nothing;
  end if;
  return new;
end;
$$;

create or replace function app.sync_program_space()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_archived timestamptz :=
    case when new.status = 'archived' then coalesce(new.archived_at, now()) else new.archived_at end;
begin
  insert into public.space (id, organization_id, kind, program_id, name_en, name_fr, description, archived_at, created_by)
  values (new.id, new.organization_id, 'program', new.id,
          coalesce(left(nullif(btrim(new.name), ''), 120), 'Program'),
          coalesce(left(nullif(btrim(new.name), ''), 120), 'Programme'),
          left(new.description, 2000), v_archived, new.created_by)
  on conflict (id) do update
    set name_en = excluded.name_en,
        name_fr = excluded.name_fr,
        description = excluded.description,
        archived_at = excluded.archived_at;
  return new;
end;
$$;

-- What a space is (its kind, organization, program or owner) never changes,
-- and a program space's name and state come from its program (a program's
-- single name is used in both languages; an empty one reads "Program").
create or replace function app.guard_space_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind
     or new.organization_id is distinct from old.organization_id
     or new.program_id is distinct from old.program_id
     or new.owner_id is distinct from old.owner_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A space''s kind, organization, program, owner and creation cannot change.'
      using errcode = '42501';
  end if;
  if old.kind = 'program' and pg_trigger_depth() = 1 and (
       new.name_en is distinct from old.name_en
       or new.name_fr is distinct from old.name_fr
       or new.description is distinct from old.description
       or new.archived_at is distinct from old.archived_at) then
    raise exception 'A program space follows its program: rename or archive the program instead.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.sync_organization_space() from public, anon, authenticated;
revoke all on function app.sync_member_private_space() from public, anon, authenticated;
revoke all on function app.sync_program_space() from public, anon, authenticated;
revoke all on function app.guard_space_update() from public, anon, authenticated;

create trigger organization_workspace_space
  after insert on public.organization
  for each row execute function app.sync_organization_space();

create trigger membership_private_space
  after insert or update of status on public.organization_membership
  for each row execute function app.sync_member_private_space();

create trigger program_space_sync
  after insert or update of name, description, status, archived_at on public.program
  for each row execute function app.sync_program_space();

create trigger space_guard_update
  before update on public.space
  for each row execute function app.guard_space_update();

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

insert into public.space (organization_id, kind, name_en, name_fr, created_by)
select o.id, 'workspace', 'Workspace', 'Espace de travail', null
from public.organization o
on conflict (organization_id) where kind = 'workspace' do nothing;

insert into public.space (organization_id, kind, owner_id, name_en, name_fr, created_by)
select m.organization_id, 'private', m.user_id, 'Private', 'Privé', null
from public.organization_membership m
where m.status = 'active'
on conflict (organization_id, owner_id) where kind = 'private' do nothing;

insert into public.space (id, organization_id, kind, program_id, name_en, name_fr, description, archived_at, created_by)
select p.id, p.organization_id, 'program', p.id,
       coalesce(left(nullif(btrim(p.name), ''), 120), 'Program'),
       coalesce(left(nullif(btrim(p.name), ''), 120), 'Programme'),
       left(p.description, 2000),
       case when p.status = 'archived' then coalesce(p.archived_at, p.updated_at) else p.archived_at end,
       p.created_by
from public.program p
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.space enable row level security;

create policy space_read on public.space
  for select to authenticated
  using (public.can_in_space(id, 'view'));

-- Only custom spaces are created by people; the others come from triggers.
create policy space_admin_create on public.space
  for insert to authenticated
  with check (kind = 'custom' and app.is_org_admin(organization_id));

-- Admins rename, describe, archive and restore the workspace and custom
-- spaces. Program spaces follow their program; private spaces are fixed.
create policy space_manage on public.space
  for update to authenticated
  using (kind in ('workspace', 'custom') and public.can_in_space(id, 'manage'))
  with check (kind in ('workspace', 'custom') and app.is_org_admin(organization_id));

revoke all on public.space from anon;
revoke all on public.space from authenticated;
grant select on public.space to authenticated;
grant insert (organization_id, kind, name_en, name_fr, description, icon) on public.space to authenticated;
grant update (name_en, name_fr, description, icon, archived_at) on public.space to authenticated;
grant all on public.space to service_role;

-- ---------------------------------------------------------------------------
-- The spaces a person can see, with what they can do in each, in one call.
-- Security invoker: the space table's own policy decides which rows come back.
-- ---------------------------------------------------------------------------

create or replace function public.my_spaces()
returns table (
  id uuid,
  organization_id uuid,
  kind text,
  program_id uuid,
  owner_id uuid,
  name_en text,
  name_fr text,
  description text,
  icon text,
  archived_at timestamptz,
  capabilities text[]
)
language sql stable security invoker
set search_path = ''
as $$
  select s.id, s.organization_id, s.kind, s.program_id, s.owner_id, s.name_en, s.name_fr,
         s.description, s.icon, s.archived_at, public.space_capabilities(s.id)
  from public.space s
  order by case s.kind when 'workspace' then 0 when 'private' then 1 when 'program' then 2 else 3 end,
           s.archived_at nulls first, lower(s.name_en);
$$;

revoke all on function public.my_spaces() from public, anon;
grant execute on function public.my_spaces() to authenticated, service_role;
