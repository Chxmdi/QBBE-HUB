-- activity_read answered once per query instead of once per row (PERF-001).
--
-- The problem. The Home page shows the ten newest activity rows. For staff and
-- volunteers that one query took 6 to 8 seconds with 10,000 activity rows, and
-- with 20,000 it hit the 8-second statement limit, so Home failed with an
-- error. The read rule (20260917233000) called has_project_capability,
-- has_program_capability, has_task_capability and is_org_member for every
-- row. Those are SECURITY DEFINER functions, which Postgres never inlines, and
-- each one looks the project, the membership and both grant tables up again:
-- about 1 ms a row, and a row the reader cannot see paid for every branch.
-- Every task change writes an activity row, so the table only grows.
--
-- The fix. Who can read which row does not change. The rule is restated in
-- the style task_read, project_read and program_read already use: each helper
-- returns the ids the reader can reach and is wrapped in
-- `(select ...)::uuid[]`, which Postgres runs once per statement (an
-- InitPlan) and then checks every row against with an array test.
--
--   project rows        app.readable_project_ids(), which
--                       project-program-read-equivalence.sql proves equal to
--                       has_project_capability(id, 'read');
--   program-only rows   app.readable_program_ids(), likewise for programs;
--   organization rows   app.task_read_member_organizations(), the reader's
--                       active memberships, which is is_org_member;
--   task rows           `source_id in (select id from public.task)`. That
--                       subquery is read through task_read, which
--                       task-read-equivalence.sql proves equal to
--                       has_task_capability(id, 'read'), personal tasks
--                       included. It does not depend on the row, so Postgres
--                       builds the set of readable task ids once and looks
--                       each row up in it (a hashed SubPlan). A later change
--                       to task_read carries through here by itself.
--
-- supabase/tests/activity-read-set-based.sql compares the rows every member
-- reads, at both assurance levels, with the original rule.
--
-- Also: the program page reads its feed with `program_id = ... order by
-- created_at desc limit 12`, and nothing indexed program_id, so every visit
-- read the whole table. It gets the index the project feed already has.

drop policy if exists activity_read on public.activity_event;
create policy activity_read on public.activity_event for select to authenticated
  using (
    project_id = any ((select app.readable_project_ids())::uuid[])
    or (
      project_id is null
      and program_id = any ((select app.readable_program_ids())::uuid[])
    )
    or (
      project_id is null and program_id is null
      and organization_id = any ((select app.task_read_member_organizations())::uuid[])
    )
    or (
      source_type = 'task'
      and source_id in (select t.id from public.task t)
    )
  );

comment on policy activity_read on public.activity_event is
  'Same rule as before PERF-001 (project, program-only, organization-only or '
  'readable task), evaluated once per statement. '
  'supabase/tests/activity-read-set-based.sql keeps the two identical.';

create index if not exists idx_activity_program
  on public.activity_event (program_id, created_at desc);
