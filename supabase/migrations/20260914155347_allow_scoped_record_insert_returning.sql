-- Preserve the existing read branches without querying the row being inserted.
-- INSERT checks still independently enforce creation scope.
create policy task_assigned_actor_read on public.task for select to authenticated
using (app.is_org_member(organization_id) and (
  assignee_id = (select auth.uid()) or requester_id = (select auth.uid())
));
create policy report_scope_read on public.report_instance for select to authenticated
using (app.is_org_member(organization_id) and (
  app.is_org_admin(organization_id)
  or (project_id is not null and public.has_project_capability(project_id, 'read'))
  or (program_id is not null and public.has_program_capability(program_id, 'read'))
));
