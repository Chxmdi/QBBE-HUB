-- Remaining scoped surfaces after the core program/project cutover.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_other_project uuid;
  v_meeting uuid;
  v_other_meeting uuid;
  v_event uuid;
  v_report uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Surface program', 'surface-' || substr(gen_random_uuid()::text, 1, 8), v_staff, v_owner)
  returning id into v_program;

  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Surface project', v_staff, v_owner)
  returning id into v_project;

  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Unrelated surface project', v_owner, v_owner)
  returning id into v_other_project;

  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, created_by
  ) values (
    v_org, v_project, v_volunteer, 'contributor', 'direct', v_owner
  );

  insert into public.meeting (
    organization_id, program_id, project_id, title, organizer_id, starts_at
  ) values (
    v_org, v_program, v_project, 'Granted meeting', v_staff, now()
  ) returning id into v_meeting;

  insert into public.meeting (
    organization_id, program_id, project_id, title, organizer_id, starts_at
  ) values (
    v_org, v_program, v_other_project, 'Hidden meeting', v_owner, now()
  ) returning id into v_other_meeting;

  insert into public.event (
    organization_id, program_id, project_id, name, owner_id, starts_at, created_by
  ) values (
    v_org, v_program, v_project, 'Granted event', v_staff, now(), v_owner
  ) returning id into v_event;

  insert into public.report_instance (
    organization_id, report_type, title, project_id, snapshot, generated_by
  ) values (
    v_org, 'project', 'Granted report', v_project, '{}'::jsonb, v_owner
  ) returning id into v_report;

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.meeting where id = v_meeting;
  perform tests.ok(n = 1, 'volunteer reads a meeting on a granted project');
  select count(*) into n from public.meeting where id = v_other_meeting;
  perform tests.ok(n = 0, 'volunteer cannot read a sibling-project meeting');
  select count(*) into n from public.event where id = v_event;
  perform tests.ok(n = 1, 'volunteer reads an event on a granted project');
  select count(*) into n from public.report_instance where id = v_report;
  perform tests.ok(n = 1, 'volunteer reads a report on a granted project');
  select count(*) into n from public.crm_organization;
  perform tests.ok(n = 0, 'volunteer cannot read CRM without staff capability');
  perform tests.ok(
    public.actor_has_project_capability(v_volunteer, v_project, 'read'),
    'actor helper sees the volunteer grant'
  );
  perform tests.ok(
    not public.actor_has_project_capability(v_volunteer, v_other_project, 'read'),
    'actor helper denies the sibling project'
  );
  reset role;
end;
$$;

rollback;
