-- Work, labels, status history, and activity/audit records must not cross the
-- organization encoded on each row. Task children continue to inherit task
-- visibility through their existing parent-aware policies.
drop policy if exists task_read on task;
create policy task_read on task for select to authenticated
  using (
    app.is_org_staff(organization_id)
    or (app.is_org_member(organization_id) and assignee_id = auth.uid())
  );
drop policy if exists task_member_insert on task;
create policy task_member_insert on task for insert to authenticated
  with check (app.is_org_member(organization_id));
drop policy if exists task_update on task;
create policy task_update on task for update to authenticated
  using (
    app.is_org_staff(organization_id)
    or (app.is_org_member(organization_id) and assignee_id = auth.uid())
  )
  with check (
    app.is_org_staff(organization_id)
    or (app.is_org_member(organization_id) and assignee_id = auth.uid())
  );
drop policy if exists task_admin_delete on task;
create policy task_admin_delete on task for delete to authenticated
  using (app.is_org_admin(organization_id));

drop policy if exists label_read on label;
create policy label_read on label for select to authenticated
  using (app.is_org_member(organization_id));
drop policy if exists label_staff_write on label;
create policy label_staff_write on label for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));

drop policy if exists status_update_read on project_status_update;
create policy status_update_read on project_status_update for select to authenticated
  using (app.can_read_project(project_id));
drop policy if exists status_update_staff_insert on project_status_update;
create policy status_update_staff_insert on project_status_update for insert to authenticated
  with check (app.can_manage_project(project_id) and author_id = auth.uid());

drop policy if exists activity_read on activity_event;
create policy activity_read on activity_event for select to authenticated
  using (app.is_org_member(organization_id));
drop policy if exists activity_member_insert on activity_event;
create policy activity_member_insert on activity_event for insert to authenticated
  with check (app.is_org_member(organization_id));

drop policy if exists audit_admin_read on audit_event;
create policy audit_admin_read on audit_event for select to authenticated
  using (organization_id is not null and app.is_org_admin(organization_id));
drop policy if exists audit_member_insert on audit_event;
create policy audit_member_insert on audit_event for insert to authenticated
  with check (organization_id is not null and app.is_org_member(organization_id));
