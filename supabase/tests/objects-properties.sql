-- Workspace OS M2a + M2b: property definitions, system properties, typed
-- custom values and property-level privacy
-- (20261101010400_object_properties.sql). Allow and deny for owner, admin,
-- staff, volunteer, guest, the external accountant and signed-out. Run after
-- qa-users.sql and rls.sql. All mutations are rolled back.
begin;

create or replace function tests.properties_raises(p_sql text)
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
grant execute on function tests.properties_raises(text) to anon, authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_other_org uuid;
  v_task_type uuid;
  v_project_type uuid;
  v_program uuid;
  v_project uuid;
  v_task uuid;
  v_reviewed_task uuid;
  p_public uuid;
  p_private uuid;
  p_range uuid;
  p_tags uuid;
  p_rollup uuid;
  p_project_prop uuid;
  p_system_due uuid;
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
  select id into v_project_type from public.object_type where organization_id = v_org and key = 'project';

  -- M2a: system properties.
  perform tests.ok(
    (select array_agg(key order by key) from public.property_definition where type_id = v_task_type)
      = array['assignee', 'completed_time', 'created_by', 'created_time', 'due', 'edited_time',
              'estimate', 'priority', 'program', 'project', 'requester', 'reviewer', 'start',
              'status', 'title'],
    'the task''s native columns are its system properties, matching taskSystemProperties in stubs.ts'
  );
  perform tests.ok(
    (select bool_and(system_column is not null and name_en <> '' and name_fr <> '')
     from public.property_definition where organization_id = v_org),
    'every seeded property is a named system property in both languages'
  );
  perform tests.ok(
    (select system_column from public.property_definition where type_id = v_task_type and key = 'due') = 'due_at'
      and (select jsonb_array_length(options -> 'choices') from public.property_definition
           where type_id = v_task_type and key = 'status') = 8,
    'due reads task.due_at, and status lists its eight choices'
  );
  insert into public.organization (name, slug) values ('Props other', 'props-other-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_other_org;
  perform tests.ok(
    (select count(*) from public.property_definition where organization_id = v_other_org) > 0,
    'a new organization gets its system properties'
  );
  select id into p_system_due from public.property_definition where type_id = v_task_type and key = 'due';

  perform tests.ok(
    tests.properties_raises(format(
      'update public.property_definition set visible_to_roles = ''{owner}'' where id = %L', p_system_due)),
    'a system property cannot be made private'
  );
  perform tests.ok(
    tests.properties_raises(format(
      'update public.property_definition set kind = ''number'' where id = %L', p_system_due)),
    'a property''s kind cannot change'
  );
  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_other_org, 'grant_application', 'Grant application', 'Demande de subvention', 'custom');
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, system_column)
       select %L, id, ''sys'', ''X'', ''X'', ''text'', ''title'' from public.object_type
       where organization_id = %L and key = ''grant_application''', v_other_org, v_other_org)),
    'a custom type cannot have a system property'
  );

  -- Fixtures.
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Props', 'props-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Props project', v_owner, v_owner)
  returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Assigned to the volunteer', v_owner, v_volunteer)
  returning id into v_task;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Reviewed by the volunteer', v_owner)
  returning id into v_reviewed_task;
  insert into public.task_assignment (task_id, user_id, role) values (v_reviewed_task, v_volunteer, 'reviewer');

  -- Custom properties: owners and admins with two-step sign-in.
  perform tests.authenticate(v_owner);
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind)
  values (v_org, v_task_type, 'budget_code', 'Budget code', 'Code budgétaire', 'text')
  returning id into p_public;
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, visible_to_roles)
  values (v_org, v_task_type, 'cost', 'Cost', 'Coût', 'currency', '{owner,admin}')
  returning id into p_private;
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind) values (%L, %L, ''roll'', ''R'', ''R'', ''rollup'')',
      v_org, v_task_type)),
    'the owner cannot add a computed (rollup) property by hand'
  );
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, system_column) values (%L, %L, ''sneaky'', ''S'', ''S'', ''text'', ''title'')',
      v_org, v_task_type)),
    'the owner cannot add a system property'
  );
  perform tests.ok(
    tests.properties_raises(format(
      'update public.property_definition set name_en = ''Renamed'' where id = %L returning 1', p_system_due))
    or (select name_en from public.property_definition where id = p_system_due) = 'Due',
    'the owner cannot rename a system property'
  );
  reset role;
  perform tests.ok(
    (select name_en from public.property_definition where id = p_system_due) = 'Due',
    'system property names are unchanged'
  );

  perform tests.authenticate(v_admin);
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind)
  values (v_org, v_task_type, 'window', 'Window', 'Période', 'date_range')
  returning id into p_range;
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind) values (%L, %L, ''aal1'', ''X'', ''X'', ''text'')',
      v_org, v_task_type)),
    'the owner without two-step sign-in cannot add a property'
  );
  reset role;

  foreach v_person in array array[v_staff, v_volunteer, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      tests.properties_raises(format(
        'insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind) values (%L, %L, %L, ''X'', ''X'', ''text'')',
        v_org, v_task_type, 'denied_' || substr(md5(v_person::text), 1, 6))),
      format('%s cannot add a property', v_person)
    );
    select count(*) into v_count from public.property_definition where type_id = v_task_type;
    perform tests.ok(v_count >= 17, format('%s reads the task''s property definitions', v_person));
    reset role;
  end loop;

  -- System-made properties (as the migration or V1-7 would add them).
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind)
  values (v_org, v_task_type, 'tags', 'Tags', 'Étiquettes', 'multi_select')
  returning id into p_tags;
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind)
  values (v_org, v_task_type, 'subtotal', 'Subtotal', 'Sous-total', 'rollup')
  returning id into p_rollup;
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind)
  values (v_org, v_project_type, 'region', 'Region', 'Région', 'text')
  returning id into p_project_prop;

  -- M2b: typed values.
  insert into public.property_value (object_id, property_id, value_text) values (v_task, p_public, 'B-12');
  insert into public.property_value (object_id, property_id, value_number) values (v_task, p_private, 4200);
  insert into public.property_value (object_id, property_id, value_json) values (v_task, p_tags, '["food","youth"]');
  insert into public.property_value (object_id, property_id, value_number) values (v_task, p_rollup, 3);
  insert into public.property_value (object_id, property_id, value_text) values (v_reviewed_task, p_public, 'R-1');

  perform tests.ok(
    (select organization_id from public.property_value where object_id = v_task and property_id = p_public) = v_org,
    'a value takes its object''s organization'
  );
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_value (object_id, property_id, value_number) values (%L, %L, 1)', v_reviewed_task, p_public)),
    'a text property cannot hold a number'
  );
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_value (object_id, property_id, value_text) values (%L, %L, ''x'')', v_project, p_public)),
    'a task property cannot be set on a project'
  );
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_value (object_id, property_id, value_date) values (%L, %L, current_date)', v_task, p_system_due)),
    'a system property''s value is not stored in property_value'
  );
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_value (object_id, property_id, value_date, value_date_end) values (%L, %L, ''2026-10-10'', ''2026-10-01'')', v_task, p_range)),
    'a date range cannot end before it starts'
  );
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_value (object_id, property_id, value_json) values (%L, %L, ''"food"'')', v_reviewed_task, p_tags)),
    'a multi-select value must be a list'
  );
  perform tests.ok(
    (select count(*) from pg_indexes where tablename = 'property_value'
      and indexname in ('idx_property_value_text', 'idx_property_value_number', 'idx_property_value_date',
                        'idx_property_value_uuids', 'idx_property_value_json', 'idx_property_value_bool')) = 6,
    'every value kind has its index'
  );

  -- Reading: can(view) on the object, and the property's roles.
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    select count(*) into v_count from public.property_value where object_id = v_task;
    perform tests.ok(v_count = 4, format('%s reads every value, the private cost included', v_person));
    reset role;
  end loop;

  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    exists (select 1 from public.property_value where object_id = v_task and property_id = p_public)
      and not exists (select 1 from public.property_value where property_id = p_private),
    'the assigned volunteer reads the budget code but not the private cost'
  );
  reset role;

  foreach v_person in array array[v_staff, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      not exists (select 1 from public.property_value where property_id = p_private),
      format('%s never reads the private cost', v_person)
    );
    select count(*) into v_count from public.property_value where object_id = v_task and property_id = p_public;
    perform tests.ok(
      (v_count = 1) = public.can(v_task, 'view'),
      format('%s reads a public value exactly when they can view the task', v_person)
    );
    reset role;
  end loop;

  -- Writing: can(edit_content) on the object, a writable kind, and the roles.
  perform tests.authenticate(v_volunteer);
  update public.property_value set value_text = 'B-13' where object_id = v_task and property_id = p_public;
  perform tests.ok(
    (select value_text from public.property_value where object_id = v_task and property_id = p_public) = 'B-13',
    'the assignee edits a custom value on their task'
  );
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_value (object_id, property_id, value_number) values (%L, %L, 1)', v_task, p_private)),
    'the assignee cannot write the private cost'
  );
  update public.property_value set value_text = 'hacked' where object_id = v_reviewed_task and property_id = p_public;
  perform tests.ok(
    tests.properties_raises(format(
      'insert into public.property_value (object_id, property_id, value_json) values (%L, %L, ''["x"]'')', v_reviewed_task, p_tags)),
    'a reviewer (comment only) cannot add a value'
  );
  reset role;
  perform tests.ok(
    (select value_text from public.property_value where object_id = v_reviewed_task and property_id = p_public) = 'R-1',
    'a reviewer''s update changed nothing'
  );

  perform tests.authenticate(v_owner);
  update public.property_value set value_number = 99 where object_id = v_task and property_id = p_rollup;
  reset role;
  perform tests.ok(
    (select value_number from public.property_value where object_id = v_task and property_id = p_rollup) = 3,
    'nobody overwrites a computed rollup by hand, not even the owner'
  );

  perform tests.authenticate(v_owner);
  update public.property_value set value_number = 5000 where object_id = v_task and property_id = p_private;
  delete from public.property_value where object_id = v_reviewed_task and property_id = p_public;
  reset role;
  perform tests.ok(
    (select value_number from public.property_value where object_id = v_task and property_id = p_private) = 5000
      and not exists (select 1 from public.property_value where object_id = v_reviewed_task and property_id = p_public),
    'the owner edits the private cost and deletes a value'
  );

  foreach v_person in array array[v_staff, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    if not public.can(v_task, 'edit_content') then
      update public.property_value set value_text = 'x' where object_id = v_task and property_id = p_public;
      delete from public.property_value where object_id = v_task;
    end if;
    reset role;
  end loop;
  perform tests.ok(
    (select value_text from public.property_value where object_id = v_task and property_id = p_public) = 'B-13'
      and (select count(*) from public.property_value where object_id = v_task) = 4,
    'people who cannot edit the task change and delete nothing'
  );

  -- Values follow their object.
  delete from public.task where id = v_task;
  perform tests.ok(not exists (select 1 from public.property_value where object_id = v_task),
    'deleting a task deletes its values');

  -- Deactivated.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_admin;
  perform tests.authenticate(v_admin);
  perform tests.ok(
    not exists (select 1 from public.property_definition where organization_id = v_org),
    'a deactivated admin reads no property definitions'
  );
  reset role;
end;
$$;

do $$
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.properties_raises('select 1 from public.property_value limit 1')
      and tests.properties_raises('select 1 from public.property_definition limit 1'),
    'a signed-out visitor cannot read properties or values'
  );
  reset role;
end;
$$;

rollback;
