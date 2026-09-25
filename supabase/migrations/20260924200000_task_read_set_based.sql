-- task_read, answered once per query instead of once per row (#115).
--
-- The policy was `has_task_capability(id, 'read')`. That function looks the
-- task up again by id, joins the reader's membership, and for project tasks
-- calls has_project_capability, which joins the project, membership and both
-- grant tables in turn. Postgres ran all of it for every row it considered:
-- about 1.7 ms a task, so `count(*)` over the 2,000-task performance fixture
-- took 3.5 s and the dashboard 8-15 s for one person, 35 s at the 95th
-- percentile with 50 (#115, QA-FINAL "p95 interaction <= 2 s").
--
-- Who can read a task does not change. The same rule is restated so that the
-- expensive part depends only on the reader, not the row: each helper below
-- returns the ids the reader can reach, and the policy wraps each call in
-- `(select ...)::uuid[]`, which Postgres evaluates once per statement (an
-- InitPlan) and then checks every row against with an array membership test.
-- The cast matters: `x = any ((select f()))` would be read as a subquery
-- yielding one uuid[] row and compared as uuid = uuid[].
--
-- Project and program readability are still decided by has_project_capability
-- and has_program_capability themselves, only over the few candidates a
-- non-administrator could possibly read, so a later change to either function
-- carries through here. supabase/tests/task-read-equivalence.sql checks the new
-- policy against has_task_capability(id, 'read') for every member and task.

-- Organizations the reader is an active member of. Every read path requires
-- this for the task's own organization.
create or replace function app.task_read_member_organizations()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.organization_id), '{}')
  from public.organization_membership m
  where m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

-- Organizations where the reader reads every task by role: owner, admin and
-- leadership viewer. Reading never needs AAL2, so the assurance level does not
-- enter into it (has_task_capability only asks for AAL2 on other capabilities).
create or replace function app.task_read_organization_wide()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.organization_id), '{}')
  from public.organization_membership m
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('owner', 'admin', 'leadership_viewer');
$$;

-- Projects the reader can read by their own relationship to the project.
-- has_project_capability grants a non-administrator read only through project
-- ownership, a project grant, or a grant on the project's program, so those
-- are the only candidates; each is then confirmed by has_project_capability.
create or replace function app.task_read_projects()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(candidate.id), '{}')
  from (
    select p.id
    from public.project p
    where p.owner_id = (select auth.uid())
    union
    select g.project_id
    from public.project_access_grant g
    where g.user_id = (select auth.uid())
    union
    select p.id
    from public.project p
    join public.program_access_grant g on g.program_id = p.program_id
    where g.user_id = (select auth.uid())
  ) as candidate
  where app.has_project_capability(candidate.id, 'read');
$$;

-- Programs, likewise: a non-administrator reads a program only as its lead or
-- through a program grant.
create or replace function app.task_read_programs()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(candidate.id), '{}')
  from (
    select p.id
    from public.program p
    where p.lead_id = (select auth.uid())
    union
    select g.program_id
    from public.program_access_grant g
    where g.user_id = (select auth.uid())
  ) as candidate
  where app.has_program_capability(candidate.id, 'read');
$$;

-- Tasks the reader holds an explicit role on. Every task_assignment role that
-- exists includes read.
create or replace function app.task_read_assignments()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct ta.task_id), '{}')
  from public.task_assignment ta
  where ta.user_id = (select auth.uid())
    and ta.role::text in ('contributor', 'reviewer', 'approver', 'follower');
$$;

revoke all on function
  app.task_read_member_organizations(),
  app.task_read_organization_wide(),
  app.task_read_projects(),
  app.task_read_programs(),
  app.task_read_assignments()
  from public, anon;
grant execute on function
  app.task_read_member_organizations(),
  app.task_read_organization_wide(),
  app.task_read_projects(),
  app.task_read_programs(),
  app.task_read_assignments()
  to authenticated, service_role;

drop policy if exists task_read on public.task;
create policy task_read on public.task for select to authenticated
  using (
    organization_id = any ((select app.task_read_member_organizations())::uuid[])
    and (
      organization_id = any ((select app.task_read_organization_wide())::uuid[])
      or project_id = any ((select app.task_read_projects())::uuid[])
      or (
        project_id is null
        and program_id = any ((select app.task_read_programs())::uuid[])
      )
      or assignee_id = (select auth.uid())
      or requester_id = (select auth.uid())
      or reviewer_id = (select auth.uid())
      or approver_id = (select auth.uid())
      or id = any ((select app.task_read_assignments())::uuid[])
    )
  );

comment on policy task_read on public.task is
  'Same rule as has_task_capability(id, ''read''), evaluated once per statement '
  '(#115). supabase/tests/task-read-equivalence.sql keeps the two identical.';
