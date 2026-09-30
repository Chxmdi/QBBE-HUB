-- Workspace OS S6 M14a/b: step-graph workflows (20261106010001_workflow_graph).
-- Allow and deny for every role on the new tables, the widened run table and
-- app.can_as. Run after qa-users.sql and rls.sql. All mutations roll back.
--
-- Roles: owner (a1), admin (a4), staff (a2), member (guest, a5), volunteer
-- (a3), accountant (a8 with a ledger accountant grant) and signed-out.
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
  v_program uuid;
  v_project uuid;
  t_assigned uuid;
  t_unrelated uuid;
  v_rule uuid;
  v_legacy_rule uuid;
  v_run uuid;
  v_person uuid;
  n integer;
  v_graph constant jsonb := '{"version":1,"trigger":{"objectTypes":["task"],"verbs":["updated"]},"start":"a","steps":[{"id":"a","kind":"action","action":"task.set_status","input":{},"next":null}]}';
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner);

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Workflow graph', 'wf-graph-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Workflow graph', v_owner, v_owner)
  returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Assigned to the volunteer', v_owner, v_volunteer)
  returning id into t_assigned;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Not the volunteer''s', v_owner)
  returning id into t_unrelated;

  -- Existing rules are untouched by the change.
  insert into public.workflow_rule (organization_id, name, trigger_event, condition, action)
  values (v_org, 'Legacy rule', 'task_status_changed', '{"status":"done"}', '{"type":"notify_admins"}')
  returning id into v_legacy_rule;
  perform tests.ok(
    (select engine = 'rules_v1' and graph is null and definition_version = 1
     from public.workflow_rule where id = v_legacy_rule),
    'a rule written the old way is a rules_v1 rule with no graph'
  );

  begin
    insert into public.workflow_rule (organization_id, name, trigger_event, engine)
    values (v_org, 'No graph', 'object_event', 'graph_v2');
    raise exception 'FAIL: a graph workflow was saved without a graph';
  exception when check_violation then
    perform tests.ok(true, 'a graph workflow must carry a graph');
  end;
  begin
    insert into public.workflow_rule (organization_id, name, trigger_event, engine)
    values (v_org, 'Bad engine', 'object_event', 'graph_v9');
    raise exception 'FAIL: an unknown engine was accepted';
  exception when check_violation then
    perform tests.ok(true, 'an unknown engine is refused');
  end;

  insert into public.workflow_rule (organization_id, name, trigger_event, engine, graph, run_as_user_id, created_by)
  values (v_org, 'Graph rule', 'object_event', 'graph_v2', v_graph, v_owner, v_owner)
  returning id into v_rule;

  insert into public.workflow_execution (
    organization_id, rule_id, rule_name, trigger_event, source_type, source_id,
    outcome, engine, trigger_event_id, started_at, actor_kind, actor_id
  ) values (
    v_org, v_rule, 'Graph rule', 'object_event', 'task', t_assigned,
    'running', 'graph_v2', gen_random_uuid(), now(), 'automation', v_rule::text
  ) returning id into v_run;
  perform tests.ok(
    (select run_number is not null from public.workflow_execution where id = v_run),
    'every run gets a number people can quote'
  );

  begin
    insert into public.workflow_execution (
      organization_id, rule_id, rule_name, trigger_event, source_type, source_id,
      outcome, engine, trigger_event_id
    )
    select organization_id, rule_id, rule_name, trigger_event, source_type, source_id,
           'running', engine, trigger_event_id
    from public.workflow_execution where id = v_run;
    raise exception 'FAIL: the same event ran the same rule twice';
  exception when unique_violation then
    perform tests.ok(true, 'one event runs one rule once, however often the stream is re-read');
  end;

  begin
    update public.workflow_execution set outcome = 'exploded' where id = v_run;
    raise exception 'FAIL: an unknown outcome was accepted';
  exception when check_violation then
    perform tests.ok(true, 'run outcomes are a closed list');
  end;

  insert into public.workflow_execution_step (execution_id, organization_id, position, step_id, step_kind, status, input, output)
  values (v_run, v_org, 0, 'trigger', 'trigger', 'succeeded', '{}', '{}'),
         (v_run, v_org, 1, 'a', 'action', 'failed', '{}', null);

  insert into public.workflow_event_cursor (consumer, last_created_at) values ('workflow-events-test', now());

  -- Reads: owner and admin see runs and steps; nobody else does.
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    select count(*) into n from public.workflow_execution_step where execution_id = v_run;
    perform tests.ok(n = 2, format('%s (owner or admin) reads the steps of a run', v_person));
    select count(*) into n from public.workflow_execution where id = v_run;
    perform tests.ok(n = 1, format('%s (owner or admin) reads the run', v_person));
    select count(*) into n from public.workflow_event_cursor;
    perform tests.ok(n = 0, format('%s cannot read the event cursor', v_person));
    reset role;
  end loop;

  foreach v_person in array array[v_staff, v_member, v_volunteer, v_accountant] loop
    perform tests.authenticate(v_person);
    select count(*) into n from public.workflow_execution_step where execution_id = v_run;
    perform tests.ok(n = 0, format('%s (staff, member, volunteer or accountant) cannot read run steps', v_person));
    select count(*) into n from public.workflow_execution where id = v_run;
    perform tests.ok(n = 0, format('%s cannot read graph runs', v_person));
    select count(*) into n from public.workflow_event_cursor;
    perform tests.ok(n = 0, format('%s cannot read the event cursor', v_person));
    reset role;
  end loop;

  -- An admin without the two-step sign-in reads nothing administrative.
  perform tests.authenticate(v_admin, 'aal1');
  select count(*) into n from public.workflow_execution_step where execution_id = v_run;
  perform tests.ok(n = 0, 'an admin at aal1 cannot read run steps');
  reset role;

  -- Writes: steps and cursor are the runner's alone, whoever is signed in.
  foreach v_person in array array[v_owner, v_admin, v_staff, v_member, v_volunteer, v_accountant] loop
    perform tests.authenticate(v_person);
    begin
      insert into public.workflow_execution_step (execution_id, organization_id, position, step_id, step_kind, status)
      values (v_run, v_org, 9, 'forged', 'action', 'succeeded');
      raise exception 'FAIL: % wrote a run step', v_person;
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot write a run step', v_person));
    end;
    update public.workflow_execution_step set status = 'succeeded' where execution_id = v_run;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('%s cannot rewrite a run step', v_person));
    delete from public.workflow_execution_step where execution_id = v_run;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('%s cannot delete a run step', v_person));
    begin
      insert into public.workflow_event_cursor (consumer) values ('forged-' || v_person::text);
      raise exception 'FAIL: % moved the event cursor', v_person;
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot write the event cursor', v_person));
    end;
    reset role;
  end loop;

  -- Graph workflows are saved by admins only (the existing rule policy).
  perform tests.authenticate(v_admin);
  insert into public.workflow_rule (organization_id, name, trigger_event, engine, graph)
  values (v_org, 'Admin graph', 'object_event', 'graph_v2', v_graph);
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'an admin saves a graph workflow');
  reset role;
  foreach v_person in array array[v_staff, v_member, v_volunteer, v_accountant] loop
    perform tests.authenticate(v_person);
    begin
      insert into public.workflow_rule (organization_id, name, trigger_event, engine, graph)
      values (v_org, 'Forged graph', 'object_event', 'graph_v2', v_graph);
      raise exception 'FAIL: % saved a graph workflow', v_person;
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot save a graph workflow', v_person));
    end;
    update public.workflow_rule set enabled = false where id = v_rule;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('%s cannot switch a graph workflow off', v_person));
    reset role;
  end loop;

  -- Signed out: nothing at all.
  perform tests.clear_auth();
  select count(*) into n from public.workflow_execution_step;
  perform tests.ok(n = 0, 'a signed-out visitor reads no run steps');
  select count(*) into n from public.workflow_rule;
  perform tests.ok(n = 0, 'a signed-out visitor reads no workflows');
  begin
    insert into public.workflow_execution_step (execution_id, organization_id, position, step_id, step_kind, status)
    values (v_run, v_org, 10, 'forged', 'action', 'succeeded');
    raise exception 'FAIL: a signed-out visitor wrote a run step';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out visitor cannot write a run step');
  end;
  reset role;

  -- app.can_as: only the service role may ask on someone's behalf.
  perform tests.ok(
    not has_function_privilege('anon', 'public.can_as(uuid, uuid, text, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.can_as(uuid, uuid, text, text)', 'execute')
      and not has_function_privilege('authenticated', 'app.can_as(uuid, uuid, text, text)', 'execute')
      and has_function_privilege('service_role', 'public.can_as(uuid, uuid, text, text)', 'execute'),
    'only the service role can ask the access question on someone''s behalf'
  );
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'can_as' and n.nspname in ('app', 'public')),
    'can_as is security definer with an empty search_path'
  );

  -- Same answers as the person would get themselves, at the first sign-in level.
  perform tests.ok(app.can_as(v_volunteer, t_assigned, 'view'), 'can_as: the volunteer can view their task');
  perform tests.ok(not app.can_as(v_volunteer, t_unrelated, 'view'), 'can_as: the volunteer cannot view a task that is not theirs');
  perform tests.ok(not app.can_as(v_volunteer, t_assigned, 'manage'), 'can_as: the volunteer cannot manage their task');
  perform tests.ok(app.can_as(v_owner, t_unrelated, 'view'), 'can_as: the owner can view any task');
  perform tests.ok(not app.can_as(null, t_unrelated, 'view'), 'can_as: nobody means no');
  perform tests.ok(not app.can_as(v_owner, gen_random_uuid(), 'view'), 'can_as: an unknown object means no');
  perform tests.ok(not app.can_as(v_owner, t_unrelated, 'view', 'aal3'), 'can_as: an unknown sign-in level means no');

  -- The two-step level: an owner edits at aal2 only with a live second factor.
  delete from auth.mfa_factors where user_id = v_owner;
  perform tests.ok(not app.can_as(v_owner, t_unrelated, 'edit_content'), 'can_as: the owner cannot edit at aal1');
  perform tests.ok(not app.can_as(v_owner, t_unrelated, 'edit_content', 'aal2'),
    'can_as: aal2 without a verified second factor still cannot edit');
  perform tests.ensure_verified_mfa_factor(v_owner);
  perform tests.ok(app.can_as(v_owner, t_unrelated, 'edit_content', 'aal2'),
    'can_as: the owner with a verified second factor edits at aal2');
  perform tests.ok(not app.can_as(v_volunteer, t_unrelated, 'edit_content', 'aal2'),
    'can_as: aal2 never widens what a volunteer may do');

  -- The caller's own identity is back afterwards.
  perform tests.authenticate(v_staff);
  reset role;
  perform app.can_as(v_owner, t_unrelated, 'view');
  perform tests.ok(auth.uid() = v_staff, 'can_as restores the caller''s identity');
  perform tests.ok(coalesce(auth.jwt() ->> 'aal', '') = 'aal2', 'can_as restores the caller''s sign-in level');
end;
$$;

rollback;
