-- Workspace OS: the real app.can, with a cached access table refreshed by
-- triggers (M10c, epic #199, stream S2). Replaces the W0-3 stand-in; same
-- signature, same answers for tasks and projects (proved in
-- supabase/tests/spaces-can-equivalence.sql), and now spaces, programs and
-- Workspace OS objects too.
--
-- As the W0-7 spike recommends:
--   * app.access_cache holds, per (person, node), the bits person, team and
--     organization-role grants give. Triggers keep it current, a statement
--     at a time: a grant change recomputes only its people on the nodes it
--     reaches; a new or moved node recomputes that node and everything under
--     it; a team or role change recomputes that person where it matters.
--   * Organization-wide roles, membership, two-step sign-in, private and
--     archived spaces are applied live on top (app.access_finish_bits), so
--     they take effect on the next statement with nothing to refresh.
--   * Two forms of one check, from the same cache:
--       app.can(object_id, capability)       one record (a page, a drawer,
--                                            an action's permission check)
--       the list form, for queries over many rows, evaluated once per
--       statement like the #115 policies (never app.can per row):
--         organization_id = any ((select app.access_orgs_where('view'))::uuid[])
--           and not (id = any ((select app.access_private_ids())::uuid[]))
--         or id in (select app.access_cached_ids('view'))
--     The (select ...) wrappers make Postgres evaluate each piece once per
--     statement instead of once per row. For native tasks and projects the
--     private part can be left out: they are never in a private space.

create table app.access_cache (
  user_id uuid not null,
  object_id uuid not null references app.access_node (id) on delete cascade,
  organization_id uuid not null,
  caps integer not null check (caps <> 0),
  primary key (user_id, object_id)
);
create index access_cache_object_idx on app.access_cache (object_id);

alter table app.access_cache enable row level security;
revoke all on app.access_cache from public, anon, authenticated;
grant all on app.access_cache to service_role;

comment on table app.access_cache is
  'Workspace OS access cache (M10c): bits from person, team and organization-role grants per (person, node). Kept by triggers; organization-wide roles, membership and MFA are applied live.';

-- ---------------------------------------------------------------------------
-- Computing and refreshing
-- ---------------------------------------------------------------------------

-- The bits grants give, for the given nodes and (optionally) only the given
-- people. The single definition of inheritance and of who a grant reaches.
create or replace function app.access_compute(p_nodes uuid[], p_users uuid[] default null)
returns table (user_id uuid, object_id uuid, organization_id uuid, caps integer)
language sql stable security definer
set search_path = ''
as $$
  select who.user_id, o.id, o.organization_id, bit_or(r.caps)::integer
  from app.access_node o
  cross join lateral unnest(o.ancestors) with ordinality as a (id, depth)
  join public.access_grant g
    on g.object_id = a.id
   and g.organization_id = o.organization_id
   and (a.depth = 1 or g.reach = 'subtree'
        or (g.reach = 'self_and_child_tasks' and a.depth = 2 and o.kind = 'task'))
  join public.access_role r on r.id = g.role_id
  cross join lateral (
    select g.user_id where g.principal_kind = 'person'
    union all
    select tm.user_id from public.team_member tm
    where g.principal_kind = 'team' and tm.team_id = g.team_id
    union all
    select m.user_id from public.organization_membership m
    where g.principal_kind = 'org_role' and m.organization_id = g.organization_id
      and m.role = g.org_role and m.status = 'active'
  ) as who (user_id)
  where o.id = any (p_nodes)
    and (p_users is null or who.user_id = any (p_users))
  group by who.user_id, o.id, o.organization_id;
$$;

create or replace function app.access_refresh(p_nodes uuid[], p_users uuid[] default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_nodes is null or cardinality(p_nodes) = 0 or (p_users is not null and cardinality(p_users) = 0) then
    return;
  end if;
  delete from app.access_cache c
  where c.object_id = any (p_nodes) and (p_users is null or c.user_id = any (p_users));
  insert into app.access_cache (user_id, object_id, organization_id, caps)
  select x.user_id, x.object_id, x.organization_id, x.caps
  from app.access_compute(p_nodes, p_users) x
  where x.caps <> 0
  on conflict (user_id, object_id) do update set caps = excluded.caps;
end;
$$;

-- The nodes a grant reaches.
create or replace function app.access_grant_nodes(p_object uuid, p_reach text)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select case p_reach
    when 'self' then array[p_object]
    when 'self_and_child_tasks' then array[p_object] || coalesce((
      select array_agg(n.id) from app.access_node n
      where n.parent_id = p_object and n.kind = 'task'), '{}')
    else coalesce((select array_agg(n.id) from app.access_node n where n.ancestors @> array[p_object]), array[p_object])
  end;
$$;

-- The people a grant reaches.
create or replace function app.access_grant_people(
  p_kind text, p_user uuid, p_team uuid, p_role public.org_role, p_organization uuid
)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select case p_kind
    when 'person' then array[p_user]
    when 'team' then coalesce((select array_agg(tm.user_id) from public.team_member tm where tm.team_id = p_team), '{}')
    else coalesce((select array_agg(m.user_id) from public.organization_membership m
                   where m.organization_id = p_organization and m.role = p_role), '{}')
  end;
$$;

-- Grants changed: for each, its people on the nodes it reaches. Statement
-- level, so the task triggers' bulk rewrite is one refresh per statement.
-- Transition tables are named per event, so one trigger per event.
create or replace function app.access_on_grant_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_nodes uuid[];
  v_people uuid[];
begin
  select coalesce(array_agg(distinct n), '{}'), coalesce(array_agg(distinct p), '{}') into v_nodes, v_people
  from new_rows g
  cross join lateral unnest(app.access_grant_nodes(g.object_id, g.reach)) n
  cross join lateral unnest(app.access_grant_people(g.principal_kind, g.user_id, g.team_id, g.org_role, g.organization_id)) p;
  perform app.access_refresh(v_nodes, v_people);
  return null;
end;
$$;

create or replace function app.access_on_grant_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_nodes uuid[];
  v_people uuid[];
begin
  -- A node being deleted takes its grants with it (cascade): nothing under it
  -- is left to refresh, and its cache rows go by cascade too.
  select coalesce(array_agg(distinct n), '{}'), coalesce(array_agg(distinct p), '{}') into v_nodes, v_people
  from old_rows g
  cross join lateral unnest(app.access_grant_nodes(g.object_id, g.reach)) n
  cross join lateral unnest(app.access_grant_people(g.principal_kind, g.user_id, g.team_id, g.org_role, g.organization_id)) p;
  perform app.access_refresh(v_nodes, v_people);
  return null;
end;
$$;

create or replace function app.access_on_grant_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_nodes uuid[];
  v_people uuid[];
begin
  with changed as (select * from old_rows union all select * from new_rows)
  select coalesce(array_agg(distinct n), '{}'), coalesce(array_agg(distinct p), '{}') into v_nodes, v_people
  from changed g
  cross join lateral unnest(app.access_grant_nodes(g.object_id, g.reach)) n
  cross join lateral unnest(app.access_grant_people(g.principal_kind, g.user_id, g.team_id, g.org_role, g.organization_id)) p;
  perform app.access_refresh(v_nodes, v_people);
  return null;
end;
$$;

create trigger access_cache_on_insert after insert on public.access_grant
  referencing new table as new_rows for each statement execute function app.access_on_grant_insert();
create trigger access_cache_on_delete after delete on public.access_grant
  referencing old table as old_rows for each statement execute function app.access_on_grant_delete();
create trigger access_cache_on_update after update on public.access_grant
  referencing old table as old_rows new table as new_rows for each statement execute function app.access_on_grant_update();

-- New nodes and moved nodes: recompute them for everyone. A move rewrites
-- the chains below it in a second statement, which lands here too.
create or replace function app.access_on_node_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform app.access_refresh(array(select id from new_rows));
  return null;
end;
$$;

create or replace function app.access_on_node_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform app.access_refresh(array(
    select n.id from new_rows n join old_rows o on o.id = n.id
    where n.ancestors is distinct from o.ancestors));
  return null;
end;
$$;

create trigger access_cache_on_insert after insert on app.access_node
  referencing new table as new_rows for each statement execute function app.access_on_node_insert();
create trigger access_cache_on_update after update on app.access_node
  referencing old table as old_rows new table as new_rows for each statement execute function app.access_on_node_update();

-- Someone joined or left a team: that person, wherever the team's grants reach.
create or replace function app.access_on_team_member()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_row record;
  v_nodes uuid[];
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  select coalesce(array_agg(distinct n), '{}') into v_nodes
  from public.access_grant g
  cross join lateral unnest(app.access_grant_nodes(g.object_id, g.reach)) n
  where g.principal_kind = 'team' and g.team_id = v_row.team_id;
  perform app.access_refresh(v_nodes, array[v_row.user_id]);
  return null;
end;
$$;

create trigger zz_access_cache after insert or delete on public.team_member
  for each row execute function app.access_on_team_member();

-- Someone's organization role or status changed: that person, wherever
-- organization-role grants in the organization reach.
create or replace function app.access_on_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_row record;
  v_nodes uuid[];
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'UPDATE' and (new.role, new.status) is not distinct from (old.role, old.status) then
    return null;
  end if;
  select coalesce(array_agg(distinct n), '{}') into v_nodes
  from public.access_grant g
  cross join lateral unnest(app.access_grant_nodes(g.object_id, g.reach)) n
  where g.principal_kind = 'org_role' and g.organization_id = v_row.organization_id;
  perform app.access_refresh(v_nodes, array[v_row.user_id]);
  return null;
end;
$$;

create trigger zz_access_cache after insert or update of role, status or delete on public.organization_membership
  for each row execute function app.access_on_membership();

-- Rebuild everything from the grants: the backfill, and what the tests
-- compare the trigger-maintained cache against.
create or replace function app.access_rebuild_cache()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  delete from app.access_cache;
  insert into app.access_cache (user_id, object_id, organization_id, caps)
  select x.user_id, x.object_id, x.organization_id, x.caps
  from app.access_compute(array(select id from app.access_node)) x
  where x.caps <> 0;
end;
$$;

select app.access_rebuild_cache();

-- ---------------------------------------------------------------------------
-- One record: app.access_bits (M10b's name, used by policies) and app.can
-- ---------------------------------------------------------------------------

create or replace function app.access_bits(p_node uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select app.access_finish_bits(
      m.role,
      coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2',
      n.in_private, n.archived, c.caps)
    from app.access_node n
    join public.organization_membership m
      on m.organization_id = n.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    left join app.access_cache c on c.user_id = m.user_id and c.object_id = n.id
    where n.id = p_node
  ), 0);
$$;

-- The one access question (plan A6). Same signature as the W0-3 stand-in:
-- signed out, an unknown object, an unknown capability or a null is false.
-- Today's capability names (read, collaborate, review, approve, follow) are
-- still accepted and mean what they mean today.
create or replace function app.can(object_id uuid, capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and app.cap_bit(capability) <> 0
    and app.access_bits(object_id) & app.cap_bit(capability) <> 0;
$$;

comment on function app.can(uuid, text) is
  'Workspace OS access check (M10c): one record at a time. Reads app.access_cache; organization roles, membership and MFA are applied live. Lists use the set-based form (app.access_cached_ids and friends), never app.can per row.';

-- ---------------------------------------------------------------------------
-- The list form
-- ---------------------------------------------------------------------------

-- Organizations where the caller's role alone gives the capability on
-- everything that is not in a private space.
create or replace function app.access_orgs_where(p_capability text)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.organization_id), '{}')
  from public.organization_membership m
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and app.access_finish_bits(m.role, coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2', false, false, 0)
        & app.cap_bit(p_capability) <> 0
    and app.cap_bit(p_capability) <> 0;
$$;

-- Nodes the caller holds the capability on through grants (with the live
-- rules applied): a semi-join on the cache's primary key.
create or replace function app.access_cached_ids(p_capability text)
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select c.object_id
  from app.access_cache c
  join public.organization_membership m
    on m.organization_id = c.organization_id and m.user_id = c.user_id and m.status = 'active'
  join app.access_node n on n.id = c.object_id
  where c.user_id = (select auth.uid())
    and app.cap_bit(p_capability) <> 0
    and app.access_finish_bits(m.role, coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2',
          n.in_private, n.archived, c.caps) & app.cap_bit(p_capability) <> 0;
$$;

-- Nodes in private spaces in the caller's organizations, which the
-- organization-wide part of the list form must leave out.
create or replace function app.access_private_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(n.id), '{}')
  from app.access_node n
  join public.organization_membership m
    on m.organization_id = n.organization_id and m.user_id = (select auth.uid()) and m.status = 'active'
  where n.in_private;
$$;

revoke all on function app.access_compute(uuid[], uuid[]), app.access_refresh(uuid[], uuid[]),
  app.access_grant_nodes(uuid, text), app.access_grant_people(text, uuid, uuid, public.org_role, uuid),
  app.access_on_grant_insert(), app.access_on_grant_delete(), app.access_on_grant_update(),
  app.access_on_node_insert(), app.access_on_node_update(), app.access_on_team_member(),
  app.access_on_membership(), app.access_rebuild_cache()
  from public, anon, authenticated;
revoke all on function app.access_orgs_where(text), app.access_cached_ids(text), app.access_private_ids()
  from public, anon;
-- Policies (which run as the signed-in role) call the list-form pieces.
grant execute on function app.access_orgs_where(text), app.access_cached_ids(text), app.access_private_ids()
  to authenticated, service_role;
grant execute on function app.access_compute(uuid[], uuid[]), app.access_rebuild_cache() to service_role;
