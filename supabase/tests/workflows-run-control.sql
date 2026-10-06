-- Workspace OS S6 V1-12 part 1 (20261106010002_workflow_run_control): the stop
-- switch, the hourly run limit and resumable run state. Allow and deny for
-- every role. Run after qa-users.sql and rls.sql. All mutations roll back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_member uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  v_org uuid;
  v_rule uuid;
  v_run uuid;
  v_person uuid;
  n integer;
  v_graph constant jsonb := '{"version":1,"trigger":{"objectTypes":[],"verbs":[]},"start":null,"steps":[]}';
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner);

  insert into public.workflow_rule (organization_id, name, trigger_event, engine, graph, created_by)
  values (v_org, 'Run control', 'object_event', 'graph_v2', v_graph, v_owner)
  returning id into v_rule;
  perform tests.ok(
    (select max_runs_per_hour = 60 and stopped_at is null from public.workflow_rule where id = v_rule),
    'a new workflow runs, with a limit of 60 runs an hour'
  );
  begin
    update public.workflow_rule set max_runs_per_hour = 0 where id = v_rule;
    raise exception 'FAIL: a limit of 0 runs an hour was accepted';
  exception when check_violation then
    perform tests.ok(true, 'the hourly limit is at least 1');
  end;
  begin
    update public.workflow_rule set max_runs_per_hour = 1001 where id = v_rule;
    raise exception 'FAIL: a limit over 1000 was accepted';
  exception when check_violation then
    perform tests.ok(true, 'the hourly limit is at most 1000');
  end;

  insert into public.workflow_execution (organization_id, rule_id, rule_name, trigger_event, source_type, source_id,
    outcome, engine, resume_step_id, resume_attempt, resume_at, run_state)
  values (v_org, v_rule, 'Run control', 'object_event', 'task', gen_random_uuid(),
    'waiting', 'graph_v2', 'call', 2, now(), '{"steps":{},"stepsTaken":1,"depth":0}')
  returning id into v_run;
  begin
    update public.workflow_execution set resume_attempt = 6 where id = v_run;
    raise exception 'FAIL: a sixth attempt was accepted';
  exception when check_violation then
    perform tests.ok(true, 'a step is attempted at most five times');
  end;
  insert into public.workflow_execution (organization_id, rule_id, rule_name, trigger_event, source_type, source_id,
    outcome, engine, retry_of)
  values (v_org, v_rule, 'Run control', 'object_event', 'task', gen_random_uuid(), 'running', 'graph_v2', v_run);
  perform tests.ok(true, 'a run can name the run it retries');

  -- The stop switch: owners and admins (two-step sign-in) only.
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    update public.workflow_rule set stopped_at = now(), stopped_by = v_person where id = v_rule;
    get diagnostics n = row_count;
    perform tests.ok(n = 1, format('%s (owner or admin) can stop a workflow', v_person));
    update public.workflow_rule set stopped_at = null, stopped_by = null where id = v_rule;
    get diagnostics n = row_count;
    perform tests.ok(n = 1, format('%s (owner or admin) can let it run again', v_person));
    select count(*) into n from public.workflow_execution where id = v_run and run_state is not null;
    perform tests.ok(n = 1, format('%s reads a waiting run''s state', v_person));
    reset role;
  end loop;

  perform tests.authenticate(v_admin, 'aal1');
  update public.workflow_rule set stopped_at = now() where id = v_rule;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'an admin without the two-step sign-in cannot stop a workflow');
  reset role;

  foreach v_person in array array[v_staff, v_member, v_volunteer, v_accountant] loop
    perform tests.authenticate(v_person);
    update public.workflow_rule set stopped_at = now() where id = v_rule;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('%s cannot stop a workflow', v_person));
    update public.workflow_rule set max_runs_per_hour = 1000 where id = v_rule;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('%s cannot raise the hourly limit', v_person));
    select count(*) into n from public.workflow_execution where id = v_run;
    perform tests.ok(n = 0, format('%s cannot read waiting runs', v_person));
    update public.workflow_execution set outcome = 'running' where id = v_run;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('%s cannot resume a run', v_person));
    reset role;
  end loop;

  -- Nobody signed in resumes or rewrites a run through the API.
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    update public.workflow_execution set resume_at = now() - interval '1 day' where id = v_run;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('%s cannot move a waiting run''s resume time', v_person));
    reset role;
  end loop;

  perform tests.clear_auth();
  update public.workflow_rule set stopped_at = now() where id = v_rule;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a signed-out visitor cannot stop a workflow');
  select count(*) into n from public.workflow_execution where id = v_run;
  perform tests.ok(n = 0, 'a signed-out visitor reads no runs');
  reset role;

  perform tests.ok(
    exists (select 1 from public.job_definition where name = 'workflow-resume' and enabled),
    'the workflow-resume job is registered'
  );
end;
$$;

rollback;
