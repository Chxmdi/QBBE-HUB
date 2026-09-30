-- Workspace OS V1-7: two-way relations, cardinality and stored rollups
-- (20261101011000_two_way_relations_and_rollups.sql). Rollups must stay
-- correct after every kind of change: a link added or removed, a related
-- custom value, a related native column, a task moved or deleted. Allow and
-- deny for owner, admin, staff, volunteer, guest, the external accountant and
-- signed-out. Run after qa-users.sql and rls.sql. Rolled back.
begin;

create or replace function tests.rollups_raises(p_sql text)
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
grant execute on function tests.rollups_raises(text) to anon, authenticated;

create or replace function tests.rollup(p_object uuid, p_key text)
returns numeric
language sql
set search_path = ''
as $$
  select v.value_number from public.property_value v
  join public.property_definition p on p.id = v.property_id
  where v.object_id = p_object and p.key = p_key;
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
  v_task_type uuid;
  v_project_type uuid;
  v_grant_type uuid;
  v_program uuid;
  v_project uuid;
  v_project_two uuid;
  v_task_a uuid;
  v_task_b uuid;
  v_grant uuid;
  v_relation_type uuid;
  p_hours uuid;
  v_person uuid;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'guest', status = 'active'
  where organization_id = v_org and user_id = v_accountant;
  select id into v_task_type from public.object_type where organization_id = v_org and key = 'task';
  select id into v_project_type from public.object_type where organization_id = v_org and key = 'project';

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Rollups', 'rollups-' || substr(gen_random_uuid()::text, 1, 8), v_owner) returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Rollups project', v_owner, v_owner) returning id into v_project;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Second project', v_owner, v_owner) returning id into v_project_two;
  insert into public.task (organization_id, project_id, title, created_by, estimate_hours)
  values (v_org, v_project, 'Task A', v_owner, 3) returning id into v_task_a;
  insert into public.task (organization_id, project_id, title, created_by, estimate_hours)
  values (v_org, v_project, 'Task B', v_owner, 5) returning id into v_task_b;

  -- Only owners and admins define relations and rollups.
  foreach v_person in array array[v_staff, v_volunteer, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      tests.rollups_raises(format(
        'select public.create_native_relation_property(%L, ''tasks'', ''Tasks'', ''Tâches'', ''contains'', ''outgoing'', ''task'')', v_project_type))
      and tests.rollups_raises(format(
        'select public.create_rollup_property(%L, ''total'', ''Total'', ''Total'', ''tasks'', ''estimate'', ''sum'')', v_project_type)),
      format('%s cannot add relation or rollup properties', v_person)
    );
    reset role;
  end loop;
  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(
    tests.rollups_raises(format(
      'select public.create_native_relation_property(%L, ''tasks'', ''Tasks'', ''Tâches'', ''contains'', ''outgoing'', ''task'')', v_project_type)),
    'the owner without two-step sign-in cannot add a relation property'
  );
  reset role;

  -- Rollups over a native link: a project's tasks.
  perform tests.authenticate(v_owner);
  perform public.create_native_relation_property(v_project_type, 'tasks', 'Tasks', 'Tâches', 'contains', 'outgoing', 'task');
  reset role;
  perform tests.authenticate(v_admin);
  perform public.create_rollup_property(v_project_type, 'task_count', 'Tasks', 'Tâches', 'tasks', null, 'count');
  perform public.create_rollup_property(v_project_type, 'total_hours', 'Total hours', 'Heures totales', 'tasks', 'estimate', 'sum');
  perform public.create_rollup_property(v_project_type, 'longest', 'Longest', 'Plus longue', 'tasks', 'estimate', 'max');
  perform tests.ok(
    tests.rollups_raises(format(
      'select public.create_rollup_property(%L, ''bad'', ''Bad'', ''Mauvais'', ''tasks'', ''title'', ''sum'')', v_project_type))
      and tests.rollups_raises(format(
        'select public.create_rollup_property(%L, ''bad2'', ''Bad'', ''Mauvais'', ''tasks'', ''estimate'', ''median'')', v_project_type)),
    'a rollup needs a number property and a known function'
  );
  reset role;

  perform tests.ok(
    tests.rollup(v_project, 'task_count') = 2 and tests.rollup(v_project, 'total_hours') = 8 and tests.rollup(v_project, 'longest') = 5,
    'creating a rollup calculates it at once (2 tasks, 8 hours, longest 5)'
  );
  perform tests.ok(tests.rollup(v_project_two, 'task_count') = 0 and tests.rollup(v_project_two, 'total_hours') = 0
      and tests.rollup(v_project_two, 'longest') is null,
    'with no tasks: count 0, sum 0, max empty');

  update public.task set estimate_hours = 10 where id = v_task_a;
  perform tests.ok(tests.rollup(v_project, 'total_hours') = 15 and tests.rollup(v_project, 'longest') = 10,
    'changing a task''s estimate refreshes its project''s rollups');

  update public.task set project_id = v_project_two where id = v_task_b;
  perform tests.ok(
    tests.rollup(v_project, 'total_hours') = 10 and tests.rollup(v_project, 'task_count') = 1
      and tests.rollup(v_project_two, 'total_hours') = 5 and tests.rollup(v_project_two, 'task_count') = 1,
    'moving a task to another project refreshes both projects'
  );

  delete from public.task where id = v_task_a;
  perform tests.ok(tests.rollup(v_project, 'task_count') = 0 and tests.rollup(v_project, 'total_hours') = 0,
    'deleting a task refreshes its project');

  insert into public.task (organization_id, project_id, title, created_by, estimate_hours)
  values (v_org, v_project, 'Task C', v_owner, 2) returning id into v_task_a;
  perform tests.ok(tests.rollup(v_project, 'task_count') = 1 and tests.rollup(v_project, 'total_hours') = 2,
    'adding a task refreshes its project');

  -- Two-way relation between a custom type and tasks, with a custom number.
  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_org, 'grant_app', 'Grant application', 'Demande de subvention', 'custom') returning id into v_grant_type;
  perform tests.authenticate(v_owner);
  v_relation_type := public.create_two_way_relation(v_grant_type, v_task_type, 'tasks', 'Tasks', 'Tâches',
    'grant', 'Grant', 'Subvention', 'one_to_many');
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind)
  values (v_org, v_task_type, 'hours_spent', 'Hours spent', 'Heures passées', 'number') returning id into p_hours;
  perform public.create_rollup_property(v_grant_type, 'spent', 'Spent', 'Passé', 'tasks', 'hours_spent', 'sum');
  reset role;

  perform tests.ok(
    (select count(*) from public.property_definition where kind = 'relation'
      and ((type_id = v_grant_type and key = 'tasks' and options ->> 'direction' = 'outgoing' and options ->> 'pairedKey' = 'grant')
        or (type_id = v_task_type and key = 'grant' and options ->> 'direction' = 'incoming' and options ->> 'pairedKey' = 'tasks'))) = 2,
    'a two-way relation adds a property on each side, pointing at each other'
  );

  insert into public.object (organization_id, type_id, title) values (v_org, v_grant_type, 'Heritage grant') returning id into v_grant;
  insert into public.property_value (object_id, property_id, value_number) values (v_task_a, p_hours, 4), (v_task_b, p_hours, 6);
  insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (v_org, v_grant, v_task_a, v_relation_type);
  perform tests.ok(tests.rollup(v_grant, 'spent') = 4, 'linking a task adds its hours');
  insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (v_org, v_grant, v_task_b, v_relation_type);
  perform tests.ok(tests.rollup(v_grant, 'spent') = 10, 'linking a second task adds its hours');
  update public.property_value set value_number = 7 where object_id = v_task_b and property_id = p_hours;
  perform tests.ok(tests.rollup(v_grant, 'spent') = 11, 'changing a linked task''s custom value refreshes the rollup');
  delete from public.object_relation where from_id = v_grant and to_id = v_task_a;
  perform tests.ok(tests.rollup(v_grant, 'spent') = 7, 'unlinking removes its hours');

  -- Cardinality: one grant per task (one-to-many), and no tightening past existing links.
  insert into public.object (organization_id, type_id, title) values (v_org, v_grant_type, 'Other grant') returning id into v_project_two;
  perform tests.ok(
    tests.rollups_raises(format(
      'insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (%L, %L, %L, %L)',
      v_org, v_project_two, v_task_b, v_relation_type)),
    'one-to-many: a task already in one grant cannot join a second'
  );
  insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (v_org, v_grant, v_task_a, v_relation_type);
  perform tests.ok(
    tests.rollups_raises(format('update public.relation_type set cardinality = ''one_to_one'' where id = %L', v_relation_type)),
    'a relation cannot become one-to-one while a grant has two tasks'
  );
  perform tests.ok(
    not tests.rollups_raises(format('update public.relation_type set cardinality = ''many_to_many'' where id = %L', v_relation_type)),
    'loosening to many-to-many is always allowed'
  );

  -- Nobody writes a rollup value by hand; everyone who can view the object reads it.
  perform tests.authenticate(v_owner);
  update public.property_value v set value_number = 999
  from public.property_definition p
  where p.id = v.property_id and v.object_id = v_project and p.key = 'total_hours';
  reset role;
  perform tests.ok(tests.rollup(v_project, 'total_hours') = 2, 'even the owner cannot overwrite a rollup');

  foreach v_person in array array[v_owner, v_admin, v_staff, v_volunteer, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      exists (select 1 from public.property_value v join public.property_definition p on p.id = v.property_id
              where v.object_id = v_project and p.key = 'total_hours') = public.can(v_project, 'view'),
      format('%s reads the project''s rollup exactly when they can view the project', v_person)
    );
    reset role;
  end loop;

  -- Private properties cannot be summarised.
  update public.property_definition set visible_to_roles = '{owner}' where id = p_hours;
  perform tests.authenticate(v_owner);
  perform tests.ok(
    tests.rollups_raises(format(
      'select public.create_rollup_property(%L, ''spent2'', ''S'', ''S'', ''tasks'', ''hours_spent'', ''sum'')', v_grant_type)),
    'a rollup over a private property is refused'
  );
  reset role;
end;
$$;

do $$
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.rollups_raises('select public.create_rollup_property(gen_random_uuid(), ''x'', ''X'', ''X'', ''y'', null, ''count'')')
      and tests.rollups_raises('select public.create_two_way_relation(gen_random_uuid(), gen_random_uuid(), ''a'', ''A'', ''A'', ''b'', ''B'', ''B'')'),
    'a signed-out visitor cannot define relations or rollups'
  );
  reset role;
end;
$$;

rollback;
