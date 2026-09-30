-- Workspace OS feature switches (W0-4): one per module, off by default,
-- readable by members, changeable only outside a signed-in session. Run after
-- qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_keys constant text[] := array[
    'wos_objects', 'wos_spaces', 'wos_pages', 'wos_editor', 'wos_lenses',
    'wos_home', 'wos_capture', 'wos_workflows_v2', 'wos_forms_v2',
    'wos_public_pages', 'wos_offline'
  ];
  n integer;
begin
  select count(*) into n from public.feature_flag
  where key = any (v_keys) and not enabled and organization_id is null;
  perform tests.ok(n = cardinality(v_keys), 'every Workspace OS module has a switch, off, for the whole workspace');

  select count(*) into n from public.feature_flag
  where key like 'wos\_%' and key <> all (v_keys);
  perform tests.ok(n = 0, 'no Workspace OS switch exists outside the agreed list');

  perform tests.authenticate(v_staff);
  select count(*) into n from public.feature_flag where key = any (v_keys);
  perform tests.ok(n = cardinality(v_keys), 'a member can read the switches');

  -- Regression: the workspace-wide rows were writable by any member
  -- (20261101000300_feature_flag_workspace_rows_locked).
  update public.feature_flag set enabled = true where key = 'wos_objects';
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a member cannot turn a switch on');
  update public.feature_flag set enabled = false where key = 'notification_email';
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a member cannot turn an existing integration switch off');
  delete from public.feature_flag where key = 'wos_objects';
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a member cannot delete a switch');
  begin
    insert into public.feature_flag (key, enabled) values ('wos_member_made', true);
    raise exception 'FAIL: a member added a workspace-wide switch';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a member cannot add a workspace-wide switch');
  end;
  reset role;

  -- Workspace-wide switches change only in the SQL editor or with the service
  -- role, never through a signed-in session, even the owner's.
  perform tests.authenticate(v_owner);
  update public.feature_flag set enabled = true where key = 'wos_objects';
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'even the owner cannot change a workspace-wide switch through the API');
  reset role;

  update public.feature_flag set enabled = true where key = 'wos_objects';
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'the database owner (SQL editor) can turn a switch on');

  perform tests.clear_auth();
  select count(*) into n from public.feature_flag where key = any (v_keys);
  perform tests.ok(n = 0, 'a signed-out visitor cannot read the switches');
  reset role;
end;
$$;

rollback;
