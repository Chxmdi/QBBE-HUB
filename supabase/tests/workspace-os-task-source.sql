-- Universal tasks (M7b): every task records where it came from, the source is
-- fixed once set, and reading it follows the task's own row-level security
-- for every role. Run after qa-users.sql and rls.sql. All mutations roll back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  v_org uuid;
  v_project uuid;
  v_meeting uuid;
  v_channel uuid;
  v_message uuid;
  t_manual uuid;
  t_message uuid;
  t_next uuid;
  t_meeting uuid;
  v_type text;
  v_id uuid;
  v_seen integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  -- The accountant is a Guest with a live ledger grant (#154).
  update public.organization_membership set role = 'guest'
  where organization_id = v_org and user_id = v_accountant;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '1 day', v_admin);

  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Task source', v_owner, v_owner) returning id into v_project;

  -- Hardening of the trigger function.
  perform tests.ok(
    (select p.proconfig @> array['search_path=""'] and not p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'task_source_defaults'),
    'task_source_defaults runs as the caller with an empty search_path'
  );
  perform tests.ok(
    not has_function_privilege('authenticated', 'app.task_source_defaults()', 'execute')
      and not has_function_privilege('anon', 'app.task_source_defaults()', 'execute'),
    'nobody can call the trigger function directly'
  );

  -- Defaults and derivation.
  insert into public.task (organization_id, title, created_by)
  values (v_org, 'Typed in', v_owner) returning id into t_manual;
  select source_type, source_id into v_type, v_id from public.task where id = t_manual;
  perform tests.ok(v_type = 'manual' and v_id is null, 'a task with no source is manual');

  select id into v_channel from public.channel where organization_id = v_org limit 1;
  insert into public.message (organization_id, channel_id, author_id, body)
  values (v_org, v_channel, v_owner, 'Please book the hall') returning id into v_message;
  insert into public.task (organization_id, title, created_by, source_message_id)
  values (v_org, 'From chat', v_owner, v_message) returning id into t_message;
  select source_type, source_id into v_type, v_id from public.task where id = t_message;
  perform tests.ok(v_type = 'message' and v_id = v_message,
    'an insert that only sets source_message_id records the message as its source');

  insert into public.task (organization_id, title, created_by, recurrence_parent_id)
  values (v_org, 'Next week', v_owner, t_manual) returning id into t_next;
  select source_type, source_id into v_type, v_id from public.task where id = t_next;
  perform tests.ok(v_type = 'recurrence' and v_id = t_manual,
    'the next occurrence names the one before it');

  -- Constraints.
  begin
    insert into public.task (organization_id, title, created_by, source_type)
    values (v_org, 'Bad', v_owner, 'telepathy');
    perform tests.ok(false, 'an unknown source type is refused');
  exception when check_violation then
    perform tests.ok(true, 'an unknown source type is refused');
  end;
  begin
    insert into public.task (organization_id, title, created_by, source_type, source_id)
    values (v_org, 'Bad', v_owner, 'manual', gen_random_uuid());
    perform tests.ok(false, 'a manual task cannot name a source row');
  exception when check_violation then
    perform tests.ok(true, 'a manual task cannot name a source row');
  end;

  -- Meeting actions record their meeting.
  insert into public.meeting (organization_id, project_id, title, organizer_id, starts_at, ends_at)
  values (v_org, v_project, 'Board review', v_owner, now() + interval '1 day', now() + interval '1 day 1 hour')
  returning id into v_meeting;
  perform tests.authenticate(v_owner);
  t_meeting := public.create_meeting_action(v_meeting, 'Send the minutes', v_volunteer, null);
  select source_type, source_id into v_type, v_id from public.task where id = t_meeting;
  perform tests.ok(v_type = 'meeting' and v_id = v_meeting,
    'create_meeting_action records the meeting as the source');

  -- Provenance is fixed: a signed-in update cannot rewrite it.
  update public.task set source_type = 'document', source_id = gen_random_uuid(), title = 'Send the minutes today'
  where id = t_meeting;
  select source_type, source_id into v_type, v_id from public.task where id = t_meeting;
  perform tests.ok(v_type = 'meeting' and v_id = v_meeting
      and (select title from public.task where id = t_meeting) = 'Send the minutes today',
    'an update keeps the original source while other edits go through');
  reset role;

  -- Every role reads the source exactly where it can read the task.
  -- Owner and admin read everything in the organization.
  foreach v_id in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_id);
    select count(*) into v_seen from public.task
    where id in (t_manual, t_message, t_meeting) and source_type is not null;
    perform tests.ok(v_seen = 3, format('%s reads the source of every task (%s/3)', v_id, v_seen));
    reset role;
  end loop;

  -- Staff read a task they are assigned to, with its source, and not
  -- unrelated work outside their programs and projects.
  insert into public.task (organization_id, title, created_by, assignee_id, source_type, source_id)
  values (v_org, 'For staff', v_owner, v_staff, 'meeting', v_meeting);
  perform tests.authenticate(v_staff);
  select count(*) into v_seen from public.task where title = 'For staff' and source_type = 'meeting';
  perform tests.ok(v_seen = 1, 'staff read the source of a task assigned to them');
  select count(*) into v_seen from public.task where id in (t_manual, t_message);
  perform tests.ok(v_seen = 0, 'staff do not read unrelated tasks or their sources');
  reset role;

  -- The volunteer reads the source of the task assigned to them and nothing else.
  perform tests.authenticate(v_volunteer);
  select count(*) into v_seen from public.task where id = t_meeting and source_type = 'meeting';
  perform tests.ok(v_seen = 1, 'a volunteer reads the source of their own task');
  select count(*) into v_seen from public.task where id in (t_manual, t_message);
  perform tests.ok(v_seen = 0, 'a volunteer does not read other tasks or their sources');
  update public.task set source_type = 'manual', source_id = null where id = t_meeting;
  reset role;
  perform tests.ok((select source_type from public.task where id = t_meeting) = 'meeting',
    'an assignee cannot clear the source either');

  -- The guest and the accountant see no work at all.
  foreach v_id in array array[v_guest, v_accountant] loop
    perform tests.authenticate(v_id);
    select count(*) into v_seen from public.task where id in (t_manual, t_message, t_meeting);
    perform tests.ok(v_seen = 0, format('%s reads no task sources', v_id));
    reset role;
  end loop;

  -- Signed out: nothing.
  perform tests.clear_auth();
  select count(*) into v_seen from public.task where id in (t_manual, t_message, t_meeting);
  perform tests.ok(v_seen = 0, 'a signed-out visitor reads no task sources');
  reset role;

  -- The service role (repairs) may still correct a source.
  set local role service_role;
  update public.task set source_type = 'document', source_id = v_meeting where id = t_manual;
  reset role;
  perform tests.ok((select source_type from public.task where id = t_manual) = 'document',
    'the service role can correct a source');
end;
$$;

rollback;
