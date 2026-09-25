-- Dashboard task figures in one pass over the tasks the viewer may read (#115).
--
-- The 50-user run's query statistics (perf workflow, 2026-09-25) put the
-- dashboard's task queries at the top: seven separate scans of every readable
-- task per dashboard view (open, due this week, overdue, completed in 30 days,
-- the donut's rows, the 60-day completion series), 0.6-2 s each under load.
-- This computes the same figures in one scan. It is SECURITY INVOKER, so
-- task_read applies exactly as it did to each separate query: every figure is
-- still limited to what the viewer can read.

create or replace function public.dashboard_task_summary(
  p_today date,
  p_week_out date,
  p_month_ago timestamptz,
  p_sixty_days_ago timestamptz
)
returns table (
  open_tasks bigint,
  due_this_week bigint,
  overdue bigint,
  completed_last_30 bigint,
  donut_to_do bigint,
  donut_in_progress bigint,
  completed_at_since_sixty_days timestamptz[]
)
language sql stable security invoker
set search_path = ''
as $$
  with visible as (
    select
      t.status::text as status,
      t.due_at,
      t.completed_at,
      (t.status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
        and t.archived_at is null) as is_open
    from public.task t
    where (t.status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
           and t.archived_at is null)
       or (t.status::text = 'completed' and t.completed_at >= least(p_month_ago, p_sixty_days_ago))
  )
  select
    count(*) filter (where is_open),
    count(*) filter (where is_open and due_at >= p_today and due_at <= p_week_out),
    count(*) filter (where is_open and due_at < p_today),
    count(*) filter (where status = 'completed' and completed_at >= p_month_ago),
    count(*) filter (where is_open and (due_at is null or due_at >= p_today)
                     and status in ('not_started', 'ready')),
    count(*) filter (where is_open and (due_at is null or due_at >= p_today)
                     and status not in ('not_started', 'ready')),
    coalesce(
      array_agg(completed_at) filter (where status = 'completed' and completed_at >= p_sixty_days_ago),
      '{}'
    )
  from visible;
$$;

revoke all on function public.dashboard_task_summary(date, date, timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_task_summary(date, date, timestamptz, timestamptz)
  to authenticated, service_role;

-- task_assigned_actor_read (20260914155347) admitted an active member to tasks
-- they are the assignee or requester of. task_read, since 20260924200000, has
-- both of those branches under the same active-membership condition, so this
-- policy adds no access; it only adds a per-row app.is_org_member call to
-- every task read, because permissive policies are OR'd and each is evaluated.
-- supabase/tests/task-read-equivalence.sql compares the table's effective
-- visibility with has_task_capability(id, 'read'), with or without it.
drop policy if exists task_assigned_actor_read on public.task;
