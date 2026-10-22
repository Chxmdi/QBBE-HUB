-- SEC-003: an administrator who signed in with only a password (aal1) must
-- not be able to read the exports they requested; finishing two-step
-- verification (aal2) opens them again. Staff and the subject of a
-- person export keep their own access.
-- SEC-006: app.actor_can_read_report answers "may this person read this
-- report?" for the export job, which runs without a user session, and gives
-- the same answer app.can_read_report gives that person when signed in.
-- Run after qa-users.sql and rls.sql. All test mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_org_export uuid;
  v_bundle_export uuid;
  v_staff_export uuid;
  v_subject_export uuid;
  v_open_program uuid;
  v_closed_program uuid;
  v_open_report uuid;
  v_closed_report uuid;
  v_org_report uuid;
  n integer;
  ok boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_admin;

  -- Exports -----------------------------------------------------------------
  insert into public.export_job (organization_id, kind, requested_by, status, storage_path, completed_at)
  values (v_org, 'organization_data', v_admin, 'ready', v_org || '/sec003-org.json', now())
  returning id into v_org_export;
  insert into public.export_job (organization_id, kind, requested_by, status, storage_path, completed_at)
  values (v_org, 'report_bundle', v_admin, 'ready', v_org || '/sec003-bundle.json', now())
  returning id into v_bundle_export;
  insert into public.export_job (organization_id, kind, requested_by, status, storage_path, completed_at)
  values (v_org, 'report_bundle', v_staff, 'ready', v_org || '/sec003-staff.json', now())
  returning id into v_staff_export;
  insert into public.export_job (organization_id, kind, requested_by, subject_user_id, status, storage_path, completed_at)
  values (v_org, 'person_data', v_admin, v_staff, 'ready', v_org || '/sec003-subject.json', now())
  returning id into v_subject_export;

  perform tests.authenticate(v_admin, 'aal1');
  select count(*) into n from public.export_job where id = v_org_export;
  perform tests.ok(n = 0, 'SEC-003: an aal1 admin cannot read their own organization_data export');
  select count(*) into n from public.export_job where id = v_bundle_export;
  perform tests.ok(n = 0, 'SEC-003: an aal1 admin cannot read their own report_bundle export');
  select count(*) into n from public.export_job where id = v_subject_export;
  perform tests.ok(n = 0, 'SEC-003: an aal1 admin cannot read a person export they requested about someone else');
  reset role;

  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into n from public.export_job
  where id in (v_org_export, v_bundle_export, v_staff_export, v_subject_export);
  perform tests.ok(n = 4, 'SEC-003: an aal2 admin reads every export in the organization');
  reset role;

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into n from public.export_job where id = v_staff_export;
  perform tests.ok(n = 1, 'staff still read the report bundle they requested');
  select count(*) into n from public.export_job where id = v_subject_export;
  perform tests.ok(n = 1, 'the subject of a person export still reads it');
  select count(*) into n from public.export_job where id in (v_org_export, v_bundle_export);
  perform tests.ok(n = 0, 'staff cannot read exports an admin requested');
  reset role;

  -- Report capability for the export job --------------------------------------
  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'SEC-006 open program', 'sec006-open-' || substr(gen_random_uuid()::text, 1, 8), v_staff, v_owner)
  returning id into v_open_program;
  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'SEC-006 closed program', 'sec006-closed-' || substr(gen_random_uuid()::text, 1, 8), v_owner, v_owner)
  returning id into v_closed_program;

  insert into public.report_instance (organization_id, report_type, title, program_id, snapshot, generated_by)
  values (v_org, 'program', 'SEC-006 readable', v_open_program, '{}'::jsonb, v_owner)
  returning id into v_open_report;
  insert into public.report_instance (organization_id, report_type, title, program_id, snapshot, generated_by)
  values (v_org, 'program', 'SEC-006 hidden', v_closed_program, '{"salaries":"probe"}'::jsonb, v_owner)
  returning id into v_closed_report;
  insert into public.report_instance (organization_id, report_type, title, snapshot, generated_by)
  values (v_org, 'quarterly', 'SEC-006 organization-wide', '{}'::jsonb, v_owner)
  returning id into v_org_report;

  perform tests.ok(public.actor_can_read_report(v_staff, v_open_report),
    'SEC-006: staff can read a report on the program they lead');
  perform tests.ok(not public.actor_can_read_report(v_staff, v_closed_report),
    'SEC-006: staff cannot read a report on a program they have no access to');
  perform tests.ok(not public.actor_can_read_report(v_staff, v_org_report),
    'SEC-006: staff cannot read an organization-wide report');
  perform tests.ok(public.actor_can_read_report(v_admin, v_closed_report),
    'SEC-006: an admin can read any report in the organization');
  perform tests.ok(not public.actor_can_read_report(v_volunteer, v_open_report),
    'SEC-006: a volunteer without a grant cannot read the report');
  perform tests.ok(not public.actor_can_read_report(null, v_open_report),
    'SEC-006: nobody is nobody');

  -- Same answer as can_read_report gives each person signed in.
  perform tests.authenticate(v_staff, 'aal2');
  select count(*) into n from public.report_instance where id in (v_open_report, v_closed_report, v_org_report);
  perform tests.ok(n = 1, 'staff reads exactly the one report the actor helper allows');
  reset role;

  -- Only the job (service role) may ask about other people.
  perform tests.ok(
    not has_function_privilege('authenticated', 'public.actor_can_read_report(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.actor_can_read_report(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'app.actor_can_read_report(uuid, uuid)', 'execute')
    and has_function_privilege('service_role', 'public.actor_can_read_report(uuid, uuid)', 'execute'),
    'SEC-006: only the service role can call actor_can_read_report'
  );
end;
$$;

rollback;
