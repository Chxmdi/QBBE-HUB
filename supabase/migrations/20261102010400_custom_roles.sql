-- Workspace OS custom roles (M10d, epic #199, stream S2).
--
-- A custom role is a named set of the seven Workspace OS capabilities (view,
-- comment, edit_content, edit_structure, manage, run_workflow, share),
-- defined by an organization's owners and admins and used in grants like the
-- built-in roles. The table and its read policy exist since M10b; this adds
-- the writes and keeps the cache right when a role changes.
--
--   * Only owners and admins with two-step sign-in write, in their own
--     organization. Built-in roles cannot be changed.
--   * A role gives view whenever it gives anything (every other capability
--     needs to see the thing first).
--   * Changing a role's capabilities refreshes everyone its grants reach.
--   * A role still used by a grant cannot be deleted: remove or change those
--     grants first, so nobody silently loses access.

-- View is implied by any other capability.
create or replace function app.normalize_access_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.caps <> 0 then
    new.caps := new.caps | 1;
  end if;
  if tg_op = 'UPDATE' and (new.organization_id, new.builtin) is distinct from (old.organization_id, old.builtin) then
    raise exception 'A role''s organization cannot change.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger access_role_normalize
  before insert or update on public.access_role
  for each row execute function app.normalize_access_role();

create or replace function app.guard_access_role_delete()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.builtin then
    raise exception 'Built-in roles cannot be deleted.' using errcode = '42501';
  end if;
  if exists (select 1 from public.access_grant g where g.role_id = old.id) then
    raise exception 'This role is still used to share something. Change or remove those shares first.'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger access_role_guard_delete
  before delete on public.access_role
  for each row execute function app.guard_access_role_delete();

-- Capabilities changed: everyone the role's grants reach, on what they reach.
create or replace function app.access_on_role_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_nodes uuid[];
  v_people uuid[];
begin
  select coalesce(array_agg(distinct n), '{}'), coalesce(array_agg(distinct p), '{}')
  into v_nodes, v_people
  from new_rows r
  join old_rows o on o.id = r.id and o.caps <> r.caps
  join public.access_grant g on g.role_id = r.id
  cross join lateral unnest(app.access_grant_nodes(g.object_id, g.reach)) n
  cross join lateral unnest(app.access_grant_people(g.principal_kind, g.user_id, g.team_id, g.org_role, g.organization_id)) p;
  perform app.access_refresh(v_nodes, v_people);
  return null;
end;
$$;

create trigger access_cache_on_role_update after update on public.access_role
  referencing old table as old_rows new table as new_rows
  for each statement execute function app.access_on_role_update();

revoke all on function app.normalize_access_role(), app.guard_access_role_delete(), app.access_on_role_update()
  from public, anon, authenticated;

create policy access_role_admin_insert on public.access_role
  for insert to authenticated
  with check (not builtin and organization_id is not null and app.is_org_admin(organization_id));

create policy access_role_admin_update on public.access_role
  for update to authenticated
  using (not builtin and organization_id is not null and app.is_org_admin(organization_id))
  with check (not builtin and organization_id is not null and app.is_org_admin(organization_id));

create policy access_role_admin_delete on public.access_role
  for delete to authenticated
  using (not builtin and organization_id is not null and app.is_org_admin(organization_id));

grant insert (organization_id, key, name_en, name_fr, caps) on public.access_role to authenticated;
grant update (name_en, name_fr, caps) on public.access_role to authenticated;
grant delete on public.access_role to authenticated;

-- How many shares use each role the caller can see: the roles screen shows
-- it, and says why a role in use cannot be deleted. Counts only; RLS on the
-- roles decides which rows come back.
create or replace function public.access_role_usage()
returns table (role_id uuid, grants bigint)
language sql stable security definer
set search_path = ''
as $$
  select r.id, count(g.id)
  from public.access_role r
  left join public.access_grant g on g.role_id = r.id
  where r.organization_id is not null and app.is_org_admin(r.organization_id)
  group by r.id;
$$;
revoke all on function public.access_role_usage() from public, anon;
grant execute on function public.access_role_usage() to authenticated, service_role;
