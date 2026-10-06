-- Task totals for the programs on the dashboard in one call (#115).
--
-- The dashboard's program-health panel asked for two counts per program shown
-- (all tasks, completed tasks): up to 16 requests per dashboard view, each a
-- separate trip through the API. This returns the same two figures for every
-- program in one query. It is SECURITY INVOKER, so task_read applies exactly
-- as it did to each separate count: every figure is still limited to what the
-- viewer can read.

-- task had no index on program_id, so each of those counts, and this query,
-- read every task row. The partial index covers exactly the rows counted.
create index if not exists idx_task_program_open
  on public.task (program_id, status)
  where archived_at is null;

create or replace function public.dashboard_program_task_counts(p_program_ids uuid[])
returns table (
  program_id uuid,
  total bigint,
  completed bigint
)
language sql stable security invoker
set search_path = ''
as $$
  select
    t.program_id,
    count(*),
    count(*) filter (where t.status = 'completed')
  from public.task t
  where t.program_id = any(p_program_ids)
    and t.archived_at is null
  group by t.program_id;
$$;

revoke all on function public.dashboard_program_task_counts(uuid[]) from public, anon;
grant execute on function public.dashboard_program_task_counts(uuid[])
  to authenticated, service_role;
