-- The sidebar's "My Work" count, answered without evaluating the whole task
-- read rule (#115).
--
-- The layout counted the viewer's open, unarchived tasks on every page through
-- row-level security, which evaluates task_read for each row. It was the most
-- expensive query in the 50-user test: about 35 ms per page, on every page.
--
-- For a task assigned to the viewer, task_read (20260924200000) reduces to one
-- condition: the viewer is an active member of the task's organization. Its
-- first conjunct is that membership, and its second is a disjunction that
-- includes `assignee_id = auth.uid()`. It is the only SELECT policy on task
-- since 20260925010000. So counting assigned tasks in member organizations
-- gives the same number without the rest of the rule.
-- supabase/tests/my-open-task-count.sql compares the two for every member.

create or replace function public.my_open_task_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.task t
  where t.assignee_id = (select auth.uid())
    and t.status in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
    and t.archived_at is null
    and t.organization_id = any ((select app.task_read_member_organizations())::uuid[]);
$$;

revoke all on function public.my_open_task_count() from public, anon;
grant execute on function public.my_open_task_count() to authenticated;

comment on function public.my_open_task_count() is
  'Open, unarchived tasks assigned to the caller that task_read lets them read. '
  'supabase/tests/my-open-task-count.sql keeps it equal to the row-level-security count.';
