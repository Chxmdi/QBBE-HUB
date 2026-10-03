-- Personal tasks (staging audit B1).
--
-- A task with no project and no program could only be created by an
-- administrator, yet Capture offered every staff member "Task, no project"
-- and failed with a row-level security error after they had filled it in.
-- Decision (2026-10-03): staff may keep personal tasks. The person who
-- creates one manages it; whoever they assign, request, review or approve
-- keeps the access those roles already give; owners, admins and leadership
-- viewers still read every task in the organization. Volunteers and guests
-- still cannot create a task outside work they belong to.

-- 1. Creating: the existing scoped rule, or a personal task the caller owns.
drop policy if exists task_scoped_insert on public.task;
create policy task_scoped_insert on public.task for insert to authenticated
  with check (
    public.can_create_scoped_task(organization_id, program_id, project_id)
    or (
      project_id is null and program_id is null
      and created_by = (select auth.uid())
      and app.is_org_staff(organization_id)
    )
  );

-- 2. The creator of a personal task may read, manage, collaborate on and
--    follow it. Everything else is unchanged.
create or replace function app.has_task_capability(
  p_task uuid,
  p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.task t
    join public.organization_membership m
      on m.organization_id = t.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where t.id = p_task
      and lower(coalesce(p_capability, '')) in (
        'read', 'manage', 'collaborate', 'review', 'approve', 'follow'
      )
      and not (
        m.role in ('owner', 'admin')
        and lower(p_capability) <> 'read'
        and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2'
      )
      and not (
        m.role = 'leadership_viewer'
        and lower(p_capability) <> 'read'
      )
      and (
        (
          m.role in ('owner', 'admin')
          and (
            lower(p_capability) = 'read'
            or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
          )
        )
        or (m.role = 'leadership_viewer' and lower(p_capability) = 'read')
        or (
          t.project_id is not null
          and app.has_project_capability(t.project_id, p_capability)
        )
        or (
          t.project_id is null and t.program_id is not null
          and app.has_program_capability(t.program_id, p_capability)
        )
        or (
          t.project_id is null and t.program_id is null
          and t.created_by = (select auth.uid())
          and lower(p_capability) in ('read', 'manage', 'collaborate', 'follow')
        )
        or (
          t.assignee_id = (select auth.uid())
          and lower(p_capability) in ('read', 'collaborate')
        )
        or (
          t.requester_id = (select auth.uid())
          and lower(p_capability) in ('read', 'collaborate')
        )
        or (
          t.reviewer_id = (select auth.uid())
          and lower(p_capability) in ('read', 'review', 'approve')
        )
        or (
          t.approver_id = (select auth.uid())
          and lower(p_capability) in ('read', 'review', 'approve')
        )
        or exists (
          select 1
          from public.task_assignment ta
          where ta.task_id = t.id
            and ta.user_id = (select auth.uid())
            and lower(p_capability) = any (
              case ta.role
                when 'contributor' then array['read', 'collaborate']
                when 'reviewer' then array['read', 'review']
                when 'approver' then array['read', 'review', 'approve']
                when 'follower' then array['read', 'follow']
                else array[]::text[]
              end
            )
        )
      )
  );
$$;


-- 3. Reading, kept identical to has_task_capability(id, 'read')
--    (supabase/tests/task-read-equivalence.sql).
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
      or (
        project_id is null and program_id is null
        and created_by = (select auth.uid())
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
