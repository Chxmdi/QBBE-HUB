-- Workspace OS following and notification rules (V1-14, migration
-- 20261106110300): people follow only what they can see, manage only their
-- own follows and rules, and a rule's email choice lands in the preference
-- the digest reads. Roles: owner, admin, staff, volunteer, guest, signed-out
-- (org_role has no separate "member" or "accountant"). Run after qa-users.sql
-- and rls.sql. All mutations roll back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_project uuid;
  v_task uuid;
  v_follow uuid;
  v_ok boolean;
  v_n integer;
  v_text text;
  r record;
  v_query jsonb := '{"version":1,"types":["task"],"filter":{"property":"status","op":"eq","value":"blocked"}}';
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_admin, v_guest);
  insert into public.project (organization_id, name, created_by)
  values (v_org, 'Following test project', v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Following test task', v_owner) returning id into v_task;

  -- ---------------------------------------------------------- following
  for r in select * from (values (v_owner, 'the owner'), (v_admin, 'an admin')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    insert into public.follow_v2 (organization_id, object_id, object_type)
    values (v_org, v_task, 'task') returning id into v_follow;
    reset role;
    perform tests.ok(v_follow is not null, format('%s follows a task they can see', r.who));
  end loop;

  -- Volunteers and guests have no grant on this project, so they cannot follow its task.
  for r in select * from (values (v_volunteer, 'a volunteer'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    begin
      insert into public.follow_v2 (organization_id, object_id, object_type) values (v_org, v_task, 'task');
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    reset role;
    perform tests.ok(v_ok, format('%s cannot follow something they cannot see', r.who));
  end loop;

  for r in select * from (values (v_staff, 'staff'), (v_volunteer, 'a volunteer'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    insert into public.follow_v2 (organization_id, query_spec, label)
    values (v_org, v_query, 'Blocked work') returning id into v_follow;
    reset role;
    perform tests.ok(v_follow is not null, format('%s follows a query', r.who));
  end loop;

  perform tests.authenticate(v_staff);
  begin
    insert into public.follow_v2 (organization_id, user_id, query_spec) values (v_org, v_volunteer, v_query);
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'nobody follows on someone else''s behalf');
  begin
    insert into public.follow_v2 (organization_id, query_spec) values (v_org, '{"types":["task"]}');
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a followed query must be a version 1 query spec');
  select count(*) into v_n from public.follow_v2 where organization_id = v_org;
  perform tests.ok(v_n = 1, 'staff see only their own follows');
  delete from public.follow_v2 where user_id = v_owner;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'staff cannot remove someone else''s follow');
  delete from public.follow_v2 where user_id = v_staff;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 1, 'staff unfollow');
  reset role;

  -- ---------------------------------------------------------- rules
  perform tests.authenticate(v_volunteer);
  insert into public.follow_rule_v2 (organization_id, event_kind, in_app, email)
  values (v_org, 'status', true, 'weekly');
  reset role;
  select category_modes->>'follow_status' into v_text
  from public.notification_preference where user_id = v_volunteer;
  perform tests.ok(v_text = 'weekly', 'a rule''s email choice is where the digest reads it');

  perform tests.authenticate(v_volunteer);
  update public.follow_rule_v2 set email = 'immediate' where event_kind = 'status';
  delete from public.follow_rule_v2 where event_kind = 'status';
  reset role;
  select category_modes ? 'follow_status' into v_ok
  from public.notification_preference where user_id = v_volunteer;
  perform tests.ok(not v_ok, 'removing a rule returns that change to the default');

  perform tests.authenticate(v_guest);
  insert into public.follow_rule_v2 (organization_id, event_kind, email) values (v_org, 'due', 'daily');
  begin
    insert into public.follow_rule_v2 (organization_id, user_id, event_kind) values (v_org, v_staff, 'due');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'nobody sets rules for someone else');
  begin
    insert into public.follow_rule_v2 (organization_id, event_kind, email) values (v_org, 'change', 'hourly');
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'an email choice is immediate, daily, weekly or off');
  reset role;

  perform tests.authenticate(v_owner);
  select count(*) into v_n from public.follow_rule_v2 where user_id = v_guest;
  perform tests.ok(v_n = 0, 'even the owner cannot read someone else''s rules');
  update public.follow_rule_v2 set email = 'off' where user_id = v_guest;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'even the owner cannot change someone else''s rules');
  begin
    select count(*) into v_n from public.follow_event_cursor;
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'the fan-out position is not readable through the API');
  reset role;

  -- The fan-out job checks each follower as themselves.
  perform tests.ok(public.can_as(v_owner, v_task, 'view'), 'the job confirms the owner can still see the task');
  perform tests.ok(not public.can_as(v_volunteer, v_task, 'view'), 'the job refuses a follower who cannot see the task');

  -- ---------------------------------------------------------- signed out
  perform tests.clear_auth();
  begin
    select count(*) into v_n from public.follow_v2;
    v_ok := v_n = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor sees no follows');
  begin
    insert into public.follow_rule_v2 (organization_id, user_id, event_kind) values (v_org, v_owner, 'status');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor cannot write rules');
  reset role;
end;
$$;

rollback;
