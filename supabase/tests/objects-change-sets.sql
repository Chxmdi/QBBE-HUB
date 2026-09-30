-- Workspace OS M13: change sets (20261101010800_change_sets.sql). Recording
-- needs edit_content on every object named; reading is the actor, or anyone
-- who can view everything touched; undo is once, within 30 days. Allow and
-- deny for owner, admin, staff, volunteer, guest, the external accountant
-- and signed-out. Run after qa-users.sql and rls.sql. Rolled back.
begin;

create or replace function tests.change_sets_raises(p_sql text)
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
grant execute on function tests.change_sets_raises(text) to anon, authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_task uuid;
  v_other uuid;
  v_marker bigint;
  v_set public.change_set;
  v_undo public.change_set;
  v_person uuid;
  v_changes jsonb;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'guest', status = 'active'
  where organization_id = v_org and user_id = v_accountant;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner)
  on conflict do nothing;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Change sets', 'change-sets-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Change sets project', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Volunteer task', v_owner, v_volunteer) returning id into v_task;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Not the volunteer''s', v_owner) returning id into v_other;

  v_changes := jsonb_build_array(jsonb_build_object(
    'kind', 'update', 'object', jsonb_build_object('id', v_task, 'type', 'task'),
    'property', 'status', 'before', 'not_started', 'after', 'in_progress'));

  -- The volunteer changes their own task and records it, as the API does.
  perform tests.authenticate(v_volunteer);
  v_marker := public.object_event_high_water();
  update public.task set status = 'in_progress' where id = v_task;
  v_set := public.record_change_set('object.set_property', v_changes, v_marker);
  reset role;

  perform tests.ok(
    v_set.actor_kind = 'person' and v_set.actor_id = v_volunteer::text and v_set.organization_id = v_org
      and (select count(*) from public.change_set_item where change_set_id = v_set.id) = 1,
    'recording stores the change set and its item, labelled with the caller'
  );
  perform tests.ok(
    exists (select 1 from public.object_event where object_id = v_task and change_set_id = v_set.id
      and changes @> '[{"property":"status"}]'),
    'the caller''s event on the task since the marker is labelled with the change set'
  );

  -- Forgery and bad input are refused.
  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    tests.change_sets_raises(format(
      'select public.record_change_set(''object.set_property'', %L::jsonb)',
      jsonb_build_array(jsonb_build_object('kind', 'update', 'object', jsonb_build_object('id', v_other, 'type', 'task'),
        'property', 'status', 'before', 'a', 'after', 'b')))),
    'the volunteer cannot record a change set for a task they cannot edit'
  );
  perform tests.ok(
    tests.change_sets_raises('select public.record_change_set(''object.set_property'', ''[]''::jsonb)')
      and tests.change_sets_raises(format('select public.record_change_set(''not a key'', %L::jsonb)', v_changes))
      and tests.change_sets_raises(format(
        'select public.record_change_set(''object.set_property'', %L::jsonb)',
        jsonb_build_array(jsonb_build_object('kind', 'update', 'object', jsonb_build_object('id', gen_random_uuid(), 'type', 'task'),
          'property', 'status')))),
    'empty change sets, bad action keys and unknown objects are refused'
  );
  perform tests.ok(
    tests.change_sets_raises(format(
      'insert into public.change_set (organization_id, action_key, actor_kind) values (%L, ''object.x'', ''person'')', v_org))
      and tests.change_sets_raises(format('update public.change_set set undone_at = now() where id = %L', v_set.id))
      and tests.change_sets_raises(format('delete from public.change_set_item where change_set_id = %L', v_set.id)),
    'change sets are written only through record_change_set'
  );

  -- Undo: once.
  update public.task set status = 'not_started' where id = v_task;
  v_undo := public.record_change_set('object.set_property',
    jsonb_build_array(jsonb_build_object('kind', 'update', 'object', jsonb_build_object('id', v_task, 'type', 'task'),
      'property', 'status', 'before', 'in_progress', 'after', 'not_started')),
    null, v_set.id);
  perform tests.ok(
    v_undo.undo_of = v_set.id,
    'the undo is recorded with undo_of'
  );
  perform tests.ok(
    tests.change_sets_raises(format(
      'select public.record_change_set(''object.set_property'', %L::jsonb, null, %L)', v_changes, v_set.id)),
    'a change set cannot be undone twice'
  );
  reset role;
  perform tests.ok((select undone_at is not null from public.change_set where id = v_set.id),
    'the original is marked undone');

  -- 30 days.
  update public.change_set set created_at = now() - interval '31 days', undone_at = null where id = v_set.id;
  delete from public.change_set where id = v_undo.id;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    tests.change_sets_raises(format(
      'select public.record_change_set(''object.set_property'', %L::jsonb, null, %L)', v_changes, v_set.id)),
    'a change set older than 30 days cannot be undone'
  );
  reset role;

  -- Reading: the actor, and whoever can view everything touched.
  foreach v_person in array array[v_owner, v_admin, v_volunteer] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      exists (select 1 from public.change_set where id = v_set.id)
        and exists (select 1 from public.change_set_item where change_set_id = v_set.id),
      format('%s reads the change set and its items', v_person)
    );
    reset role;
  end loop;
  foreach v_person in array array[v_staff, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      exists (select 1 from public.change_set where id = v_set.id) = public.can(v_task, 'view'),
      format('%s reads the change set exactly when they can view the task', v_person)
    );
    reset role;
  end loop;
  perform tests.authenticate(v_guest);
  perform tests.ok(
    not exists (select 1 from public.change_set_item where change_set_id = v_set.id),
    'a guest with no grant reads no items'
  );
  reset role;

  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname in ('record_change_set', 'object_event_high_water', 'can_read_change_set')),
    'change set functions are security definer with an empty search_path'
  );
  perform tests.ok(
    not has_function_privilege('authenticated', 'app.record_change_set(text, jsonb, bigint, uuid)', 'execute'),
    'signed-in people reach record_change_set only through its public wrapper'
  );
end;
$$;

do $$
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.change_sets_raises('select 1 from public.change_set limit 1')
      and tests.change_sets_raises('select public.record_change_set(''object.x'', ''[]''::jsonb)')
      and tests.change_sets_raises('select public.object_event_high_water()'),
    'a signed-out visitor can neither read nor record change sets'
  );
  reset role;
end;
$$;

rollback;
