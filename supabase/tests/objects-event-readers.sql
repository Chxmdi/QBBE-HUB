-- Workspace OS M9b: the readers of object_event give the same output as the
-- tables they replace (20261101010700_object_event_readers.sql).
--
-- The comparison: the same task changes are made once, both the old writer
-- (task_material_audited into audit_event) and object_event record them,
-- and object_material_audit must equal audit_event row for row. The feed
-- must scope events to the project and program the old feed filtered by.
-- Allow and deny for owner, admin, staff, volunteer, guest, the external
-- accountant and signed-out. Run after qa-users.sql and rls.sql. Rolled back.
begin;

create or replace function tests.readers_raises(p_sql text)
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
grant execute on function tests.readers_raises(text) to anon, authenticated;

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
  v_task_two uuid;
  v_since timestamptz := now();
  v_old jsonb;
  v_new jsonb;
  v_missing jsonb;
  v_extra jsonb;
  v_person uuid;
  v_count integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'guest', status = 'active'
  where organization_id = v_org and user_id = v_accountant;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner)
  on conflict do nothing;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Readers', 'readers-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Readers project', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Book the hall', v_owner) returning id into v_task;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Order chairs', v_owner, v_volunteer) returning id into v_task_two;

  -- The same material changes the old audit trigger watches.
  update public.task set assignee_id = v_volunteer where id = v_task;
  update public.task set status = 'in_progress', due_at = '2026-10-20' where id = v_task;
  update public.task set assignee_id = v_staff, status = 'blocked', blocked_reason = 'Waiting on the venue' where id = v_task;
  update public.task set due_at = null where id = v_task;
  update public.task set archived_at = now() where id = v_task;
  update public.task set archived_at = null, status = 'ready' where id = v_task;
  update public.task set title = 'Book the big hall', sort_key = 9 where id = v_task;
  delete from public.task where id = v_task_two;

  -- The comparison, as multisets of (event type, action, object, metadata).
  select coalesce(jsonb_agg(jsonb_build_array(event_type, action, object_id, metadata) order by 1), '[]')
  into v_old
  from public.audit_event
  where object_type = 'task' and object_id in (v_task, v_task_two)
    and event_type like 'task.%' and created_at >= v_since;
  select coalesce(jsonb_agg(jsonb_build_array(event_type, action, object_id, metadata) order by 1), '[]')
  into v_new
  from public.object_material_audit
  where object_id in (v_task, v_task_two) and occurred_at >= v_since;

  select coalesce(jsonb_agg(x), '[]') into v_missing
  from jsonb_array_elements(v_old) x
  where (select count(*) from jsonb_array_elements(v_old) y where y = x)
     <> (select count(*) from jsonb_array_elements(v_new) y where y = x);
  select coalesce(jsonb_agg(x), '[]') into v_extra
  from jsonb_array_elements(v_new) x
  where (select count(*) from jsonb_array_elements(v_old) y where y = x)
     <> (select count(*) from jsonb_array_elements(v_new) y where y = x);

  perform tests.ok(jsonb_array_length(v_old) >= 9,
    format('the old audit trigger wrote its rows (%s)', jsonb_array_length(v_old)));
  perform tests.ok(
    jsonb_array_length(v_missing) = 0 and jsonb_array_length(v_extra) = 0
      and jsonb_array_length(v_old) = jsonb_array_length(v_new),
    format('object_material_audit equals audit_event row for row (missing %s, extra %s)', v_missing, v_extra)
  );

  -- Tracked fields task history describes today are all in the events.
  perform tests.ok(
    exists (select 1 from public.object_event where object_id = v_task
      and changes @> '[{"property":"blocked_reason","after":"Waiting on the venue"}]'),
    'the blocked reason (tracked by task history) is in the event'
  );
  perform tests.ok(
    (select changes @> '[{"property":"title","before":"Order chairs","after":null}]'
     from public.object_event where object_id = v_task_two and verb = 'deleted'),
    'a deleted event keeps the last values'
  );

  -- Scope for the project and program feeds.
  perform tests.ok(
    (select bool_and(project_id = v_project and program_id = v_program)
     from public.object_event where object_id in (v_task, v_task_two)),
    'every task event carries its project and program, the deleted task''s included'
  );
  perform tests.ok(
    (select bool_and(project_id = v_project and program_id = v_program)
     from public.object_event where object_id = v_project),
    'a project''s own events carry it as their project'
  );
  perform tests.ok(
    (select count(*) from public.object_activity_feed
     where project_id = v_project and origin = 'object_event' and source_type = 'task')
      = (select count(*) from public.object_event where project_id = v_project and object_type = 'task'),
    'the feed lists the project''s task events'
  );
  perform tests.ok(
    not exists (select 1 from public.object_activity_feed f
      where f.origin = 'activity_event' and f.created_at >= app.object_event_started_at(f.organization_id)),
    'old-writer rows from after object_event started are left out, so nothing shows twice'
  );

  -- Reading.
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    select count(*) into v_count from public.object_material_audit where object_id in (v_task, v_task_two);
    perform tests.ok(v_count = jsonb_array_length(v_new),
      format('%s reads the whole derived audit trail', v_person));
    reset role;
  end loop;

  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    not exists (select 1 from public.object_activity_feed where source_id = v_task and origin = 'object_event')
      = not public.can(v_task, 'view'),
    'the volunteer reads the task''s feed exactly when they can view the task'
  );
  perform tests.ok(
    not exists (select 1 from public.object_material_audit where object_id = v_task_two),
    'the volunteer does not read the deleted task''s audit rows'
  );
  reset role;

  foreach v_person in array array[v_staff, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    select count(*) into v_count from public.object_activity_feed
    where source_id = v_task and origin = 'object_event';
    perform tests.ok(
      (v_count > 0) = public.can(v_task, 'view'),
      format('%s reads the task''s feed exactly when they can view it', v_person)
    );
    perform tests.ok(
      not exists (select 1 from public.object_material_audit where object_id = v_task_two),
      format('%s does not read the deleted task''s audit rows', v_person)
    );
    reset role;
  end loop;
end;
$$;

do $$
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.readers_raises('select 1 from public.object_activity_feed limit 1')
      and tests.readers_raises('select 1 from public.object_material_audit limit 1'),
    'a signed-out visitor reads neither view'
  );
  reset role;
end;
$$;

rollback;
