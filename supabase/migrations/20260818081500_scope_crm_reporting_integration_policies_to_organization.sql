-- CRM, report snapshots, and provider connections contain operational and
-- personal data; staff/admin access must be scoped to the owning organization.
drop policy if exists crm_org_staff on crm_organization;
create policy crm_org_staff on crm_organization for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));
drop policy if exists crm_contact_staff on crm_contact;
create policy crm_contact_staff on crm_contact for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));
drop policy if exists crm_interaction_staff on crm_interaction;
create policy crm_interaction_staff on crm_interaction for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));
drop policy if exists crm_follow_up_staff on crm_follow_up;
create policy crm_follow_up_staff on crm_follow_up for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));

drop policy if exists report_staff_read on report_instance;
create policy report_staff_read on report_instance for select to authenticated
  using (app.is_org_staff(organization_id));
drop policy if exists report_staff_insert on report_instance;
create policy report_staff_insert on report_instance for insert to authenticated
  with check (app.is_org_staff(organization_id) and generated_by = auth.uid());
drop policy if exists report_admin_update on report_instance;
create policy report_admin_update on report_instance for update to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

drop policy if exists integration_admin on integration_connection;
create policy integration_admin on integration_connection for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));
