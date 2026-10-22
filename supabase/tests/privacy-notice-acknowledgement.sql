-- privacy_notice_acknowledgement (migration 20261120110000): each person
-- records, and reads, only their own acknowledgement of a version of the
-- privacy notice. The time is the database's, not the caller's, and a
-- recorded acknowledgement cannot be changed or removed through the API.
-- Run after qa-users.sql and rls.sql. Rolled back.
begin;

do $$
declare
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_count integer;
begin
  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.privacy_notice_acknowledgement'::regclass),
    'row-level security is on');
  perform tests.ok(
    not has_table_privilege('anon', 'public.privacy_notice_acknowledgement', 'select')
      and not has_table_privilege('anon', 'public.privacy_notice_acknowledgement', 'insert'),
    'signed-out callers have no access');
  perform tests.ok(
    not has_table_privilege('authenticated', 'public.privacy_notice_acknowledgement', 'update')
      and not has_table_privilege('authenticated', 'public.privacy_notice_acknowledgement', 'delete')
      and not has_table_privilege('service_role', 'public.privacy_notice_acknowledgement', 'update')
      and not has_table_privilege('service_role', 'public.privacy_notice_acknowledgement', 'delete'),
    'an acknowledgement cannot be changed or removed through the API');
  perform tests.ok(
    not has_column_privilege('authenticated', 'public.privacy_notice_acknowledgement', 'acknowledged_at', 'insert'),
    'the acknowledgement time is set by the database, not the caller');

  perform tests.authenticate(v_staff, 'aal1');
  insert into public.privacy_notice_acknowledgement (user_id, notice_version)
  values (v_staff, '2026-10-22-draft');
  select count(*) into v_count from public.privacy_notice_acknowledgement;
  perform tests.ok(v_count = 1, 'a person records and reads their own acknowledgement');

  begin
    insert into public.privacy_notice_acknowledgement (user_id, notice_version)
    values (v_volunteer, '2026-10-22-draft');
    perform tests.ok(false, 'nobody records an acknowledgement for someone else');
  exception when insufficient_privilege then
    perform tests.ok(true, 'nobody records an acknowledgement for someone else');
  end;

  begin
    insert into public.privacy_notice_acknowledgement (user_id, notice_version)
    values (v_staff, '2026-13-45');
    perform tests.ok(false, 'the version must be a real date');
  exception when check_violation then
    perform tests.ok(true, 'the version must be a real date');
  end;

  begin
    insert into public.privacy_notice_acknowledgement (user_id, notice_version)
    values (v_staff, 'anything at all');
    perform tests.ok(false, 'the version must look like a notice version');
  exception when check_violation then
    perform tests.ok(true, 'the version must look like a notice version');
  end;
  perform tests.clear_auth();

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_count from public.privacy_notice_acknowledgement;
  perform tests.ok(v_count = 0, 'nobody reads another person''s acknowledgement');
  perform tests.clear_auth();
end
$$;

rollback;
