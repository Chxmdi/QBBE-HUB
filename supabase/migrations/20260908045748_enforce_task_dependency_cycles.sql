-- The API may be called without the UI's graph check. Inspect the whole graph
-- under a fixed search path without disclosing inaccessible task information.
create or replace function app.reject_task_dependency_cycle()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(727204018);
  if new.blocking_task_id = new.blocked_task_id or exists (
    with recursive reachable(id) as (
      select new.blocked_task_id
      union
      select d.blocked_task_id from public.task_dependency d
      join reachable r on d.blocking_task_id = r.id
    )
    select 1 from reachable where id = new.blocking_task_id
  ) then
    raise exception 'That dependency would create a cycle.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.reject_task_dependency_cycle() from public, anon, authenticated;
create trigger task_dependency_no_cycles
before insert or update on public.task_dependency
for each row execute function app.reject_task_dependency_cycle();
