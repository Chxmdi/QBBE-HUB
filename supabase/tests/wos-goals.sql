-- Workspace OS V1-11: goals linked to projects and outcome metrics, with
-- progress worked out from them. Allow and deny for every role: owner, admin,
-- staff (program lead), member (staff outside the program), volunteer,
-- accountant (a guest with ledger access only) and signed out.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_member uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_other_project uuid;
  v_metric uuid;
  v_goal uuid;
  v_org_goal uuid;
  n integer;
  failed boolean;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Goals program', 'goals-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.program_access_grant (organization_id, program_id, user_id, role, source, created_by)
  values (v_org, v_program, v_staff, 'lead', 'direct', v_owner);
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Literacy nights', v_owner, v_owner) returning id into v_project;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Unrelated project', v_owner, v_owner) returning id into v_other_project;
  insert into public.task (organization_id, project_id, title, created_by, status, completed_at)
  values (v_org, v_project, 'Book rooms', v_owner, 'completed', now()),
         (v_org, v_project, 'Recruit tutors', v_owner, 'in_progress', null),
         (v_org, v_project, 'Dropped idea', v_owner, 'cancelled', null);
  insert into public.outcome_metric (organization_id, program_id, name, baseline, target, created_by)
  values (v_org, v_program, 'Families reached', 100, 200, v_owner) returning id into v_metric;
  insert into public.outcome_measurement (organization_id, metric_id, measured_on, value)
  values (v_org, v_metric, current_date - 10, 120), (v_org, v_metric, current_date, 150);
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner);

  -- Staff (program lead) ------------------------------------------------------
  perform tests.authenticate(v_staff);
  insert into public.goal (organization_id, program_id, title, owner_id)
  values (v_org, v_program, 'Double family literacy', v_staff) returning id into v_goal;
  perform tests.ok(v_goal is not null, 'staff: a program lead creates a program goal');
  insert into public.goal_project (goal_id, project_id) values (v_goal, v_project);
  insert into public.goal_metric (goal_id, metric_id) values (v_goal, v_metric);
  select count(*) into n from public.goal_project where goal_id = v_goal;
  perform tests.ok(n = 1, 'staff: a program lead links a project it can read');
  failed := false;
  begin
    insert into public.goal (organization_id, title) values (v_org, 'Organization-wide');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: only an administrator creates an organization-wide goal');
  failed := false;
  begin
    insert into public.goal_project (goal_id, project_id) values (v_goal, v_other_project);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a project the lead cannot read cannot be linked');

  -- Progress inputs: done / total ignores cancelled tasks; latest measurement.
  select * into r from public.goal_progress_inputs(v_goal) where kind = 'project';
  perform tests.ok(r.tasks_done = 1 and r.tasks_total = 2 and r.label = 'Literacy nights' and not r.project_completed,
    'staff: project progress counts completed over non-cancelled tasks');
  select * into r from public.goal_progress_inputs(v_goal) where kind = 'metric';
  perform tests.ok(r.metric_latest = 150 and r.metric_baseline = 100 and r.metric_target = 200,
    'staff: metric progress reads the latest measurement');

  -- Volunteer (no program access) -----------------------------------------------
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.goal where id = v_goal;
  perform tests.ok(n = 0, 'volunteer: a program goal is hidden outside the program');
  select count(*) into n from public.goal_progress_inputs(v_goal);
  perform tests.ok(n = 0, 'volunteer: progress inputs answer nothing for an unreadable goal');
  failed := false;
  begin
    insert into public.goal (organization_id, program_id, title) values (v_org, v_program, 'Volunteer goal');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'volunteer: cannot create goals');

  -- Admin: organization-wide goal ------------------------------------------------
  perform tests.authenticate(v_admin);
  insert into public.goal (organization_id, title) values (v_org, 'A welcoming workspace')
  returning id into v_org_goal;
  perform tests.ok(v_org_goal is not null, 'admin: an administrator creates an organization-wide goal');
  select count(*) into n from public.goal where id = v_goal;
  perform tests.ok(n = 1, 'admin: an administrator reads program goals');
  insert into public.goal_project (goal_id, project_id) values (v_org_goal, v_other_project);
  perform tests.authenticate(v_admin, 'aal1');
  failed := false;
  begin
    insert into public.goal (organization_id, title) values (v_org, 'Without MFA');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'admin: without two-step sign-in an administrator cannot create goals');

  -- Volunteer reads the organization-wide goal; unreadable projects are unnamed.
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.goal where id = v_org_goal;
  perform tests.ok(n = 1, 'volunteer: an organization-wide goal is readable by members');
  select * into r from public.goal_progress_inputs(v_org_goal) where kind = 'project';
  perform tests.ok(r.label is null and r.tasks_total is not null,
    'volunteer: a linked project the reader cannot open counts but is not named');
  update public.goal set title = 'Renamed by volunteer' where id = v_org_goal;
  reset role;
  select count(*) into n from public.goal where title = 'Renamed by volunteer';
  perform tests.ok(n = 0, 'volunteer: cannot change a goal');

  -- Member (staff outside the program) --------------------------------------------
  perform tests.authenticate(v_member);
  select count(*) into n from public.goal where id = v_goal;
  perform tests.ok(n = 0, 'member: a program goal is hidden outside the program');
  select count(*) into n from public.goal_metric where goal_id = v_goal;
  perform tests.ok(n = 0, 'member: nor its links');
  delete from public.goal_project where goal_id = v_goal;
  reset role;
  select count(*) into n from public.goal_project where goal_id = v_goal;
  perform tests.ok(n = 1, 'member: cannot unlink projects');

  -- Accountant ----------------------------------------------------------------------
  perform tests.authenticate(v_accountant);
  select count(*) into n from public.goal where id = v_goal;
  perform tests.ok(n = 0, 'accountant: ledger access does not reach program goals');
  failed := false;
  begin
    insert into public.goal_metric (goal_id, metric_id) values (v_org_goal, v_metric);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'accountant: cannot link metrics');

  -- Signed out --------------------------------------------------------------------------
  perform tests.clear_auth();
  failed := false;
  begin
    select count(*) into n from public.goal;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'signed out: goals cannot be read');
  failed := false;
  begin
    perform public.goal_progress_inputs(v_goal);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'signed out: progress inputs cannot be called');
  reset role;

  -- Owner ---------------------------------------------------------------------------------
  perform tests.authenticate(v_owner);
  update public.goal set status = 'achieved' where id = v_goal;
  delete from public.goal_metric where goal_id = v_goal;
  select count(*) into n from public.goal where id = v_goal and status = 'achieved';
  perform tests.ok(n = 1, 'owner: the owner updates any goal and unlinks metrics');
  update public.project set stage = 'completed', completed_at = now() where id = v_project;
  select * into r from public.goal_progress_inputs(v_goal) where kind = 'project';
  perform tests.ok(r.project_completed, 'owner: a completed project reads as complete');

  reset role;
end;
$$;

rollback;
