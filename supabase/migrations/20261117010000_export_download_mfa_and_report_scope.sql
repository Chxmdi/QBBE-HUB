-- QBBE Hub — exports: two-step verification to read an admin's exports, and a
-- report capability check the export job can ask about the requester.
--
-- SEC-003. The read policy on export_job let anyone read the exports they
-- requested, with no check of how they signed in. An administrator's
-- exports hold organization-wide data (everything we hold, every report,
-- every task), and an administrator who signed in with only a password (the
-- session's "assurance level" is aal1 until the second factor is entered)
-- could list and download them. Someone with a phished admin password could
-- take a copy of everything for the seven days an export lives.
--
-- The new rule:
--   * an administrator at aal2 (app.is_org_admin) reads every export in the
--     organization, as before;
--   * the person an export is about (subject_user_id) still reads it: it is
--     their own data;
--   * anyone else reads an export they requested only if it is one of the
--     kinds staff may request AND they do not hold an owner/admin role.
--     An owner/admin's own requests are therefore readable only at aal2,
--     because what they get back is scoped to everything an admin can see.
--
-- SEC-006. The report bundle export is built by a job that runs with the
-- service role, where row-level security does not apply and auth.uid() is
-- empty, so app.can_read_report cannot be used. It took every report in the
-- organization, including reports on programs the requester cannot open.
-- app.actor_can_read_report(p_user, p_report) gives the same answer
-- app.can_read_report gives that person when signed in, the way
-- actor_has_project_capability mirrors has_project_capability for the task
-- history export. Only the service role may call it: it answers questions
-- about other people.

-- ---------------------------------------------------------------------------
-- Does the caller hold an owner/admin role here, whatever their sign-in level?
-- ---------------------------------------------------------------------------
create or replace function app.holds_org_admin_role(p_organization uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.organization_membership m
    where m.organization_id = p_organization
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function app.holds_org_admin_role(uuid) from public, anon;
grant execute on function app.holds_org_admin_role(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- export_job read policy
-- ---------------------------------------------------------------------------
drop policy if exists export_job_read on public.export_job;
create policy export_job_read on public.export_job for select to authenticated
using (
  app.is_org_member(organization_id)
  and (
    app.is_org_admin(organization_id)
    or subject_user_id = (select auth.uid())
    or (
      requested_by = (select auth.uid())
      and kind in ('crm_contacts', 'task_history', 'report_bundle')
      and not app.holds_org_admin_role(organization_id)
    )
  )
);

-- ---------------------------------------------------------------------------
-- May this person read this report? (for the service-role export job)
-- ---------------------------------------------------------------------------
create or replace function app.actor_can_read_report(p_user uuid, p_report uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1
    from public.report_instance r
    join public.organization_membership mem
      on mem.organization_id = r.organization_id
     and mem.user_id = p_user
     and mem.status = 'active'
    where r.id = p_report
      and (
        mem.role in ('owner', 'admin', 'leadership_viewer')
        or (
          r.project_id is not null
          and app.actor_has_project_capability(p_user, r.project_id, 'read')
        )
        or (
          r.program_id is not null
          and app.actor_has_program_capability(p_user, r.program_id, 'read')
        )
      )
  );
$$;

-- The API reaches the public schema; the job calls this one.
create or replace function public.actor_can_read_report(p_user uuid, p_report uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.actor_can_read_report(p_user, p_report);
$$;

revoke all on function app.actor_can_read_report(uuid, uuid) from public, anon, authenticated;
revoke all on function public.actor_can_read_report(uuid, uuid) from public, anon, authenticated;
grant execute on function app.actor_can_read_report(uuid, uuid) to service_role;
grant execute on function public.actor_can_read_report(uuid, uuid) to service_role;
