-- Project progress, workload and project task counts are counted in the
-- database.
--
-- The portfolio downloaded every task of up to 200 projects, the workload
-- chart and the People page downloaded every open task, and the project page
-- counted from its first 200 tasks. PostgREST returns at most 1,000 rows, so
-- past that the "% complete", the blocked task, the workload and the open and
-- done counts were quietly wrong. These functions return only the figures.
--
-- All three are SECURITY INVOKER: task_read applies to the rows they count
-- exactly as it did to the downloads, so each person's figures cover only the
-- tasks they may read.

create index if not exists idx_task_assignee_open
  on public.task (assignee_id, status)
  where archived_at is null and assignee_id is not null;

-- Per project: all tasks (cancelled included, as the progress bar always
-- counted them), completed tasks, the title of the earliest blocked task, and
-- whether p_member (the portfolio's person filter) has a task in it.
create or replace function public.portfolio_project_progress(p_project_ids uuid[], p_member uuid default null)
returns table (
  project_id uuid,
  total bigint,
  completed bigint,
  blocked_task_title text,
  member_has_task boolean
)
language sql stable security invoker
set search_path = ''
as $$
  select t.project_id,
    count(*),
    count(*) filter (where t.status = 'completed'),
    (array_agg(t.title order by t.created_at, t.id) filter (where t.status = 'blocked'))[1],
    coalesce(bool_or(t.assignee_id = p_member), false)
  from public.task t
  where t.project_id = any(p_project_ids)
    and t.archived_at is null
  group by t.project_id;
$$;
revoke all on function public.portfolio_project_progress(uuid[], uuid) from public, anon;
grant execute on function public.portfolio_project_progress(uuid[], uuid) to authenticated, service_role;

-- Per assignee, their open work: how many tasks, how many overdue (due before
-- p_today), how many due by p_week_out, the estimated hours and how many have
-- no estimate, and the same for the tasks due between p_today and p_week_out.
create or replace function public.open_task_workload(p_today date, p_week_out date)
returns table (
  assignee_id uuid,
  assignee_name text,
  active bigint,
  overdue bigint,
  due_soon bigint,
  estimated_hours numeric,
  unknown_estimates bigint,
  near_term_hours numeric,
  near_term_known bigint,
  near_term_unknown bigint
)
language sql stable security invoker
set search_path = ''
as $$
  select t.assignee_id,
    max(p.full_name),
    count(*),
    count(*) filter (where t.due_at < p_today),
    count(*) filter (where t.due_at >= p_today and t.due_at <= p_week_out),
    coalesce(sum(t.estimate_hours), 0),
    count(*) filter (where t.estimate_hours is null),
    coalesce(sum(t.estimate_hours) filter (where t.due_at >= p_today and t.due_at <= p_week_out), 0),
    count(*) filter (where t.estimate_hours is not null and t.due_at >= p_today and t.due_at <= p_week_out),
    count(*) filter (where t.estimate_hours is null and t.due_at >= p_today and t.due_at <= p_week_out)
  from public.task t
  left join public.user_profile p on p.id = t.assignee_id
  where t.archived_at is null
    and t.assignee_id is not null
    and t.status in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
  group by t.assignee_id;
$$;
revoke all on function public.open_task_workload(date, date) from public, anon;
grant execute on function public.open_task_workload(date, date) to authenticated, service_role;

-- One project's tasks: open (neither completed nor cancelled), completed,
-- and all of them.
create or replace function public.project_task_counts(p_project uuid)
returns table (open bigint, completed bigint, total bigint)
language sql stable security invoker
set search_path = ''
as $$
  select
    count(*) filter (where t.status not in ('completed', 'cancelled')),
    count(*) filter (where t.status = 'completed'),
    count(*)
  from public.task t
  where t.project_id = p_project
    and t.archived_at is null;
$$;
revoke all on function public.project_task_counts(uuid) from public, anon;
grant execute on function public.project_task_counts(uuid) to authenticated, service_role;
