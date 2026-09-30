-- Insight operations analytics (V3-5, epic #199): no new table. Goal tiles
-- read outcome_metric and outcome_measurement, and workload reads tasks and
-- their assignees, all through the viewer's own session. Pins that goals are
-- visible to every member of their organization and to nobody outside it,
-- and that workload never counts a task the viewer cannot read. Checked for
-- owner, admin, staff, member, volunteer, the accountant and signed-out.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_member uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_other_org uuid;
  v_program uuid;
  v_other_program uuid;
  v_metric uuid;
  v_other_metric uuid;
  v_project uuid;
  v_task uuid;
  v_role record;
  n integer;
  m integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Ops goals', 'ops-' || substr(gen_random_uuid()::text, 1, 8), v_owner) returning id into v_program;
  insert into public.outcome_metric (organization_id, program_id, name, baseline, baseline_on, target, target_on, created_by)
  values (v_org, v_program, 'Ops metric', 0, current_date - 100, 100, current_date + 100, v_owner) returning id into v_metric;
  insert into public.outcome_measurement (organization_id, metric_id, measured_on, value, recorded_by)
  values (v_org, v_metric, current_date - 10, 40, v_owner);

  -- A goal in another organization nobody here belongs to.
  insert into public.organization (name, slug) values ('Elsewhere', 'elsewhere-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_other_org;
  insert into public.program (organization_id, name, slug)
  values (v_other_org, 'Elsewhere goals', 'else-' || substr(gen_random_uuid()::text, 1, 8)) returning id into v_other_program;
  insert into public.outcome_metric (organization_id, program_id, name)
  values (v_other_org, v_other_program, 'Elsewhere metric') returning id into v_other_metric;

  -- Work assigned to staff inside a project nobody else was granted.
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Ops private project', v_owner, v_owner) returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_staff, 'contributor', 'direct', v_owner);
  insert into public.task (organization_id, project_id, title, assignee_id, due_at, created_by)
  values (v_org, v_project, 'Ops private task', v_staff, current_date - 3, v_owner) returning id into v_task;

  for v_role in select * from (values
      (v_owner, 'owner'), (v_admin, 'admin'), (v_staff, 'staff'), (v_volunteer, 'volunteer'),
      (v_member, 'member'), (v_guest, 'accountant')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.outcome_metric where id = v_metric;
    select count(*) into m from public.outcome_measurement where metric_id = v_metric;
    perform tests.ok(n = 1 and m = 1, v_role.name || ' sees the organization''s goal and its measurement');
    select count(*) into n from public.outcome_metric where id = v_other_metric;
    perform tests.ok(n = 0, v_role.name || ' does not see another organization''s goal');
    reset role;
  end loop;

  -- Workload: the assignee and administrators see the overdue task; people
  -- without access to the project do not, so it never enters their figures.
  for v_role in select * from (values (v_owner, 'owner'), (v_admin, 'admin'), (v_staff, 'staff (the assignee)')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.task where id = v_task and assignee_id = v_staff;
    perform tests.ok(n = 1, v_role.name || ' counts the assigned task');
    reset role;
  end loop;
  for v_role in select * from (values (v_volunteer, 'volunteer'), (v_member, 'member'), (v_guest, 'accountant')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.task where id = v_task;
    perform tests.ok(n = 0, v_role.name || ' does not count a task they cannot read');
    reset role;
  end loop;

  perform tests.clear_auth();
  begin
    select count(*) into n from public.outcome_metric where id = v_metric;
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.ok(n = 0, 'signed-out: no goals');
  begin
    select count(*) into n from public.task where id = v_task;
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.ok(n = 0, 'signed-out: no tasks');
  reset role;
end;
$$;

rollback;
