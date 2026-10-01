-- Workspace OS integration I1: change sets and labelled events for automations
-- (20261107010100_automation_change_sets.sql). The service role records a
-- change set as an automation or integration, checked for the person it acts
-- as, and a task write made that way carries the automation into object_event.
-- A person's change set may name records outside the registry (milestones,
-- approval items) when anchored to an organization. Allow and deny for the
-- service role, owner, volunteer and signed-out. Run after qa-users.sql and
-- rls.sql. Rolled back.
begin;

create or replace function tests.automation_raises(p_sql text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end;
$$;
grant execute on function tests.automation_raises(text) to anon, authenticated, service_role;
-- The service role runs part of this file; rls.sql opens the helpers to signed-in roles only.
grant usage on schema tests to service_role;
grant execute on function tests.ok(boolean, text) to service_role;

create or replace function tests.automation_last_event(p_object uuid)
returns public.object_event
language sql
set search_path = ''
as $$
  select * from public.object_event where object_id = p_object order by seq desc limit 1;
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_task uuid;
  v_other uuid;
  v_milestone uuid;
  v_rule uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_marker bigint;
  v_set public.change_set;
  v_undo public.change_set;
  e public.object_event;
  v_changes jsonb;
  v_milestone_changes jsonb;
  v_approval_changes jsonb;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  -- The runner asks at aal2 for an owner who saved the workflow in a two-step
  -- session; without a verified factor app.can_as falls back to aal1, where an
  -- owner may only read.
  perform tests.ensure_verified_mfa_factor(v_owner);

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Automations', 'automations-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Automations project', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Volunteer task', v_owner, v_volunteer) returning id into v_task;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Not the volunteer''s', v_owner) returning id into v_other;
  insert into public.milestone (project_id, name, due_date)
  values (v_project, 'Print', date '2026-10-10') returning id into v_milestone;

  v_changes := jsonb_build_array(jsonb_build_object(
    'kind', 'update', 'object', jsonb_build_object('id', v_task, 'type', 'task'),
    'property', 'status', 'before', 'not_started', 'after', 'in_progress'));
  v_milestone_changes := jsonb_build_array(jsonb_build_object(
    'kind', 'update', 'object', jsonb_build_object('id', v_milestone, 'type', 'milestone'),
    'property', 'due', 'before', '2026-10-10', 'after', '2026-10-13'));
  v_approval_changes := jsonb_build_array(
    jsonb_build_object('kind', 'create', 'object', jsonb_build_object('id', v_item, 'type', 'approval_item'),
      'values', jsonb_build_object('title', 'Print locally')),
    jsonb_build_object('kind', 'link', 'relation', jsonb_build_object(
      'relationTypeKey', 'approval_of',
      'from', jsonb_build_object('id', v_item, 'type', 'approval_item'),
      'to', jsonb_build_object('id', v_task, 'type', 'task'))));

  -- Privileges: the automation functions are the service role's alone.
  perform tests.ok(
    has_function_privilege('service_role', 'public.record_change_set_as(text, uuid, text, jsonb, bigint, uuid, text, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_change_set_as(text, uuid, text, jsonb, bigint, uuid, text, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.record_change_set_as(text, uuid, text, jsonb, bigint, uuid, text, uuid)', 'execute')
      and has_function_privilege('service_role', 'public.apply_task_update_as(text, uuid, uuid, jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.apply_task_update_as(text, uuid, uuid, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.apply_task_update_as(text, uuid, uuid, jsonb)', 'execute')
      and has_function_privilege('service_role', 'public.object_event_high_water()', 'execute'),
    'only the service role records change sets or changes tasks as an automation'
  );
  perform tests.ok(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'record_change_set') = 1
      and (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.proname in ('record_change_set', 'record_change_set_as', 'record_change_set_for', 'apply_task_update_as')),
    'one public record_change_set remains, and every recording function is security definer with an empty search_path'
  );

  -- The service role, as the workflow runner: a marker, a labelled write, a change set.
  perform set_config('role', 'service_role', true);
  v_marker := public.object_event_high_water();
  perform tests.ok(v_marker is not null, 'the service role takes an event marker');
  perform tests.ok(
    public.apply_task_update_as('automation:' || v_rule::text, v_org, v_task, '{"status": "in_progress"}'::jsonb) = v_task,
    'the service role changes a task as an automation'
  );
  reset role;
  e := tests.automation_last_event(v_task);
  perform tests.ok(
    e.actor_kind = 'automation' and e.actor_id = v_rule::text and e.verb = 'updated'
      and e.changes @> '[{"property": "status", "after": "in_progress"}]'::jsonb and e.seq > v_marker,
    'the task''s object_event names the automation, not system'
  );
  perform tests.ok(
    coalesce(current_setting('app.actor', true), '') = '',
    'the actor setting does not outlive the write'
  );
  perform tests.ok(
    (select status::text from public.task where id = v_task) = 'in_progress',
    'the task row changed'
  );

  perform set_config('role', 'service_role', true);
  v_set := public.record_change_set_as('automation:' || v_rule::text, v_owner, 'task.set_status', v_changes, v_marker, null, 'aal2');
  reset role;
  perform tests.ok(
    v_set.actor_kind = 'automation' and v_set.actor_id = v_rule::text and v_set.organization_id = v_org
      and (select count(*) from public.change_set_item where change_set_id = v_set.id) = 1,
    'the change set is labelled with the automation and holds its item'
  );
  perform tests.ok(
    (select change_set_id from public.object_event where id = e.id) = v_set.id,
    'the automation''s event since the marker is labelled with its change set'
  );

  -- Undo as the automation: once, with undo_of.
  perform set_config('role', 'service_role', true);
  perform public.apply_task_update_as('automation:' || v_rule::text, v_org, v_task, '{"status": "not_started"}'::jsonb);
  v_undo := public.record_change_set_as('automation:' || v_rule::text, v_owner, 'task.set_status',
    jsonb_build_array(jsonb_build_object('kind', 'update', 'object', jsonb_build_object('id', v_task, 'type', 'task'),
      'property', 'status', 'before', 'in_progress', 'after', 'not_started')),
    null, v_set.id, 'aal2');
  perform tests.ok(
    v_undo.undo_of = v_set.id and (select undone_at is not null from public.change_set where id = v_set.id),
    'the automation''s undo is recorded with undo_of and marks the original undone'
  );
  perform tests.ok(
    tests.automation_raises(format(
      'select public.record_change_set_as(%L, %L, ''task.set_status'', %L::jsonb, null, %L, ''aal2'')',
      'automation:' || v_rule::text, v_owner, v_changes, v_set.id)),
    'a change set cannot be undone twice by an automation either'
  );

  -- Deny: the person acted for must hold the capability; the actor must be an
  -- automation or integration; only the workflow columns change.
  perform tests.ok(
    tests.automation_raises(format(
      'select public.record_change_set_as(%L, %L, ''task.set_status'', %L::jsonb, null, null, ''aal1'')',
      'automation:' || v_rule::text, v_volunteer,
      jsonb_build_array(jsonb_build_object('kind', 'update', 'object', jsonb_build_object('id', v_other, 'type', 'task'),
        'property', 'status', 'before', 'a', 'after', 'b')))),
    'an automation cannot record a change set for a task its owner cannot edit'
  );
  perform tests.ok(
    tests.automation_raises(format(
      'select public.record_change_set_as(%L, %L, ''task.set_status'', %L::jsonb)', 'person:' || v_owner::text, v_owner, v_changes))
      and tests.automation_raises(format(
      'select public.record_change_set_as(%L, %L, ''task.set_status'', %L::jsonb)', 'robot:' || v_rule::text, v_owner, v_changes))
      and tests.automation_raises(format(
      'select public.record_change_set_as(%L, %L, ''task.set_status'', %L::jsonb)', 'automation:', v_owner, v_changes))
      and tests.automation_raises(format(
      'select public.record_change_set_as(%L, %L, ''task.set_status'', %L::jsonb, null, null, ''aal9'')', 'automation:' || v_rule::text, v_owner, v_changes)),
    'the actor must be automation:<id> or integration:<name>, at a known level'
  );
  perform tests.ok(
    tests.automation_raises(format(
      'select public.apply_task_update_as(%L, %L, %L, ''{"priority": "high"}''::jsonb)', 'person:' || v_owner::text, v_org, v_task))
      and tests.automation_raises(format(
      'select public.apply_task_update_as(%L, %L, %L, ''{"title": "renamed"}''::jsonb)', 'automation:' || v_rule::text, v_org, v_task))
      and tests.automation_raises(format(
      'select public.apply_task_update_as(%L, %L, %L, ''{}''::jsonb)', 'automation:' || v_rule::text, v_org, v_task)),
    'a task write as an automation needs an automation actor and touches only the workflow columns'
  );
  perform tests.ok(
    public.apply_task_update_as('automation:' || v_rule::text, gen_random_uuid(), v_task, '{"priority": "high"}'::jsonb) is null
      and (select priority::text from public.task where id = v_task) <> 'high',
    'a task outside the named organization is not changed'
  );
  perform tests.ok(
    public.apply_task_update_as('integration:api:token-1', v_org, v_task, '{"priority": "high"}'::jsonb) = v_task,
    'an integration writes the same way'
  );
  reset role;
  e := tests.automation_last_event(v_task);
  perform tests.ok(
    e.actor_kind = 'integration' and e.actor_id = 'api:token-1',
    'the integration''s event keeps the whole name after the kind'
  );

  -- A signed-in person cannot act as an automation.
  perform tests.authenticate(v_owner);
  perform tests.ok(
    tests.automation_raises(format(
      'select public.record_change_set_as(%L, %L, ''task.set_status'', %L::jsonb)', 'automation:' || v_rule::text, v_owner, v_changes))
      and tests.automation_raises(format(
      'select public.apply_task_update_as(%L, %L, %L, ''{"priority": "low"}''::jsonb)', 'automation:' || v_rule::text, v_org, v_task)),
    'a signed-in person can neither record a change set nor change a task as an automation'
  );

  -- The person path is unchanged, and now takes records outside the registry.
  v_marker := public.object_event_high_water();
  update public.task set status = 'in_progress' where id = v_task;
  v_set := public.record_change_set('object.set_property', v_changes, v_marker);
  perform tests.ok(
    v_set.actor_kind = 'person' and v_set.actor_id = v_owner::text
      and exists (select 1 from public.object_event where object_id = v_task and change_set_id = v_set.id),
    'a person''s change set is recorded and labels their events as before'
  );
  v_set := public.record_change_set('insight.shift_milestone', v_milestone_changes, null, null, v_org);
  perform tests.ok(
    v_set.organization_id = v_org
      and (select object_type from public.change_set_item where change_set_id = v_set.id) = 'milestone',
    'a milestone shift is recorded when anchored to the organization'
  );
  perform tests.ok(
    tests.automation_raises(format('select public.record_change_set(''insight.shift_milestone'', %L::jsonb)', v_milestone_changes)),
    'a change set of unregistered records alone needs its organization'
  );
  perform tests.ok(
    tests.automation_raises(format(
      'select public.record_change_set(''insight.shift_milestone'', %L::jsonb, null, null, %L)', v_milestone_changes, gen_random_uuid())),
    'the organization named must be one the person belongs to'
  );
  perform tests.ok(
    tests.automation_raises(format(
      'select public.record_change_set(''object.set_property'', %L::jsonb, null, null, %L)',
      jsonb_build_array(jsonb_build_object('kind', 'update', 'object', jsonb_build_object('id', gen_random_uuid(), 'type', 'task'),
        'property', 'status', 'before', 'a', 'after', 'b')), v_org)),
    'a record of a registered type must still exist, organization or not'
  );
  perform tests.ok(
    tests.automation_raises(format(
      'select public.record_change_set(''object.set_property'', %L::jsonb, null, null, %L)',
      jsonb_build_array(jsonb_build_object('kind', 'update', 'object', jsonb_build_object('id', gen_random_uuid()),
        'property', 'status', 'before', 'a', 'after', 'b')), v_org)),
    'an unregistered record must at least say its type'
  );
  v_set := public.record_change_set('object.request_approval', v_approval_changes);
  perform tests.ok(
    v_set.organization_id = v_org
      and (select count(*) from public.change_set_item where change_set_id = v_set.id) = 2,
    'an approval request (item plus link to the record) is recorded, anchored by the record'
  );
  reset role;

  -- Reading: a change set naming only unregistered records is its actor's alone.
  perform tests.authenticate(v_volunteer);
  v_set := public.record_change_set('insight.shift_milestone', v_milestone_changes, null, null, v_org);
  perform tests.ok(
    (select count(*) from public.change_set where id = v_set.id) = 1,
    'the volunteer reads their own milestone change set'
  );
  reset role;
  perform tests.authenticate(v_owner);
  perform tests.ok(
    (select count(*) from public.change_set where id = v_set.id) = 0,
    'nobody else reads a change set of records the registry cannot check'
  );
  reset role;
end;
$$;

do $$
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.automation_raises('select public.record_change_set_as(''automation:x'', ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'', ''task.x'', ''[]''::jsonb)')
      and tests.automation_raises('select public.apply_task_update_as(''automation:x'', gen_random_uuid(), gen_random_uuid(), ''{"priority": "low"}''::jsonb)')
      and tests.automation_raises('select public.object_event_high_water()'),
    'a signed-out visitor can do none of this'
  );
  reset role;
end;
$$;

rollback;
