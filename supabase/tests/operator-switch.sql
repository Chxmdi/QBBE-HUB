-- Deleting production files needs the owner's explicit OK: the cleanup of
-- unregistered uploads only reports until an operator switch is on, and the
-- switch is set only by an owner signed in with a second factor, the service
-- role, or the database's own administrators (the dashboard's SQL editor);
-- who and how are recorded (SEC-016). Run after qa-users.sql and rls.sql.
-- Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_row public.operator_switch;
  v_summary record;
  v_who uuid;
  n integer;
begin
  select * into v_row from public.operator_switch where name = 'purge-unregistered-uploads';
  perform tests.ok(found and not v_row.enabled,
    'operator switch: the upload cleanup switch exists and starts off');

  -- Nobody signed in reads or writes the table directly.
  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(tests.permission_denied('select * from public.operator_switch'),
    'operator switch: the table is not readable through the API');
  perform tests.ok(tests.permission_denied('update public.operator_switch set enabled = true'),
    'operator switch: the table is not writable through the API');
  perform tests.clear_auth();
  reset role;

  -- Only an owner with a second factor sets it.
  foreach v_who in array array[v_admin, v_staff] loop
    perform tests.authenticate(v_who, 'aal2');
    begin
      perform public.set_operator_switch('purge-unregistered-uploads', true);
      perform tests.ok(false, 'operator switch: an admin or staff member cannot turn it on');
    exception when insufficient_privilege then
      perform tests.ok(true, 'operator switch: an admin or staff member cannot turn it on');
    end;
    perform tests.clear_auth();
    reset role;
  end loop;
  perform tests.authenticate(v_owner, 'aal1');
  begin
    perform public.set_operator_switch('purge-unregistered-uploads', true);
    perform tests.ok(false, 'operator switch: an owner without a second factor cannot turn it on');
  exception when insufficient_privilege then
    perform tests.ok(true, 'operator switch: an owner without a second factor cannot turn it on');
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(not (select enabled from public.operator_switch where name = 'purge-unregistered-uploads'),
    'operator switch: still off after refused attempts');

  perform tests.authenticate(v_owner, 'aal2');
  perform public.set_operator_switch('purge-unregistered-uploads', true);
  begin
    perform public.set_operator_switch('no-such-switch', true);
    perform tests.ok(false, 'operator switch: an unknown switch is refused');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'operator switch: an unknown switch is refused');
  end;
  perform tests.clear_auth();
  reset role;
  select * into v_row from public.operator_switch where name = 'purge-unregistered-uploads';
  perform tests.ok(v_row.enabled and v_row.changed_by = v_owner and v_row.changed_via = 'owner' and v_row.changed_at is not null,
    'operator switch: an owner with a second factor turns it on, and is recorded');
  select count(*) into n from public.audit_event
  where action = 'operator_switch_changed' and actor_id = v_owner
    and metadata ->> 'switch' = 'purge-unregistered-uploads' and (metadata ->> 'enabled')::boolean;
  perform tests.ok(n = 1, 'operator switch: the change is audited');

  -- From the database itself (the dashboard's SQL editor): recorded as such.
  perform public.set_operator_switch('purge-unregistered-uploads', false);
  select * into v_row from public.operator_switch where name = 'purge-unregistered-uploads';
  perform tests.ok(not v_row.enabled and v_row.changed_via = 'database' and v_row.changed_by is null,
    'operator switch: a database session can turn it off, recorded as the database');
  perform tests.ok(exists (
      select 1 from public.audit_event
      where action = 'operator_switch_changed' and metadata ->> 'via' = 'database'
        and metadata ->> 'login' = session_user::text and metadata ? 'client' and metadata ? 'application'),
    'operator switch: a database change records the login and client it came from');

  perform tests.ok(
    has_function_privilege('authenticated', 'public.set_operator_switch(text, boolean)', 'execute')
      and has_function_privilege('service_role', 'public.set_operator_switch(text, boolean)', 'execute')
      and not has_function_privilege('anon', 'public.set_operator_switch(text, boolean)', 'execute')
      and has_table_privilege('service_role', 'public.operator_switch', 'select')
      and not has_table_privilege('service_role', 'public.operator_switch', 'update')
      and (select relrowsecurity from pg_class where oid = 'public.operator_switch'::regclass),
    'operator switch: row security on; the job only reads it; changes go through the audited function');

  -- The report the job writes while the switch is off.
  insert into storage.objects (bucket_id, name, owner_id, created_at, metadata) values
    ('documents', 'switch-test/a.pdf', v_staff::text, now() - interval '30 hours', '{"size": 100}'),
    ('documents', 'switch-test/b.pdf', v_staff::text, now() - interval '26 hours', '{"size": 50}'),
    ('receipts', 'switch-test/r.pdf', v_staff::text, now() - interval '40 hours', '{"size": 7}');
  select * into v_summary from public.unregistered_uploads_summary(now() - interval '24 hours') s
  where s.bucket_id = 'documents';
  perform tests.ok(v_summary.files >= 2 and v_summary.bytes >= 150
      and v_summary.oldest <= now() - interval '30 hours',
    'operator switch: the report counts files, size and the oldest date per bucket');
  perform tests.ok(
    has_function_privilege('service_role', 'public.unregistered_uploads_summary(timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'public.unregistered_uploads_summary(timestamptz)', 'execute'),
    'operator switch: only the service role reads the report');
end;
$$;

rollback;
