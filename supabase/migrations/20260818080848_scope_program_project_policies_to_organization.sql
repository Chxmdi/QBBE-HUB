-- Program and project records are organization-owned. Child tables use parent
-- helpers so a guessed UUID cannot cross an organization boundary.
create or replace function app.is_org_staff(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from organization_membership m
    where m.organization_id = p_organization
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'staff')
  );
$$;

create or replace function app.can_read_program(p_program uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from program p
    where p.id = p_program and app.is_org_member(p.organization_id)
  );
$$;

create or replace function app.can_manage_program(p_program uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from program p
    where p.id = p_program and app.is_org_staff(p.organization_id)
  );
$$;

create or replace function app.can_read_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project p
    where p.id = p_project and app.is_org_member(p.organization_id)
  );
$$;

create or replace function app.can_manage_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project p
    where p.id = p_project and app.is_org_staff(p.organization_id)
  );
$$;

revoke all on function app.is_org_staff(uuid) from public;
revoke all on function app.can_read_program(uuid) from public;
revoke all on function app.can_manage_program(uuid) from public;
revoke all on function app.can_read_project(uuid) from public;
revoke all on function app.can_manage_project(uuid) from public;
grant execute on function app.is_org_staff(uuid) to authenticated;
grant execute on function app.can_read_program(uuid) to authenticated;
grant execute on function app.can_manage_program(uuid) to authenticated;
grant execute on function app.can_read_project(uuid) to authenticated;
grant execute on function app.can_manage_project(uuid) to authenticated;

drop policy if exists program_read on program;
create policy program_read on program for select to authenticated
  using (app.is_org_member(organization_id));
drop policy if exists program_staff_insert on program;
create policy program_staff_insert on program for insert to authenticated
  with check (app.is_org_staff(organization_id));
drop policy if exists program_staff_update on program;
create policy program_staff_update on program for update to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));
drop policy if exists program_admin_delete on program;
create policy program_admin_delete on program for delete to authenticated
  using (app.is_org_admin(organization_id));

drop policy if exists program_membership_read on program_membership;
create policy program_membership_read on program_membership for select to authenticated
  using (app.can_read_program(program_id));
drop policy if exists program_membership_staff_write on program_membership;
create policy program_membership_staff_write on program_membership for all to authenticated
  using (app.can_manage_program(program_id))
  with check (app.can_manage_program(program_id));

drop policy if exists project_read on project;
create policy project_read on project for select to authenticated
  using (app.is_org_member(organization_id));
drop policy if exists project_staff_insert on project;
create policy project_staff_insert on project for insert to authenticated
  with check (app.is_org_staff(organization_id));
drop policy if exists project_staff_update on project;
create policy project_staff_update on project for update to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));
drop policy if exists project_admin_delete on project;
create policy project_admin_delete on project for delete to authenticated
  using (app.is_org_admin(organization_id));

drop policy if exists project_membership_read on project_membership;
create policy project_membership_read on project_membership for select to authenticated
  using (app.can_read_project(project_id));
drop policy if exists project_membership_staff_write on project_membership;
create policy project_membership_staff_write on project_membership for all to authenticated
  using (app.can_manage_project(project_id))
  with check (app.can_manage_project(project_id));

drop policy if exists milestone_read on milestone;
create policy milestone_read on milestone for select to authenticated
  using (app.can_read_project(project_id));
drop policy if exists milestone_staff_write on milestone;
create policy milestone_staff_write on milestone for all to authenticated
  using (app.can_manage_project(project_id))
  with check (app.can_manage_project(project_id));
