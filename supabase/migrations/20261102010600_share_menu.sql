-- Workspace OS share menu support (M10f, epic #199, stream S2).
--
-- The share menu shows who has access to a space or page, including access
-- inherited from the spaces and pages above it ("inherited from Space X").
-- The parent chain lives in app.access_node, which is not reachable through
-- the API, so this gives it out, only to someone who can view the node.
-- Grants and names are then read through their own tables' RLS, so the menu
-- never shows a grant or a name the reader could not read anyway.

create or replace function public.access_ancestors(object_id uuid)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select case when app.access_bits(access_ancestors.object_id) & 1 <> 0
    then (select n.ancestors from app.access_node n where n.id = access_ancestors.object_id)
  end;
$$;

revoke all on function public.access_ancestors(uuid) from public, anon;
grant execute on function public.access_ancestors(uuid) to authenticated, service_role;

comment on function public.access_ancestors(uuid) is
  'Workspace OS (M10f): a node and the nodes above it, nearest first, for the share menu. Null unless the caller can view the node.';
