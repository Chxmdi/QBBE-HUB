-- Personal tasks (staging audit B1): a staff member creates and manages a task
-- with no project and no program; nobody else gains access they did not have.
-- Run after qa-users.sql and rls.sql. All changes are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_leadership uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_other_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_task uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_staff and role = 'staff' and status = 'active'
  limit 1;
  -- qa-users.sql makes this account a guest; give it the read-only role here.
  update public.organization_membership set role = 'leadership_viewer'
  where organization_id = v_org and user_id = v_leadership;

  -- Staff: create, read, edit and archive their own personal task.
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.task (organization_id, title, created_by, requester_id, assignee_id, status)
  values (v_org, 'Personal task from Capture', v_staff, v_staff, v_staff, 'not_started')
  returning id into v_task;
  perform tests.ok(v_task is not null, 'staff create a task with no project and no program');
  select count(*) into n from public.task where id = v_task;
  perform tests.ok(n = 1, 'staff read their personal task');
  perform tests.ok(public.has_task_capability(v_task, 'manage'), 'staff manage their personal task');
  update public.task set title = 'Personal task, renamed' where id = v_task;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'staff edit their personal task');
  update public.task set archived_at = now() where id = v_task;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'staff archive their personal task');

  -- Staff cannot create a personal task in someone else's name.
  begin
    insert into public.task (organization_id, title, created_by, requester_id, status)
    values (v_org, 'Not mine to create', v_owner, v_staff, 'not_started');
    raise exception 'FAIL: staff created a personal task as someone else';
  exception when insufficient_privilege then
    perform tests.ok(true, 'staff cannot create a personal task in someone else''s name');
  end;

  -- Another staff member does not see it.
  perform tests.authenticate(v_other_staff, 'aal1');
  select count(*) into n from public.task where id = v_task;
  perform tests.ok(n = 0, 'another staff member does not see someone else''s personal task');

  -- A volunteer neither creates personal tasks nor sees staff's.
  perform tests.authenticate(v_volunteer, 'aal1');
  begin
    insert into public.task (organization_id, title, created_by, requester_id, status)
    values (v_org, 'Volunteer personal task', v_volunteer, v_volunteer, 'not_started');
    raise exception 'FAIL: volunteer created a personal task';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a volunteer cannot create a task outside work they belong to');
  end;
  select count(*) into n from public.task where id = v_task;
  perform tests.ok(n = 0, 'a volunteer does not see a staff member''s personal task');
  perform tests.ok(not public.has_task_capability(v_task, 'read'), 'capability agrees: volunteer cannot read it');

  -- A leadership viewer reads every task but creates none.
  perform tests.authenticate(v_leadership, 'aal1');
  select count(*) into n from public.task where id = v_task;
  perform tests.ok(n = 1, 'a leadership viewer still reads every task');
  begin
    insert into public.task (organization_id, title, created_by, requester_id, status)
    values (v_org, 'Viewer personal task', v_leadership, v_leadership, 'not_started');
    raise exception 'FAIL: leadership viewer created a personal task';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a leadership viewer cannot create a personal task');
  end;

  -- The owner still reads it, as every task in the organization.
  perform tests.authenticate(v_owner, 'aal1');
  select count(*) into n from public.task where id = v_task;
  perform tests.ok(n = 1, 'the owner reads a staff member''s personal task');
end;
$$;

rollback;
