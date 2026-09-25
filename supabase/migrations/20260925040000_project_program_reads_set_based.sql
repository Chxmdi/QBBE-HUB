-- Project, program and milestone reads answered once per query (#115).
--
-- After the channel change, the perf run's query statistics put the board's
-- task list (about 390 ms a call) at the top, followed by the project list
-- (about 75 ms, on every page with a project picker), the project count
-- (about 135 ms), the program list and the milestone list. All of them read
-- projects or programs, directly or through an embed such as the board's
-- `project:project_id(id, name)`, and every one of those rows called
-- has_project_capability / has_program_capability, which join the project,
-- the reader's membership and both grant tables again.
--
-- Who can read what does not change. has_project_capability(id, 'read') is
-- true exactly when the reader is an active member of the project's
-- organization and either holds an organization-wide role there (owner,
-- admin, leadership viewer) or the project is one app.task_read_projects()
-- lists (that helper confirms each candidate with has_project_capability
-- itself). Programs are the same with app.task_read_programs(). Both helpers
-- and app.task_read_organization_wide() only count active memberships, so the
-- membership condition is carried by them.
-- supabase/tests/project-program-read-equivalence.sql compares every member's
-- visible rows with the original functions.

-- Every project the reader can read, for tables that only carry project_id.
create or replace function app.readable_project_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}')
  from public.project p
  where p.organization_id = any ((select app.task_read_organization_wide())::uuid[])
     or p.id = any ((select app.task_read_projects())::uuid[]);
$$;

-- Every program the reader can read, for tables that only carry program_id.
create or replace function app.readable_program_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}')
  from public.program p
  where p.organization_id = any ((select app.task_read_organization_wide())::uuid[])
     or p.id = any ((select app.task_read_programs())::uuid[]);
$$;

revoke all on function app.readable_project_ids(), app.readable_program_ids() from public, anon;
grant execute on function app.readable_project_ids(), app.readable_program_ids()
  to authenticated, service_role;

drop policy if exists project_read on public.project;
create policy project_read on public.project for select to authenticated
  using (
    organization_id = any ((select app.task_read_organization_wide())::uuid[])
    or id = any ((select app.task_read_projects())::uuid[])
  );

drop policy if exists program_read on public.program;
create policy program_read on public.program for select to authenticated
  using (
    organization_id = any ((select app.task_read_organization_wide())::uuid[])
    or id = any ((select app.task_read_programs())::uuid[])
  );

drop policy if exists milestone_read on public.milestone;
create policy milestone_read on public.milestone for select to authenticated
  using (project_id = any ((select app.readable_project_ids())::uuid[]));

drop policy if exists project_membership_read on public.project_membership;
create policy project_membership_read on public.project_membership for select to authenticated
  using (project_id = any ((select app.readable_project_ids())::uuid[]));

drop policy if exists program_membership_read on public.program_membership;
create policy program_membership_read on public.program_membership for select to authenticated
  using (program_id = any ((select app.readable_program_ids())::uuid[]));
