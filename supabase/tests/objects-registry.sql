-- Workspace OS M1a: object_type and object (20261101010100_object_registry.sql).
-- Allow and deny for every role: owner, admin, staff, volunteer, guest (the
-- "member" role with the fewest rights), the external accountant (a guest with
-- a ledger grant) and a signed-out visitor. Run after qa-users.sql and rls.sql.
-- All mutations are rolled back.
begin;

-- True when the statement raises, as the calling role. Not security definer.
create or replace function tests.objects_raises(p_sql text)
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
grant execute on function tests.objects_raises(text) to anon, authenticated;

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
  v_program uuid;
  v_project uuid;
  v_task_assigned uuid;
  v_task_unrelated uuid;
  v_task_type uuid;
  v_project_type uuid;
  v_other_object uuid;
  v_person uuid;
  v_count integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  -- The accountant fixture: a guest holding the external accountant grant.
  update public.organization_membership set role = 'guest', status = 'active'
  where organization_id = v_org and user_id = v_accountant;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner)
  on conflict do nothing;

  -- Seeding.
  perform tests.ok(
    (select count(*) from public.object_type where organization_id = v_org and kind = 'native') = 11,
    'every organization has the eleven native types'
  );
  insert into public.organization (name, slug) values ('Objects other', 'objects-other-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_other_org;
  perform tests.ok(
    (select count(*) from public.object_type where organization_id = v_other_org and kind = 'native') = 11,
    'a new organization gets the native types when it is created'
  );
  perform tests.ok(
    (select bool_and(native_table is not null and name_en <> '' and name_fr <> '')
     from public.object_type where kind = 'native'),
    'native types name their table in English and French'
  );

  -- Fixture records. Objects are written by hand here; M1b adds the triggers.
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Objects', 'objects-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Objects project', v_owner, v_owner)
  returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Assigned to the volunteer', v_owner, v_volunteer)
  returning id into v_task_assigned;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Unrelated to the volunteer', v_owner)
  returning id into v_task_unrelated;

  select id into v_task_type from public.object_type where organization_id = v_org and key = 'task';
  select id into v_project_type from public.object_type where organization_id = v_org and key = 'project';

  -- Only if M1b has not already created them.
  insert into public.object (id, organization_id, type_id, title)
  values (v_project, v_org, v_project_type, 'Objects project')
  on conflict (id) do nothing;
  insert into public.object (id, organization_id, type_id, parent_object_id, title)
  values (v_task_assigned, v_org, v_task_type, v_project, 'Assigned to the volunteer'),
         (v_task_unrelated, v_org, v_task_type, v_project, 'Unrelated to the volunteer')
  on conflict (id) do nothing;

  -- Integrity.
  perform tests.ok(
    tests.objects_raises(format(
      'update public.object set parent_object_id = %L where id = %L', v_task_assigned, v_project)),
    'a parent cannot be nested inside its own child'
  );
  insert into public.object (organization_id, type_id, title)
  select v_other_org, id, 'Other organization task' from public.object_type
  where organization_id = v_other_org and key = 'task'
  returning id into v_other_object;
  perform tests.ok(
    tests.objects_raises(format(
      'update public.object set parent_object_id = %L where id = %L', v_project, v_other_object)),
    'a parent must be in the same organization'
  );
  perform tests.ok(
    tests.objects_raises(format(
      'insert into public.object (organization_id, type_id) values (%L, %L)', v_other_org, v_task_type)),
    'an object cannot use another organization''s type'
  );
  perform tests.ok(
    (select search_vector @@ to_tsquery('french', 'volontaire') or search_vector @@ to_tsquery('english', 'volunteer')
     from public.object where id = v_task_assigned),
    'titles are searchable'
  );

  -- Hardening.
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname in (
       'guard_object_parent', 'seed_native_object_types', 'upsert_native_object',
       'sync_object_from_native', 'seed_native_object_types_for_new_organization')),
    'object registry functions are security definer with an empty search_path'
  );
  perform tests.ok(
    not has_function_privilege('authenticated', 'app.upsert_native_object(text, jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'app.seed_native_object_types(uuid)', 'execute')
      and not has_table_privilege('authenticated', 'app.native_object_map', 'select'),
    'signed-in people cannot call the sync machinery or read its map'
  );
  perform tests.ok(
    (select bool_and(relrowsecurity) from pg_class
     where oid in ('public.object'::regclass, 'public.object_type'::regclass)),
    'RLS is on for object and object_type'
  );

  -- Reading types: every active member of the organization, and nobody else.
  foreach v_person in array array[v_owner, v_admin, v_staff, v_volunteer, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    select count(*) into v_count from public.object_type where organization_id = v_org;
    perform tests.ok(v_count = 11, format('%s reads the organization''s object types', v_person));
    select count(*) into v_count from public.object_type where organization_id = v_other_org;
    perform tests.ok(v_count = 0, format('%s does not read another organization''s types', v_person));
    reset role;
  end loop;

  -- Writing custom types: owners and admins with two-step sign-in only.
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      not tests.objects_raises(format(
        'insert into public.object_type (organization_id, key, name_en, name_fr, kind) values (%L, %L, ''Grant'', ''Subvention'', ''custom'')',
        v_org, 'grant_' || substr(md5(v_person::text), 1, 6))),
      format('%s creates a custom type', v_person)
    );
    perform tests.ok(
      tests.objects_raises(format(
        'insert into public.object_type (organization_id, key, name_en, name_fr, kind, native_table) values (%L, ''fake_native'', ''X'', ''X'', ''native'', ''task'')',
        v_org)),
      format('%s cannot create a native type', v_person)
    );
    update public.object_type set name_en = 'Renamed' where organization_id = v_org and key = 'task';
    reset role;
  end loop;
  perform tests.ok(
    (select name_en from public.object_type where organization_id = v_org and key = 'task') = 'Task',
    'nobody renames a native type through the API'
  );

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(
    tests.objects_raises(format(
      'insert into public.object_type (organization_id, key, name_en, name_fr, kind) values (%L, ''owner_aal1'', ''X'', ''X'', ''custom'')', v_org)),
    'the owner without two-step sign-in cannot create a type'
  );
  reset role;

  foreach v_person in array array[v_staff, v_volunteer, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      tests.objects_raises(format(
        'insert into public.object_type (organization_id, key, name_en, name_fr, kind) values (%L, %L, ''X'', ''X'', ''custom'')',
        v_org, 'denied_' || substr(md5(v_person::text), 1, 6))),
      format('%s cannot create a custom type', v_person)
    );
    reset role;
  end loop;

  -- Reading objects follows public.can(id, 'view').
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    select count(*) into v_count from public.object
    where id in (v_project, v_task_assigned, v_task_unrelated);
    perform tests.ok(v_count = 3, format('%s reads the project and task objects', v_person));
    select count(*) into v_count from public.object where id = v_other_object;
    perform tests.ok(v_count = 0, format('%s does not read another organization''s objects', v_person));
    reset role;
  end loop;

  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    exists (select 1 from public.object where id = v_task_assigned)
      and not exists (select 1 from public.object where id = v_task_unrelated),
    'the volunteer reads the object of the task assigned to them, not the unrelated one'
  );
  reset role;

  foreach v_person in array array[v_staff, v_volunteer, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    select count(*) into v_count from public.object where id = v_task_unrelated;
    perform tests.ok(
      (v_count = 1) = public.can(v_task_unrelated, 'view'),
      format('%s sees the unrelated task''s object exactly when public.can allows it', v_person)
    );
    reset role;
  end loop;

  perform tests.authenticate(v_guest);
  perform tests.ok(
    not exists (select 1 from public.object where id in (v_project, v_task_unrelated)),
    'a guest with no grant reads no objects'
  );
  reset role;

  -- Nobody writes objects through the API, whatever their role.
  foreach v_person in array array[v_owner, v_admin, v_staff, v_volunteer, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      tests.objects_raises(format(
        'insert into public.object (organization_id, type_id, title) values (%L, %L, ''x'')', v_org, v_task_type))
      and tests.objects_raises(format(
        'update public.object set title = ''x'' where id = %L', v_task_assigned))
      and tests.objects_raises(format(
        'delete from public.object where id = %L', v_task_assigned)),
      format('%s cannot insert, update or delete objects directly', v_person)
    );
    reset role;
  end loop;

  -- A deactivated member loses both.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_volunteer;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    not exists (select 1 from public.object where id = v_task_assigned)
      and not exists (select 1 from public.object_type where organization_id = v_org),
    'a deactivated member reads no objects and no types'
  );
  reset role;
end;
$$;

-- Signed out: no access at all.
do $$
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.objects_raises('select 1 from public.object limit 1')
      and tests.objects_raises('select 1 from public.object_type limit 1'),
    'a signed-out visitor cannot read objects or types'
  );
  reset role;
end;
$$;

rollback;
