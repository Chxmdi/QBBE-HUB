-- W0-7 spike: one access check, app.can(object, capability), correct and fast.
--
-- NOT A MIGRATION. This folder is never applied by `supabase db reset` or by
-- the deploy: only scripts/spikes/access-spike.mjs applies it, and only to the
-- local database container. Everything lives in the `spike_access` schema, so
-- `drop schema spike_access cascade` (the script's --drop) removes the whole
-- prototype, including the triggers it adds to public tables.
--
-- The design being proved is A6 in docs/plans/workspace-os-plan.md; the
-- results are in docs/design/spikes/W0-7-access-check.md. In the real build
-- the check is app.can; here it is spike_access.can so it cannot collide with
-- the W0-3 stand-in.
--
-- Shape:
--   object        every securable thing (spaces, projects, tasks) with its
--                 ancestor chain: task -> project -> space -> workspace.
--                 A stand-in for S1's object registry.
--   space         workspace (one per organization), one per program (same id
--                 as the program), private (one per person), custom.
--   access_role   named bundles of capabilities; built-in rows below, custom
--                 roles (M10d) are more rows.
--   access_grant  role R on object O (and, if it inherits, everything under O)
--                 to a person, a team, or everyone holding an organization role.
--   access_cache  capabilities per (person, object), from person and team
--                 grants, kept current by triggers. Organization-role grants on
--                 the workspace are NOT expanded into it: they are answered
--                 live, because they depend on the session (MFA) and would
--                 otherwise mean a row per admin per object.

create schema if not exists spike_access;
revoke all on schema spike_access from public;
grant usage on schema spike_access to authenticated, service_role;

-- Capabilities are bits so one integer holds a person's whole answer for an
-- object. The seven A6 capabilities, plus review and approve, which today's
-- rules already distinguish and approvals will need.
create table spike_access.capability (
  key text primary key,
  bit integer not null unique
);
insert into spike_access.capability (key, bit) values
  ('view', 1), ('comment', 2), ('edit_content', 4), ('edit_structure', 8),
  ('manage', 16), ('run_workflow', 32), ('share', 64), ('review', 128),
  ('approve', 256);

create or replace function spike_access.cap_bit(p_capability text)
returns integer
language sql immutable parallel safe
set search_path = ''
as $$
  select case lower(coalesce(p_capability, ''))
    when 'view' then 1 when 'comment' then 2 when 'edit_content' then 4
    when 'edit_structure' then 8 when 'manage' then 16
    when 'run_workflow' then 32 when 'share' then 64
    when 'review' then 128 when 'approve' then 256
    else 0
  end;
$$;

create table spike_access.access_role (
  key text primary key,
  caps integer not null,
  -- Only answered in a session that completed MFA (today's owner/admin rule).
  requires_aal2 boolean not null default false,
  description text not null
);

-- Built-in roles. Each is the capability set today's role already has, in
-- the new vocabulary (see the design note for the mapping table):
--   read -> view + comment;  collaborate -> edit_content + run_workflow;
--   review -> edit_content + review;  approve -> edit_content + approve;
--   manage -> edit_content + edit_structure + manage + share.
insert into spike_access.access_role (key, caps, requires_aal2, description) values
  ('manager',     1|2|4|8|16|32|64|128|256, false, 'Program lead or manager, project manager'),
  ('contributor', 1|2|4|32,                 false, 'Contributor; also a task''s assignee or requester'),
  ('reviewer',    1|2|4|128,                false, 'Reviewer'),
  ('approver',    1|2|4|128|256,            false, 'Approver; also a task''s reviewer or approver column'),
  ('follower',    1|2,                      false, 'Follower'),
  ('read_only',   1|2,                      false, 'Read only'),
  ('org_reader',  1|2,                      false, 'Owner, admin and leadership viewer: read everything'),
  ('org_admin',   1|2|4|8|16|32|64|128|256, true,  'Owner and admin with MFA: everything');

create table spike_access.object (
  id uuid primary key,
  organization_id uuid not null references public.organization (id) on delete cascade,
  kind text not null check (kind in ('space', 'project', 'task')),
  parent_id uuid references spike_access.object (id) on delete cascade,
  -- Self first, then parent, grandparent... Grants on any of these apply
  -- (those above self only if they inherit).
  ancestors uuid[] not null,
  check (ancestors[1] = id)
);
create index object_ancestors_gin on spike_access.object using gin (ancestors);
create index object_parent_idx on spike_access.object (parent_id);

create table spike_access.space (
  id uuid primary key references spike_access.object (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  kind text not null check (kind in ('workspace', 'program', 'private', 'custom')),
  program_id uuid unique references public.program (id) on delete cascade,
  owner_id uuid references public.user_profile (id) on delete cascade,
  name text not null,
  check ((kind = 'program') = (program_id is not null)),
  check ((kind = 'private') = (owner_id is not null))
);
create unique index space_one_workspace on spike_access.space (organization_id)
  where kind = 'workspace';

create table spike_access.access_grant (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  object_id uuid not null references spike_access.object (id) on delete cascade,
  principal_kind text not null check (principal_kind in ('person', 'team', 'org_role')),
  user_id uuid references public.user_profile (id) on delete cascade,
  team_id uuid references public.team (id) on delete cascade,
  org_role public.org_role,
  role_key text not null references spike_access.access_role (key),
  -- false = "this object only": the grant does not flow to children.
  inherits boolean not null default true,
  -- Where the grant came from while the old tables are still the source of
  -- truth (dual write). 'direct' for grants made in the new model.
  source text not null,
  legacy_id uuid,
  check (
    (principal_kind = 'person' and user_id is not null and team_id is null and org_role is null)
    or (principal_kind = 'team' and team_id is not null and user_id is null and org_role is null)
    or (principal_kind = 'org_role' and org_role is not null and user_id is null and team_id is null)
  ),
  unique nulls not distinct (object_id, principal_kind, user_id, team_id, org_role, role_key, source, legacy_id)
);
create index access_grant_object_idx on spike_access.access_grant (object_id);
create index access_grant_user_idx on spike_access.access_grant (user_id) where user_id is not null;
create index access_grant_team_idx on spike_access.access_grant (team_id) where team_id is not null;
create index access_grant_legacy_idx on spike_access.access_grant (source, legacy_id);

create table spike_access.access_cache (
  user_id uuid not null,
  object_id uuid not null references spike_access.object (id) on delete cascade,
  organization_id uuid not null,
  caps integer not null check (caps <> 0),
  primary key (user_id, object_id)
);
create index access_cache_object_idx on spike_access.access_cache (object_id);

-- Nothing here is reachable through the API: the schema is not exposed, and
-- the tables are only read through the security-definer functions below.
revoke all on all tables in schema spike_access from public, anon, authenticated;
grant all on all tables in schema spike_access to service_role;

-- ---------------------------------------------------------------------------
-- Computing the cache
-- ---------------------------------------------------------------------------

-- The capabilities person and team grants give, for the given objects and
-- (optionally) only the given people. The single definition of inheritance:
-- a grant on the object itself always applies; a grant on an ancestor applies
-- if it inherits.
create or replace function spike_access.compute(p_objects uuid[], p_users uuid[] default null)
returns table (user_id uuid, object_id uuid, organization_id uuid, caps integer)
language sql stable
set search_path = ''
as $$
  select who.user_id, o.id, o.organization_id, bit_or(r.caps)::integer
  from spike_access.object o
  cross join lateral unnest(o.ancestors) with ordinality as a (id, depth)
  join spike_access.access_grant g
    on g.object_id = a.id
   and g.organization_id = o.organization_id
   and g.principal_kind <> 'org_role'
   and (a.depth = 1 or g.inherits)
  join spike_access.access_role r on r.key = g.role_key
  cross join lateral (
    select g.user_id where g.principal_kind = 'person'
    union all
    select tm.user_id from public.team_member tm
    where g.principal_kind = 'team' and tm.team_id = g.team_id
  ) as who (user_id)
  where o.id = any (p_objects)
    and (p_users is null or who.user_id = any (p_users))
  group by who.user_id, o.id, o.organization_id;
$$;

create or replace function spike_access.refresh(p_objects uuid[], p_users uuid[] default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_objects is null or cardinality(p_objects) = 0
     or (p_users is not null and cardinality(p_users) = 0)
     -- A bulk load (the backfill) rebuilds the whole cache once at the end.
     or current_setting('spike_access.bulk', true) = 'on' then
    return;
  end if;
  delete from spike_access.access_cache c
  where c.object_id = any (p_objects)
    and (p_users is null or c.user_id = any (p_users));
  insert into spike_access.access_cache (user_id, object_id, organization_id, caps)
  select x.user_id, x.object_id, x.organization_id, x.caps
  from spike_access.compute(p_objects, p_users) x
  where x.caps <> 0;
end;
$$;

-- An object and everything under it.
create or replace function spike_access.subtree(p_object uuid)
returns uuid[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(o.id), '{}')
  from spike_access.object o
  where o.ancestors @> array[p_object];
$$;

create or replace function spike_access.grant_people(g spike_access.access_grant)
returns uuid[]
language sql stable
set search_path = ''
as $$
  select case g.principal_kind
    when 'person' then array[g.user_id]
    when 'team' then (
      select coalesce(array_agg(tm.user_id), '{}')
      from public.team_member tm where tm.team_id = g.team_id
    )
    else '{}'::uuid[]  -- org_role grants are answered live, never cached
  end;
$$;

-- A grant changed: only its people, and only the objects it reaches.
create or replace function spike_access.on_grant_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    perform spike_access.refresh(
      case when old.inherits then spike_access.subtree(old.object_id) else array[old.object_id] end,
      spike_access.grant_people(old));
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform spike_access.refresh(
      case when new.inherits then spike_access.subtree(new.object_id) else array[new.object_id] end,
      spike_access.grant_people(new));
  end if;
  return null;
end;
$$;
create trigger refresh_cache after insert or update or delete on spike_access.access_grant
  for each row execute function spike_access.on_grant_change();

-- An object appeared or moved: recompute it (and, if it moved, everything
-- under it) for everyone. Its ancestors are maintained here too.
create or replace function spike_access.on_object_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_moved uuid[];
begin
  -- The descendants rewritten below fire this trigger too; the object that
  -- moved already refreshes all of them in one statement.
  if current_setting('spike_access.moving', true) = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform spike_access.refresh(array[new.id]);
  elsif new.ancestors is distinct from old.ancestors then
    -- Rewrite the chain of every descendant: keep the part below this object,
    -- replace the part from this object up.
    perform set_config('spike_access.moving', 'on', true);
    update spike_access.object d
    set ancestors = d.ancestors[1:array_position(d.ancestors, new.id) - 1] || new.ancestors
    where d.ancestors @> array[new.id] and d.id <> new.id;
    perform set_config('spike_access.moving', 'off', true);
    v_moved := spike_access.subtree(new.id);
    perform spike_access.refresh(v_moved);
  end if;
  return null;
end;
$$;
create trigger refresh_cache after insert or update of ancestors on spike_access.object
  for each row execute function spike_access.on_object_change();

-- Team membership changed: that person, on everything the team's grants reach.
create or replace function spike_access.on_team_member_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.team_member;
  v_objects uuid[];
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  select coalesce(array_agg(distinct s.id), '{}') into v_objects
  from spike_access.access_grant g
  cross join lateral unnest(
    case when g.inherits then spike_access.subtree(g.object_id) else array[g.object_id] end
  ) as s (id)
  where g.principal_kind = 'team' and g.team_id = v_row.team_id;
  perform spike_access.refresh(v_objects, array[v_row.user_id]);
  return null;
end;
$$;
create trigger a_spike_access_refresh after insert or delete on public.team_member
  for each row execute function spike_access.on_team_member_change();

-- ---------------------------------------------------------------------------
-- The check
-- ---------------------------------------------------------------------------

-- What each organization role gives on everything in its organization, from
-- the workspace's org_role grants: a handful of rows, kept by trigger, so the
-- check reads one row instead of joining grants and roles on every call. The
-- role and MFA are applied live at check time, so a promotion, a suspension or
-- a session without MFA takes effect on the next statement with nothing to
-- refresh.
create table spike_access.org_role_caps (
  organization_id uuid not null references public.organization (id) on delete cascade,
  org_role public.org_role not null,
  caps integer not null,        -- without MFA
  caps_aal2 integer not null,   -- in a session that completed MFA
  primary key (organization_id, org_role)
);
revoke all on spike_access.org_role_caps from public, anon, authenticated;

create or replace function spike_access.on_org_role_grant_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_organization uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
begin
  delete from spike_access.org_role_caps where organization_id = v_organization;
  insert into spike_access.org_role_caps (organization_id, org_role, caps, caps_aal2)
  select g.organization_id, g.org_role,
         coalesce(bit_or(r.caps) filter (where not r.requires_aal2), 0),
         bit_or(r.caps)
  from spike_access.access_grant g
  join spike_access.space s on s.id = g.object_id and s.kind = 'workspace'
  join spike_access.access_role r on r.key = g.role_key
  where g.principal_kind = 'org_role' and g.organization_id = v_organization
  group by g.organization_id, g.org_role;
  return null;
end;
$$;
create trigger org_role_caps_insert after insert on spike_access.access_grant
  for each row when (new.principal_kind = 'org_role')
  execute function spike_access.on_org_role_grant_change();
create trigger org_role_caps_update after update on spike_access.access_grant
  for each row when (new.principal_kind = 'org_role' or old.principal_kind = 'org_role')
  execute function spike_access.on_org_role_grant_change();
create trigger org_role_caps_delete after delete on spike_access.access_grant
  for each row when (old.principal_kind = 'org_role')
  execute function spike_access.on_org_role_grant_change();
create index access_grant_org_role_idx on spike_access.access_grant (organization_id)
  where principal_kind = 'org_role';

create or replace function spike_access.session_is_aal2()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$$;

-- app.can in the real build: one object, one capability. For a single record
-- (a page, a drawer, an action's permission check). About 60-80 microseconds a
-- call, so a list must not call it per row: lists use the set-based form
-- below, which gives the same answer from the same cache.
-- Ceilings: some organization roles cap what ANY grant can give. Today's rules
-- make an owner or admin read-only everywhere until the session completes
-- MFA, even on a project they own, and a leadership viewer read-only
-- everywhere, even with a contributor grant. Roles without a row have no
-- ceiling. Like org_role_caps this is applied live, never cached.
create table spike_access.org_role_ceiling (
  org_role public.org_role primary key,
  ceiling integer not null,        -- without MFA
  ceiling_aal2 integer not null    -- in a session that completed MFA
);
insert into spike_access.org_role_ceiling (org_role, ceiling, ceiling_aal2) values
  ('owner', 1|2, 511),
  ('admin', 1|2, 511),
  ('leadership_viewer', 1|2, 1|2);
revoke all on spike_access.org_role_ceiling from public, anon, authenticated;

-- app.can in the real build: one object, one capability. For a single record
-- (a page, a drawer, an action's permission check). About 60-80 microseconds a
-- call, so a list must not call it per row: lists use the set-based form
-- below, which gives the same answer from the same cache.
create or replace function spike_access.can(p_object uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select (coalesce(c.caps, 0)
            | case when spike_access.session_is_aal2() then coalesce(rc.caps_aal2, 0)
                   else coalesce(rc.caps, 0) end)
           & case when spike_access.session_is_aal2() then coalesce(ce.ceiling_aal2, 511)
                  else coalesce(ce.ceiling, 511) end
           & spike_access.cap_bit(p_capability) <> 0
    from spike_access.object o
    join public.organization_membership m
      on m.organization_id = o.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    left join spike_access.org_role_caps rc
      on rc.organization_id = o.organization_id and rc.org_role = m.role
    left join spike_access.org_role_ceiling ce on ce.org_role = m.role
    left join spike_access.access_cache c
      on c.user_id = m.user_id and c.object_id = o.id
    where o.id = p_object
  ), false);
$$;

-- The set-based pieces a list policy uses, evaluated once per statement like
-- the #115 policies: organizations the caller is an active member of, and
-- those where their role alone gives the capability.
create or replace function spike_access.my_orgs()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.organization_id), '{}')
  from public.organization_membership m
  where m.user_id = (select auth.uid()) and m.status = 'active';
$$;

create or replace function spike_access.orgs_where(p_capability text)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.organization_id), '{}')
  from public.organization_membership m
  join spike_access.org_role_caps rc
    on rc.organization_id = m.organization_id and rc.org_role = m.role
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and (case when spike_access.session_is_aal2() then rc.caps_aal2 else rc.caps end)
        & spike_access.cap_bit(p_capability) <> 0;
$$;

-- Objects the caller holds the capability on through person or team grants,
-- within their role's ceiling, in organizations they are active in.
-- For list queries: `id in (select spike_access.cached_ids('view'))` is a
-- semi-join on the cache's primary key.
create or replace function spike_access.cached_ids(p_capability text)
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  -- The ceiling is worked out once per organization, not once per cache row:
  -- reading the session's MFA level per row cost ~10 ms on a 1,500-row cache.
  with mine as materialized (
    select m.organization_id,
           case when spike_access.session_is_aal2() then coalesce(ce.ceiling_aal2, 511)
                else coalesce(ce.ceiling, 511) end
           & spike_access.cap_bit(p_capability) as mask
    from public.organization_membership m
    left join spike_access.org_role_ceiling ce on ce.org_role = m.role
    where m.user_id = (select auth.uid()) and m.status = 'active'
  )
  select c.object_id
  from mine
  join spike_access.access_cache c
    on c.user_id = (select auth.uid()) and c.organization_id = mine.organization_id
  where c.caps & mine.mask <> 0;
$$;

revoke all on all functions in schema spike_access from public, anon;
grant execute on function
  spike_access.can(uuid, text),
  spike_access.my_orgs(),
  spike_access.orgs_where(text),
  spike_access.cached_ids(text),
  spike_access.cap_bit(text)
  to authenticated, service_role;
