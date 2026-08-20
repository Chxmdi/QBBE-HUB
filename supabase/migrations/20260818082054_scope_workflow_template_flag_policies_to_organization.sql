drop policy if exists workflow_rule_read on workflow_rule;
create policy workflow_rule_read on workflow_rule for select to authenticated
  using (app.is_org_member(organization_id));
drop policy if exists workflow_rule_admin_write on workflow_rule;
create policy workflow_rule_admin_write on workflow_rule for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

drop policy if exists project_template_read on project_template;
create policy project_template_read on project_template for select to authenticated
  using (app.is_org_member(organization_id));
drop policy if exists project_template_staff_write on project_template;
create policy project_template_staff_write on project_template for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));

drop policy if exists feature_flag_read on feature_flag;
create policy feature_flag_read on feature_flag for select to authenticated
  using (organization_id is null or app.is_org_member(organization_id));
drop policy if exists feature_flag_admin_write on feature_flag;
create policy feature_flag_admin_write on feature_flag for all to authenticated
  using (organization_id is null or app.is_org_admin(organization_id))
  with check (organization_id is null or app.is_org_admin(organization_id));
