-- The admin audit log is read set-based, and six write rules no longer
-- overlap the read rules of their tables.
--
-- 1. audit_admin_read asked app.is_org_admin(organization_id) once per audit
--    row. It now asks once per query which organizations the caller is an
--    MFA-verified owner or admin of (the same app.is_org_admin check, per
--    membership), so the admin page reads the newest events off the
--    (organization_id, created_at desc) index.
-- 2. decision_scoped_write, issue_manage, risk_manage, task_assignment_write,
--    team_admin_write and team_member_admin_write were FOR ALL policies, so
--    every read of those tables also evaluated their write rule. Each is now
--    one INSERT, one UPDATE and one DELETE policy with the same rule; the
--    UPDATE policy checks the new row with it too, as before.
--    supabase/tests/policy-splits.sql proves that no role can read or write
--    more (or less) than before.

create or replace function app.my_admin_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_membership m
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('owner', 'admin')
    and app.is_org_admin(m.organization_id);
$$;
revoke all on function app.my_admin_organization_ids() from public, anon;
grant execute on function app.my_admin_organization_ids() to authenticated;

drop policy audit_admin_read on public.audit_event;
create policy audit_admin_read on public.audit_event
  for select to authenticated
  using (organization_id in (select app.my_admin_organization_ids()));

-- 2. The splits.
drop policy decision_scoped_write on public.decision;
create policy decision_scoped_insert on public.decision for insert to authenticated
  with check (((meeting_id is not null) and app.can_manage_meeting(meeting_id))
    or ((project_id is not null) and app.has_project_capability(project_id, 'manage'::text))
    or app.is_org_admin(organization_id));
create policy decision_scoped_update on public.decision for update to authenticated
  using (((meeting_id is not null) and app.can_manage_meeting(meeting_id))
    or ((project_id is not null) and app.has_project_capability(project_id, 'manage'::text))
    or app.is_org_admin(organization_id))
  with check (((meeting_id is not null) and app.can_manage_meeting(meeting_id))
    or ((project_id is not null) and app.has_project_capability(project_id, 'manage'::text))
    or app.is_org_admin(organization_id));
create policy decision_scoped_delete on public.decision for delete to authenticated
  using (((meeting_id is not null) and app.can_manage_meeting(meeting_id))
    or ((project_id is not null) and app.has_project_capability(project_id, 'manage'::text))
    or app.is_org_admin(organization_id));

drop policy issue_manage on public.issue;
create policy issue_manage_insert on public.issue for insert to authenticated
  with check (app.can_manage_project(project_id));
create policy issue_manage_update on public.issue for update to authenticated
  using (app.can_manage_project(project_id)) with check (app.can_manage_project(project_id));
create policy issue_manage_delete on public.issue for delete to authenticated
  using (app.can_manage_project(project_id));

drop policy risk_manage on public.risk;
create policy risk_manage_insert on public.risk for insert to authenticated
  with check (app.can_manage_project(project_id));
create policy risk_manage_update on public.risk for update to authenticated
  using (app.can_manage_project(project_id)) with check (app.can_manage_project(project_id));
create policy risk_manage_delete on public.risk for delete to authenticated
  using (app.can_manage_project(project_id));

drop policy task_assignment_write on public.task_assignment;
create policy task_assignment_insert on public.task_assignment for insert to authenticated
  with check (public.has_task_capability(task_id, 'manage'::text));
create policy task_assignment_update on public.task_assignment for update to authenticated
  using (public.has_task_capability(task_id, 'manage'::text))
  with check (public.has_task_capability(task_id, 'manage'::text));
create policy task_assignment_delete on public.task_assignment for delete to authenticated
  using (public.has_task_capability(task_id, 'manage'::text));

drop policy team_admin_write on public.team;
create policy team_admin_insert on public.team for insert to authenticated
  with check (app.is_org_admin(organization_id));
create policy team_admin_update on public.team for update to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));
create policy team_admin_delete on public.team for delete to authenticated
  using (app.is_org_admin(organization_id));

drop policy team_member_admin_write on public.team_member;
create policy team_member_admin_insert on public.team_member for insert to authenticated
  with check (app.can_manage_team(team_id));
create policy team_member_admin_update on public.team_member for update to authenticated
  using (app.can_manage_team(team_id)) with check (app.can_manage_team(team_id));
create policy team_member_admin_delete on public.team_member for delete to authenticated
  using (app.can_manage_team(team_id));
