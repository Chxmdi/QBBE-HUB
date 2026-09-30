-- Workspace OS S6 V1-12 part 2 (20261106010003_workflow_steps): reviews, the
-- webhook signing key and approvals submitted by workflows. Allow and deny for
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
  v_review uuid;
  v_other_review uuid;
  v_item uuid;
  v_person uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner);

  insert into public.workflow_rule (organization_id, name, trigger_event, engine, graph, created_by)
  values (v_org, 'Steps', 'object_event', 'graph_v2',
    '{"version":1,"trigger":{"objectTypes":[],"verbs":[]},"start":null,"steps":[]}', v_owner)
  returning id into v_rule;
  insert into public.workflow_execution (organization_id, rule_id, rule_name, trigger_event, source_type, source_id, outcome, engine)
  values (v_org, v_rule, 'Steps', 'object_event', 'task', gen_random_uuid(), 'waiting', 'graph_v2')
  returning id into v_run;

  begin
    update public.workflow_execution set waiting_on_kind = 'approval' where id = v_run;
    raise exception 'FAIL: waiting on an approval without its id was accepted';
  exception when check_violation then
    perform tests.ok(true, 'what a run waits on has a kind and an id together');
  end;

  insert into public.workflow_review (organization_id, execution_id, step_id, reviewer_id, instructions)
  values (v_org, v_run, 'check', v_volunteer, 'Is this right?') returning id into v_review;
  insert into public.workflow_review (organization_id, execution_id, step_id, reviewer_id, instructions)
  values (v_org, v_run, 'check-2', v_staff, 'And this?') returning id into v_other_review;
  insert into public.workflow_webhook_secret (rule_id, organization_id, secret)
  values (v_rule, v_org, repeat('k', 64));

  -- Reading reviews: the reviewer their own; owners and admins all of them.
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.workflow_review where execution_id = v_run;
  perform tests.ok(n = 1, 'the reviewer reads only their own review');
  reset role;
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    select count(*) into n from public.workflow_review where execution_id = v_run;
    perform tests.ok(n = 2, format('%s (owner or admin) reads every review', v_person));
    reset role;
  end loop;
  foreach v_person in array array[v_member, v_accountant] loop
    perform tests.authenticate(v_person);
    select count(*) into n from public.workflow_review where execution_id = v_run;
    perform tests.ok(n = 0, format('%s (member or accountant) reads no one else''s review', v_person));
    reset role;
  end loop;

  -- Nobody writes reviews directly, and nobody reads the signing key.
  foreach v_person in array array[v_owner, v_admin, v_staff, v_member, v_volunteer, v_accountant] loop
    perform tests.authenticate(v_person);
    update public.workflow_review set status = 'approved', decided_at = now() where id = v_review;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('%s cannot decide a review by writing to the table', v_person));
    begin
      insert into public.workflow_review (organization_id, execution_id, step_id, reviewer_id, instructions)
      values (v_org, v_run, 'forged', v_person, 'forged');
      raise exception 'FAIL: % created a review', v_person;
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot create a review', v_person));
    end;
    select count(*) into n from public.workflow_webhook_secret;
    perform tests.ok(n = 0, format('%s cannot read webhook signing keys', v_person));
    reset role;
  end loop;

  -- Deciding: only the reviewer, only once, only approve or reject.
  foreach v_person in array array[v_owner, v_admin, v_staff, v_member, v_accountant] loop
    perform tests.authenticate(v_person);
    begin
      perform public.decide_workflow_review(v_review, 'approved', null);
      raise exception 'FAIL: % decided someone else''s review', v_person;
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot decide someone else''s review', v_person));
    end;
    reset role;
  end loop;
  perform tests.authenticate(v_volunteer);
  begin
    perform public.decide_workflow_review(v_review, 'maybe', null);
    raise exception 'FAIL: an unknown decision was accepted';
  exception when invalid_parameter_value then
    perform tests.ok(true, 'a review is approved or rejected, nothing else');
  end;
  perform public.decide_workflow_review(v_review, 'approved', '  Looks right  ');
  perform tests.ok(
    (select status = 'approved' and comment = 'Looks right' and decided_at is not null
     from public.workflow_review where id = v_review),
    'the reviewer approves their review, with a trimmed comment'
  );
  begin
    perform public.decide_workflow_review(v_review, 'rejected', null);
    raise exception 'FAIL: a decided review was decided again';
  exception when invalid_parameter_value then
    perform tests.ok(true, 'a decided review stays decided');
  end;
  reset role;

  perform tests.clear_auth();
  select count(*) into n from public.workflow_review;
  perform tests.ok(n = 0, 'a signed-out visitor reads no reviews');
  begin
    perform public.decide_workflow_review(v_other_review, 'approved', null);
    raise exception 'FAIL: a signed-out visitor decided a review';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out visitor cannot decide a review');
  end;
  reset role;

  -- Approvals submitted as the workflow's owner.
  perform tests.ok(
    not has_function_privilege('authenticated', 'public.workflow_submit_approval(uuid, uuid, text, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.workflow_submit_approval(uuid, uuid, text, text, text)', 'execute')
      and has_function_privilege('service_role', 'public.workflow_submit_approval(uuid, uuid, text, text, text)', 'execute'),
    'only the service role submits approvals for workflows'
  );
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where p.proname = 'workflow_submit_approval' and ns.nspname in ('app', 'public')),
    'workflow_submit_approval is security definer with an empty search_path'
  );
  v_item := app.workflow_submit_approval(v_staff, v_org, 'other', 'Workflow asks', 'Please approve');
  perform tests.ok(
    (select requested_by = v_staff and status = 'pending' from public.approval_item where id = v_item),
    'a staff owner''s workflow submits an approval in their name'
  );
  begin
    perform app.workflow_submit_approval(v_volunteer, v_org, 'other', 'Not allowed', null);
    raise exception 'FAIL: a volunteer''s workflow submitted an approval';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a volunteer''s workflow cannot submit an approval (the engine''s own rule)');
  end;
  perform tests.ok(auth.uid() is null, 'workflow_submit_approval leaves no identity behind');
end;
$$;

rollback;
