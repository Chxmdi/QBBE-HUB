-- Workspace OS lenses: which of a list of records the viewer may edit
-- (V1-1, epic #199, stream S4).
--
-- A lens that offers a control on each record (move this task to another
-- day, drag this bar) should show it only where it will work. This asks the
-- one access question, public.can(id, 'edit_content'), for a batch of ids in
-- a single round trip. It adds no rule of its own: it is exactly public.can,
-- and it runs with the caller's rights.

create or replace function public.lens_editable(p_ids uuid[])
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct e.id
  from unnest(p_ids[1:500]) as e(id)
  where e.id is not null and public.can(e.id, 'edit_content');
$$;

revoke all on function public.lens_editable(uuid[]) from public, anon;
grant execute on function public.lens_editable(uuid[]) to authenticated, service_role;

comment on function public.lens_editable(uuid[]) is
  'Workspace OS lenses: the ids, among at most 500 given, the caller may edit (public.can edit_content).';
