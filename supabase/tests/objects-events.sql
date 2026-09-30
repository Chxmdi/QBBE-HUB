-- Workspace OS M9a: object_event written by triggers for every native type,
-- custom values, relations and custom objects
-- (20261101010600_object_events.sql). Allow and deny for owner, admin,
-- staff, volunteer, guest, the external accountant and signed-out. Run after
-- qa-users.sql and rls.sql. All mutations are rolled back.
begin;

create or replace function tests.events_raises(p_sql text)
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
grant execute on function tests.events_raises(text) to anon, authenticated;

-- The latest event for an object, as the database owner sees it.
create or replace function tests.last_event(p_object uuid)
returns public.object_event
language sql
set search_path = ''
as $$
  select * from public.object_event where object_id = p_object order by seq desc limit 1;
$$;

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
  v_other_task uuid;
  v_meeting uuid;
  v_decision uuid;
  v_risk uuid;
  v_metric uuid;
  v_team uuid;
  v_event uuid;
  v_contact uuid;
  v_document uuid;
  v_task_type uuid;
  p_public uuid;
  p_private uuid;
  v_related uuid;
  v_custom_type uuid;
  v_custom uuid;
  v_change_set uuid := gen_random_uuid();
  v_before bigint;
  e public.object_event;
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
  select id into v_task_type from public.object_type where organization_id = v_org and key = 'task';
  select id into v_related from public.relation_type where organization_id = v_org and key = 'related_to';

  -- Created, for every native type.
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Events', 'events-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Events project', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Order food', v_owner, v_volunteer) returning id into v_task;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Other task', v_owner) returning id into v_other_task;
  insert into public.meeting (organization_id, project_id, title, organizer_id, starts_at)
  values (v_org, v_project, 'Planning', v_owner, now()) returning id into v_meeting;
  insert into public.decision (organization_id, project_id, title) values (v_org, v_project, 'Decide') returning id into v_decision;
  insert into public.risk (organization_id, project_id, title) values (v_org, v_project, 'Rain') returning id into v_risk;
  insert into public.outcome_metric (organization_id, program_id, name) values (v_org, v_program, 'Meals') returning id into v_metric;
  insert into public.team (organization_id, name, owner_id) values (v_org, 'Crew', v_staff) returning id into v_team;
  insert into public.event (organization_id, project_id, name, starts_at) values (v_org, v_project, 'Fair', now()) returning id into v_event;
  insert into public.crm_contact (organization_id, full_name) values (v_org, 'Donor') returning id into v_contact;
  insert into public.document (organization_id, project_id, title, kind, url)
  values (v_org, v_project, 'Plan', 'link', 'https://drive.google.com/file/d/plan/view') returning id into v_document;

  perform tests.ok(
    (select count(distinct object_type) from public.object_event
     where verb = 'created' and object_id in (v_project, v_task, v_meeting, v_decision, v_risk, v_metric,
       v_team, v_event, v_contact, v_document)) = 10,
    'creating a record of each of the ten native tables writes a created event'
  );
  e := tests.last_event(v_task);
  perform tests.ok(e.verb = 'created' and e.object_type = 'task' and e.actor_kind = 'system'
      and e.organization_id = v_org,
    'with nobody signed in, the actor is the system');

  -- Updated: system properties only, by key.
  update public.task set due_at = '2026-10-15', sort_key = 42 where id = v_task;
  e := tests.last_event(v_task);
  perform tests.ok(
    e.verb = 'updated' and e.changes = jsonb_build_array(jsonb_build_object(
      'property', 'due', 'before', null, 'after', '2026-10-15')),
    'a due date change is recorded as property "due", and sort_key is not recorded'
  );
  select count(*) into v_before from public.object_event where object_id = v_task;
  update public.task set sort_key = 43 where id = v_task;
  perform tests.ok(
    (select count(*) from public.object_event where object_id = v_task) = v_before,
    'a sort_key-only change writes no event'
  );
  update public.task set archived_at = now() where id = v_task;
  perform tests.ok((tests.last_event(v_task)).verb = 'archived', 'archiving writes archived');
  update public.task set archived_at = null where id = v_task;
  perform tests.ok((tests.last_event(v_task)).verb = 'restored', 'restoring writes restored');
  update public.meeting set status = 'cancelled' where id = v_meeting;
  perform tests.ok((tests.last_event(v_meeting)).verb = 'archived', 'a cancelled meeting is archived');
  update public.team set name = 'Kitchen crew' where id = v_team;
  e := tests.last_event(v_team);
  perform tests.ok(e.verb = 'updated' and e.changes -> 0 ->> 'property' = 'title'
      and e.changes -> 0 ->> 'after' = 'Kitchen crew',
    'renaming a team writes its title change');

  -- Actor and change set from the session.
  perform set_config('app.actor', 'automation:' || v_change_set::text, true);
  perform set_config('app.change_set_id', v_change_set::text, true);
  update public.task set priority = 'high' where id = v_task;
  e := tests.last_event(v_task);
  perform tests.ok(e.actor_kind = 'automation' and e.actor_id = v_change_set::text
      and e.change_set_id = v_change_set,
    'app.actor and app.change_set_id label the event');
  perform set_config('app.actor', '', true);
  perform set_config('app.change_set_id', '', true);

  perform tests.authenticate(v_owner);
  update public.task set title = 'Order more food' where id = v_task;
  reset role;
  e := tests.last_event(v_task);
  perform tests.ok(e.actor_kind = 'person' and e.actor_id = v_owner::text,
    'a signed-in person''s change is labelled with them');

  -- People.
  update public.user_profile set full_name = 'QA Staff Renamed' where id = v_staff;
  e := tests.last_event(v_staff);
  perform tests.ok(e.object_type = 'person' and e.verb = 'updated' and e.changes -> 0 ->> 'property' = 'title',
    'renaming a person writes an update on the person');
  update public.organization_membership set status = 'deactivated' where organization_id = v_org and user_id = v_guest;
  perform tests.ok((tests.last_event(v_guest)).verb = 'archived', 'deactivating a member archives the person');
  update public.organization_membership set status = 'active' where organization_id = v_org and user_id = v_guest;

  -- Custom values and relations.
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind)
  values (v_org, v_task_type, 'budget_code', 'Budget code', 'Code budgétaire', 'text') returning id into p_public;
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, visible_to_roles)
  values (v_org, v_task_type, 'cost', 'Cost', 'Coût', 'currency', '{owner,admin}') returning id into p_private;
  insert into public.property_value (object_id, property_id, value_text) values (v_task, p_public, 'B-1');
  e := tests.last_event(v_task);
  perform tests.ok(e.changes -> 0 ->> 'property' = 'budget_code'
      and e.changes -> 0 -> 'after' ->> 'value_text' = 'B-1',
    'setting a custom value writes its before and after');
  insert into public.property_value (object_id, property_id, value_number) values (v_task, p_private, 900);

  insert into public.object_relation (organization_id, from_id, to_id, relation_type_id)
  values (v_org, v_task, v_other_task, v_related);
  perform tests.ok(
    (tests.last_event(v_task)).verb = 'linked' and (tests.last_event(v_other_task)).verb = 'linked'
      and (tests.last_event(v_other_task)).changes -> 0 ->> 'direction' = 'incoming',
    'linking writes linked on both ends'
  );
  delete from public.object_relation where from_id = v_task and to_id = v_other_task;
  perform tests.ok((tests.last_event(v_task)).verb = 'unlinked', 'unlinking writes unlinked');

  -- Custom objects.
  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_org, 'grant_application', 'Grant application', 'Demande de subvention', 'custom') returning id into v_custom_type;
  insert into public.object (organization_id, type_id, title) values (v_org, v_custom_type, 'Heritage grant') returning id into v_custom;
  update public.object set title = 'Heritage grant 2027' where id = v_custom;
  perform tests.ok(
    (select array_agg(verb order by seq) from public.object_event where object_id = v_custom) = array['created', 'updated']
      and (tests.last_event(v_custom)).object_type = 'grant_application',
    'custom objects write created and updated'
  );
  select count(*) into v_before from public.object_event where object_id = v_task;
  perform tests.ok(
    (select count(*) from public.object_event where object_id = v_task and object_type <> 'task') = 0,
    'native objects are not double-recorded by the object table'
  );

  -- Deleted, and events outlive the record.
  delete from public.task where id = v_other_task;
  perform tests.ok((tests.last_event(v_other_task)).verb = 'deleted', 'deleting writes deleted');
  perform tests.ok(
    (select count(*) from public.object_event where object_id = v_other_task) >= 3,
    'the deleted task''s history remains'
  );

  -- Hardening.
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and (p.proname like 'object_event_from_%' or p.proname = 'record_object_event')),
    'event functions are security definer with an empty search_path'
  );

  -- Reading.
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      exists (select 1 from public.object_event where object_id = v_task and changes @> '[{"property":"cost"}]')
        and exists (select 1 from public.object_event where object_id = v_other_task and verb = 'deleted'),
      format('%s reads every event, private changes and deletions included', v_person)
    );
    reset role;
  end loop;

  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    exists (select 1 from public.object_event where object_id = v_task and changes @> '[{"property":"budget_code"}]')
      and not exists (select 1 from public.object_event where changes @> '[{"property":"cost"}]'),
    'the assignee reads their task''s events but not the private cost change'
  );
  perform tests.ok(
    not exists (select 1 from public.object_event where object_id = v_other_task),
    'the assignee reads nothing about a task they cannot see'
  );
  perform tests.ok(
    tests.events_raises(format(
      'insert into public.object_event (organization_id, object_id, object_type, actor_kind, verb) values (%L, %L, ''task'', ''person'', ''updated'')',
      v_org, v_task))
    and tests.events_raises(format('delete from public.object_event where object_id = %L', v_task))
    and tests.events_raises('select 1 from public.object_event_cursor'),
    'the assignee cannot write or delete events, or read the cursors'
  );
  reset role;

  foreach v_person in array array[v_staff, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      not exists (select 1 from public.object_event where changes @> '[{"property":"cost"}]'),
      format('%s never reads the private cost change', v_person)
    );
    select count(*) into v_count from public.object_event where object_id = v_task and verb = 'created';
    perform tests.ok(
      (v_count = 1) = public.can(v_task, 'view'),
      format('%s reads the task''s events exactly when they can view it', v_person)
    );
    perform tests.ok(
      tests.events_raises(format('update public.object_event set verb = ''deleted'' where object_id = %L', v_task)),
      format('%s cannot change an event', v_person)
    );
    reset role;
  end loop;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(
    not exists (select 1 from public.object_event where object_id = v_other_task),
    'without two-step sign-in the owner does not read deleted records'' events'
  );
  reset role;
end;
$$;

do $$
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.events_raises('select 1 from public.object_event limit 1'),
    'a signed-out visitor cannot read events'
  );
  reset role;
end;
$$;

rollback;
