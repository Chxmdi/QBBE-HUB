-- Two more per-page costs from the perf run's query statistics (#115).
--
-- 1. The dashboard counted each shown program's tasks with two count
--    requests per program: up to 16 requests to the API on every load. This
--    function returns the same two counts for all of them in one call. It is
--    security invoker, so row-level security limits the counts to the tasks
--    the viewer can read, exactly as the separate requests did.
--    supabase/tests/dashboard-task-summary.sql compares the two for every
--    member.
--
-- 2. Every page's sidebar counts the viewer's open tasks
--    (assignee_id = me, open status, not archived): the most frequent query
--    in the run, about 20 ms each. The only index covering assignee_id leads
--    with organization_id, which the query does not filter on. A partial
--    index on the assignee answers it directly.

create or replace function public.program_task_counts(p_program_ids uuid[])
returns table (program_id uuid, total bigint, completed bigint)
language sql stable security invoker
set search_path = ''
as $$
  select t.program_id,
         count(*),
         count(*) filter (where t.status = 'completed')
  from public.task t
  where t.program_id = any (p_program_ids)
    and t.archived_at is null
  group by t.program_id;
$$;

revoke all on function public.program_task_counts(uuid[]) from public, anon;
grant execute on function public.program_task_counts(uuid[]) to authenticated, service_role;

create index if not exists idx_task_assignee_open
  on public.task (assignee_id, status)
  where archived_at is null;
