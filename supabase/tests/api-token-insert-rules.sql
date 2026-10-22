-- API keys are for staff, and for owners and administrators only after a
-- completed MFA sign-in, in the database as on the screen. Creating and
-- revoking one is recorded in the audit trail. Old API call logs are purged.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  volunteer_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  guest_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  org uuid;
  who uuid;
  refused boolean;
  tok uuid;
  n int;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  perform tests.ensure_verified_mfa_factor(admin_user);

  foreach who in array array[guest_user, volunteer_user] loop
    reset role;
    perform tests.authenticate(who, 'aal1');
    set local role authenticated;
    refused := false;
    begin
      insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
      values (org, who, 'Mine', md5(who::text) || md5(who::text), 'qbbe_mine001', array['objects:read'], now() + interval '300 days');
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot create an API key directly', who));
  end loop;

  reset role;
  perform tests.authenticate(admin_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
    values (org, admin_user, 'Admin key', repeat('e', 64), 'qbbe_admin02', array['objects:read'], now() + interval '30 days');
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an administrator without a completed MFA sign-in cannot create an API key');

  reset role;
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
  values (org, staff_user, 'Staff key', repeat('f', 64), 'qbbe_staff02', array['objects:read'], now() + interval '30 days');
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'staff can create an API key');
  reset role;
  select id into tok from public.api_token where token_hash = repeat('f', 64);
  select count(*) into n from public.audit_event
  where object_id = tok and action = 'api_token_created' and actor_id = staff_user;
  perform tests.ok(n = 1, 'creating an API key is audited');
  select count(*) into n from public.audit_event
  where object_id = tok and metadata::text like '%' || repeat('f', 64) || '%';
  perform tests.ok(n = 0, 'the audit entry does not hold the key''s hash');

  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  perform public.revoke_api_token(tok);
  reset role;
  select count(*) into n from public.audit_event
  where object_id = tok and action = 'api_token_revoked' and actor_id = staff_user;
  perform tests.ok(n = 1, 'revoking an API key is audited');

  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
  values (org, admin_user, 'Admin key', repeat('e', 64), 'qbbe_admin02', array['objects:read'], now() + interval '30 days');
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'an administrator with MFA can create an API key');

  -- Purge.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.api_request_log (organization_id, method, path, status, created_at)
  values (org, 'GET', '/api/v1/me', 200, now() - interval '91 days'),
         (org, 'GET', '/api/v1/me', 200, now() - interval '10 days');
  perform app.purge_api_request_log();
  select count(*) into n from public.api_request_log where created_at < now() - interval '90 days';
  perform tests.ok(n = 0, 'API call logs older than 90 days are purged');
  select count(*) into n from public.api_request_log where created_at > now() - interval '11 days' and path = '/api/v1/me';
  perform tests.ok(n >= 1, 'recent API call logs are kept');
  select count(*) into n from cron.job where jobname = 'purge-api-request-log';
  perform tests.ok(n = 1, 'the purge runs on a schedule');
end;
$$;
rollback;
