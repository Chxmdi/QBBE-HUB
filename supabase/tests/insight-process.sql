-- Insight process analytics (V3-3, epic #199): no new table. Approval wait
-- times read approval_item and approval_event, and time-in-status reads task
-- activity, all through the viewer's own session. A wait time or a status
-- change must count only for someone allowed to see that approval or task.
-- Checked for owner, admin, staff, member, volunteer, the accountant and
-- signed-out.
--
-- The approval rows are written as the database owner with triggers off:
-- what is under test is who may read them (approvals.sql covers how they are
-- submitted and decided). Run after qa-users.sql and rls.sql. Rolled back.
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
  v_item uuid := gen_random_uuid();
  v_project uuid;
  v_task uuid;
  v_activity uuid;
  v_role record;
  n integer;
  m integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);

  -- An approval requested by staff, with the volunteer as step 1's approver.
  set local session_replication_role = replica;
  insert into public.approval_item (id, organization_id, subject_type, title, requested_by, status, current_step)
  values (v_item, v_org, 'other', 'Process check', v_staff, 'pending', 1);
  insert into public.approval_step (item_id, organization_id, step, label, approver_kind, approver_id)
  values (v_item, v_org, 1, 'Review', 'person', v_volunteer);
  insert into public.approval_event (item_id, organization_id, actor_id, kind, step, created_at)
  values (v_item, v_org, v_staff, 'submitted', null, now() - interval '3 days');
  set local session_replication_role = origin;

  -- A task status change inside a project only the volunteer is granted.
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Process check project', v_owner, v_owner) returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_volunteer, 'read_only', 'direct', v_owner);
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Process check task', v_owner) returning id into v_task;
  insert into public.activity_event (organization_id, actor_id, verb, source_type, source_id, project_id, summary, metadata)
  values (v_org, v_owner, 'updated', 'task', v_task, v_project, 'status check',
          jsonb_build_object('changes', jsonb_build_array(jsonb_build_object('field', 'status', 'from', 'not_started', 'to', 'waiting'))))
  returning id into v_activity;

  -- Approvals: the requester, the step's approver and administrators.
  for v_role in select * from (values
      (v_owner, 'owner'), (v_admin, 'admin'), (v_staff, 'staff (the requester)'),
      (v_volunteer, 'volunteer (the approver)')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.approval_item where id = v_item;
    select count(*) into m from public.approval_event where item_id = v_item;
    perform tests.ok(n = 1 and m = 1, v_role.name || ' sees the approval and its trail');
    reset role;
  end loop;
  for v_role in select * from (values (v_guest, 'accountant'), (v_member, 'member')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.approval_item where id = v_item;
    select count(*) into m from public.approval_event where item_id = v_item;
    perform tests.ok(n = 0 and m = 0, v_role.name || ' does not see an approval they are not part of');
    reset role;
  end loop;

  -- Task status changes: whoever can read the project.
  for v_role in select * from (values (v_owner, 'owner'), (v_admin, 'admin'), (v_volunteer, 'volunteer with a grant')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.activity_event where id = v_activity;
    perform tests.ok(n = 1, v_role.name || ' sees the status change');
    reset role;
  end loop;
  for v_role in select * from (values (v_guest, 'accountant'), (v_member, 'member')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.activity_event where id = v_activity;
    perform tests.ok(n = 0, v_role.name || ' does not see a status change in a project they cannot read');
    reset role;
  end loop;
  -- Staff: sees the change exactly when they can read the task.
  perform tests.authenticate(v_staff);
  select count(*) into n from public.activity_event where id = v_activity;
  select count(*) into m from public.task where id = v_task;
  perform tests.ok(n = m, 'staff sees the status change only if they can read the task');
  reset role;

  perform tests.clear_auth();
  begin
    select count(*) into n from public.approval_event where item_id = v_item;
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.ok(n = 0, 'signed-out: no approval trail');
  begin
    select count(*) into n from public.activity_event where id = v_activity;
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.ok(n = 0, 'signed-out: no status changes');
  reset role;
end;
$$;

rollback;
