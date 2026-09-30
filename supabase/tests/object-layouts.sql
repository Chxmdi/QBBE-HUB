-- Workspace OS V2-4: custom object layouts (20261103110500_object_layouts.sql).
-- Run after qa-users.sql and rls.sql; everything is rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_other_org uuid;
  v_task_type uuid;
  v_project_type uuid;
  v_other_type uuid;
  v_layout jsonb := '{"version": 1, "sections": [{"id": "props", "kind": "properties", "properties": ["status", "due"]}]}';
  v_person uuid;
  v_count integer;
  v_failed boolean;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  select id into strict v_task_type from public.object_type where organization_id = v_org and key = 'task';
  select id into strict v_project_type from public.object_type where organization_id = v_org and key = 'project';
  -- Start from the standard layouts (rolled back with everything else).
  delete from public.object_layout where organization_id = v_org;
  insert into public.organization (name, slug)
  values ('Elsewhere', 'wos-layout-' || substr(gen_random_uuid()::text, 1, 8)) returning id into v_other_org;
  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_other_org, 'grant', 'Grant', 'Subvention', 'custom') returning id into v_other_type;
  insert into public.object_layout (organization_id, type_id, layout) values (v_other_org, v_other_type, v_layout);
  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_other_org, 'grant_two', 'Grant two', 'Subvention deux', 'custom') returning id into v_other_type;

  perform tests.ok(
    (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'stamp_object_layout'),
    'the stamp trigger is security definer with an empty search_path'
  );
  perform tests.ok(not has_table_privilege('anon', 'public.object_layout', 'select'),
    'signed-out visitors cannot read layouts');

  -- Owners and admins (two-step) write.
  perform tests.authenticate(v_owner, 'aal2');
  insert into public.object_layout (organization_id, type_id, layout) values (v_org, v_task_type, v_layout);
  perform tests.ok(
    (select updated_by = v_owner from public.object_layout where type_id = v_task_type),
    'owner (two-step) saves a layout, stamped with who saved it'
  );
  v_failed := false;
  begin
    insert into public.object_layout (organization_id, type_id, layout) values (v_org, v_task_type, v_layout);
  exception when unique_violation then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a type has one layout');
  v_failed := false;
  begin
    insert into public.object_layout (organization_id, type_id, layout)
    values (v_org, v_project_type, '{"version": 2, "sections": []}');
  exception when check_violation then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a malformed layout is refused');
  v_failed := false;
  begin
    insert into public.object_layout (organization_id, type_id, layout)
    values (v_org, v_other_type, v_layout);
  exception when foreign_key_violation or insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a layout cannot use another organization''s type');
  v_failed := false;
  begin
    update public.object_layout set type_id = v_project_type where type_id = v_task_type;
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a layout stays with its type');
  select count(*) into v_count from public.object_layout;
  perform tests.ok(v_count = 1, 'owner sees only their organization''s layouts');
  reset role;

  perform tests.authenticate(v_admin, 'aal2');
  update public.object_layout set layout = jsonb_set(v_layout, '{sections,0,properties}', '["title"]')
  where type_id = v_task_type;
  get diagnostics v_count = row_count;
  perform tests.ok(v_count = 1, 'admin (two-step) edits a layout');
  perform tests.ok(
    (select updated_by = v_admin from public.object_layout where type_id = v_task_type),
    'the edit is stamped with the admin'
  );
  reset role;

  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person, 'aal1');
    update public.object_layout set layout = v_layout where type_id = v_task_type;
    get diagnostics v_count = row_count;
    perform tests.ok(v_count = 0, format('%s without the second step cannot edit a layout', v_person));
    select count(*) into v_count from public.object_layout where type_id = v_task_type;
    perform tests.ok(v_count = 1, format('%s without the second step still reads it', v_person));
    reset role;
  end loop;

  -- Everyone else in the organization reads; nobody else writes.
  foreach v_person in array array[v_staff, v_volunteer, v_guest] loop
    perform tests.authenticate(v_person, 'aal2');
    select count(*) into v_count from public.object_layout;
    perform tests.ok(v_count = 1, format('%s reads their organization''s layout only', v_person));
    v_failed := false;
    begin
      insert into public.object_layout (organization_id, type_id, layout) values (v_org, v_project_type, v_layout);
    exception when insufficient_privilege then v_failed := true;
    end;
    perform tests.ok(v_failed, format('%s cannot create a layout', v_person));
    update public.object_layout set layout = v_layout where type_id = v_task_type;
    get diagnostics v_count = row_count;
    perform tests.ok(v_count = 0, format('%s cannot edit a layout', v_person));
    delete from public.object_layout where type_id = v_task_type;
    get diagnostics v_count = row_count;
    perform tests.ok(v_count = 0, format('%s cannot delete a layout', v_person));
    reset role;
  end loop;

  -- The external accountant is a guest with a ledger grant: no more than a guest.
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);
  perform tests.authenticate(v_guest, 'aal2');
  delete from public.object_layout where type_id = v_task_type;
  get diagnostics v_count = row_count;
  perform tests.ok(v_count = 0, 'accountant cannot delete a layout');
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  delete from public.object_layout where type_id = v_task_type;
  get diagnostics v_count = row_count;
  perform tests.ok(v_count = 1, 'owner (two-step) removes a layout, going back to the default');
  reset role;
end;
$$;

rollback;
