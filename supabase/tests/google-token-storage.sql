-- Google tokens are stored encrypted, never readable by anyone signed in, and
-- every stored token that is deleted is queued to be revoked at Google
-- (PRIV-011). Run after qa-users.sql and rls.sql. Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_conn uuid;
  v_other uuid;
  v_legacy uuid;
  v_sealed text := 'enc:v1:0a1b2c3d:aXZpdml2aXZpdml2:dGFndGFndGFndGFndGFn:Y2lwaGVydGV4dA';
  n integer;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;
  insert into integration_connection (organization_id, user_id, provider, status)
    values (v_org, v_staff, 'gmail', 'connected') returning id into v_conn;
  insert into integration_connection (organization_id, user_id, provider, status)
    values (v_org, v_staff, 'google_calendar', 'connected') returning id into v_other;

  -- Only the sealed form is stored.
  begin
    insert into integration_secret (connection_id, access_token) values (v_conn, 'ya29.plain-access-token');
    perform tests.ok(false, 'google tokens: a plaintext access token is refused');
  exception when check_violation then
    perform tests.ok(true, 'google tokens: a plaintext access token is refused');
  end;
  begin
    insert into integration_secret (connection_id, access_token, refresh_token) values (v_conn, v_sealed, '1//plain-refresh');
    perform tests.ok(false, 'google tokens: a plaintext refresh token is refused');
  exception when check_violation then
    perform tests.ok(true, 'google tokens: a plaintext refresh token is refused');
  end;
  insert into integration_secret (connection_id, access_token, refresh_token) values (v_conn, v_sealed, v_sealed);
  insert into integration_secret (connection_id, access_token) values (v_other, v_sealed);
  perform tests.ok(true, 'google tokens: sealed tokens are stored');
  begin
    update integration_secret set refresh_token = '1//plain-refresh' where connection_id = v_conn;
    perform tests.ok(false, 'google tokens: a token cannot be changed to plaintext');
  exception when check_violation then
    perform tests.ok(sqlerrm !~ 'plain-refresh', 'google tokens: a token cannot be changed to plaintext, and the refusal names no value');
  end;

  -- A row stored before encryption keeps working until the upkeep job seals
  -- it: its cursors still save, and a refreshed (sealed) access token too.
  set local session_replication_role = replica;
  insert into integration_connection (organization_id, user_id, provider, status)
    values (v_org, v_owner, 'gmail', 'connected') returning id into v_legacy;
  insert into integration_secret (connection_id, access_token, refresh_token) values (v_legacy, 'ya29.legacy', '1//legacy');
  set local session_replication_role = origin;
  update integration_secret set gmail_history_id = '42' where connection_id = v_legacy;
  update integration_secret set access_token = v_sealed where connection_id = v_legacy;
  perform tests.ok((select gmail_history_id from integration_secret where connection_id = v_legacy) = '42',
    'google tokens: a row stored before encryption still saves its cursor and a sealed refreshed token');

  -- Nobody signed in reads them, not even the connection's owner, and not
  -- through the API at all.
  perform tests.authenticate(v_staff, 'aal2');
  perform tests.ok(tests.permission_denied('select access_token from integration_secret'),
    'google tokens: the connection''s owner cannot read the access token');
  perform tests.ok(tests.permission_denied('select refresh_token from integration_secret'),
    'google tokens: the connection''s owner cannot read the refresh token');
  perform tests.ok(tests.permission_denied('select * from google_token_revocation'),
    'google tokens: the revocation queue is not readable');
  perform tests.clear_auth();
  reset role;
  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(tests.permission_denied('select refresh_token from integration_secret'),
    'google tokens: an owner of the organization cannot read them either');
  perform tests.clear_auth();
  reset role;
  perform tests.ok(
    not has_table_privilege('authenticated', 'public.integration_secret', 'select')
      and not has_column_privilege('authenticated', 'public.integration_secret', 'access_token', 'select')
      and not has_column_privilege('authenticated', 'public.integration_secret', 'refresh_token', 'select')
      and not has_table_privilege('anon', 'public.integration_secret', 'select')
      and not has_table_privilege('authenticated', 'public.google_token_revocation', 'select'),
    'google tokens: no API role holds a read grant on the tokens or the queue');

  -- Deleting a stored token queues it for revocation at Google, whatever deletes it.
  delete from integration_secret where connection_id = v_conn;
  select count(*) into n from google_token_revocation where connection_id = v_conn and token = v_sealed and provider = 'gmail';
  perform tests.ok(n = 1, 'google tokens: a deleted token is queued to be revoked');
  delete from integration_connection where id = v_other;
  select count(*) into n from google_token_revocation
  where connection_id = v_other and organization_id = v_org and user_id = v_staff and provider = 'google_calendar';
  perform tests.ok(n = 1, 'google tokens: a token deleted with its connection is queued to be revoked, saying whose it was');

  -- Deactivating the member (20261122050000) deletes their tokens: queued too.
  insert into integration_connection (organization_id, user_id, provider, status)
    values (v_org, v_staff, 'google_drive', 'connected') returning id into v_conn;
  insert into integration_secret (connection_id, access_token, refresh_token) values (v_conn, v_sealed, v_sealed);
  update organization_membership set status = 'deactivated' where user_id = v_staff and organization_id = v_org;
  select count(*) into n from google_token_revocation where connection_id = v_conn;
  perform tests.ok(n = 1, 'google tokens: deactivating a member queues their tokens to be revoked');
  perform tests.ok(not exists (select 1 from integration_secret where connection_id = v_conn),
    'google tokens: deactivating a member deletes their stored tokens');

  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.google_token_revocation'::regclass)
      and has_table_privilege('service_role', 'public.google_token_revocation', 'delete'),
    'google tokens: the queue has row security on and only the service role works it');
  perform tests.ok(exists (select 1 from job_definition where name = 'google-token-upkeep'),
    'google tokens: the upkeep job that seals and revokes is registered');
end;
$$;

rollback;
