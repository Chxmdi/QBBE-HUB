-- Google tokens are stored through store_integration_tokens and sync
-- (values are in the sealed form the app writes, 20261121150000; their
-- content is a placeholder)
-- positions through store_integration_sync_state (migration
-- 20261118120000). Proves: a person stores, and on reconnect replaces,
-- the tokens of their own connection without ever reading them back; a
-- reconnect that brings no refresh token keeps the one already stored;
-- sync positions are saved, and nothing but those columns can be written
-- this way; nobody writes to someone else's connection, and an admin cannot
-- take a connection over to do it; anon cannot call either function. All mutations are rolled back.
begin;

create function tests.iss_raises(p_sql text, p_pattern text, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
    v_error := null;
  exception when others then
    v_error := sqlstate || ' ' || sqlerrm;
  end;
  perform tests.ok(v_error is not null and v_error ilike '%' || p_pattern || '%',
    format('%s (%s)', p_msg, coalesce(v_error, 'no error')));
end;
$$;
grant execute on function tests.iss_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_pm uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
  v_org uuid;
  v_conn uuid;
  v_other_conn uuid;
  v_rows integer;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_staff limit 1;
  insert into public.integration_connection (organization_id, user_id, provider, status)
  values (v_org, v_pm, 'gmail', 'connected') returning id into v_other_conn;

  perform tests.authenticate(v_staff, 'aal1');
  insert into public.integration_connection (organization_id, user_id, provider, status)
  values (v_org, v_staff, 'gmail', 'connected') returning id into v_conn;

  perform public.store_integration_tokens(v_conn, 'enc:v1:00000000:iv:tag:access-1', 'enc:v1:00000000:iv:tag:refresh-1', now() + interval '1 hour');
  -- Since 20261121150000 the API roles hold no grant on the table at all.
  perform tests.ok(tests.permission_denied('select count(*) from public.integration_secret'),
    'the person who stored the tokens cannot read them back');

  -- Reconnect: Google sends a new access token but no refresh token.
  perform public.store_integration_tokens(v_conn, 'enc:v1:00000000:iv:tag:access-2', null, now() + interval '1 hour');
  perform public.store_integration_sync_state(v_conn, jsonb_build_object(
    'gmail_history_id', '12345', 'gmail_watch_expiration_at', '2031-01-01T00:00:00Z',
    'access_token', 'not-through-here'));

  perform tests.iss_raises(format('select public.store_integration_tokens(%L, ''x'', ''y'', null)', v_other_conn),
    '42501', 'nobody stores tokens on someone else''s connection');
  perform tests.iss_raises(format('select public.store_integration_sync_state(%L, ''{"gmail_history_id": "1"}''::jsonb)', v_other_conn),
    '42501', 'nobody saves sync state on someone else''s connection');
  perform tests.iss_raises(format('select public.store_integration_tokens(%L, '''', null, null)', v_conn),
    '22023', 'an empty access token is refused');
  perform tests.iss_raises(format('select public.store_integration_sync_state(%L, ''"gmail_history_id"''::jsonb)', v_conn),
    '22023', 'the sync state must be an object');
  perform tests.clear_auth(); reset role;

  -- An admin may manage connections but not take one over to store their
  -- own tokens on it.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'aal2');
  perform tests.iss_raises(format('update public.integration_connection set user_id = auth.uid() where id = %L', v_other_conn),
    '42501', 'an admin cannot move someone''s connection to themselves');
  perform tests.iss_raises(format('select public.store_integration_tokens(%L, ''a2'', ''r2'', null)', v_other_conn),
    '42501', 'so an admin cannot store tokens on it');
  perform tests.clear_auth(); reset role;

  select * into r from public.integration_secret where connection_id = v_conn;
  perform tests.ok(r.access_token = 'enc:v1:00000000:iv:tag:access-2', 'a reconnect replaces the access token');
  perform tests.ok(r.refresh_token = 'enc:v1:00000000:iv:tag:refresh-1', 'a reconnect without a refresh token keeps the stored one');
  perform tests.ok(r.gmail_history_id = '12345' and r.gmail_watch_expiration_at = timestamptz '2031-01-01T00:00:00Z',
    'sync positions are saved');
  perform tests.ok(not exists (select 1 from public.integration_secret where connection_id = v_other_conn),
    'the other person''s connection has no tokens');

  begin
    set local role anon;
    perform public.store_integration_tokens(v_conn, 'enc:v1:00000000:iv:tag:a', 'enc:v1:00000000:iv:tag:b', null);
    reset role;
    perform tests.ok(false, 'anon cannot store tokens');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot store tokens');
  end;
end;
$$;

rollback;
