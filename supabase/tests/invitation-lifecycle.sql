-- Invitation acceptance must be enforced by the Auth provisioning trigger
-- itself; the sign-up page's own checks only choose which screen to show.
-- Run after qa-users.sql and rls.sql; all records are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_expired_user uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01';
  v_revoked_user uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02';
  v_valid_user uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03';
  v_valid_invitation uuid;
  n integer;
begin
  select organization_id into strict v_org
  from organization_membership owner_membership
  where owner_membership.user_id = v_owner
    and owner_membership.role = 'owner'
    and exists (
      select 1 from organization_membership peer
      where peer.organization_id = owner_membership.organization_id
        and peer.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'
    );

  -- Each invitation carries a token and each sign-up presents it, so a refusal
  -- below can only come from the expiry, revocation or acceptance it names,
  -- never from a missing token (invitation-token.sql covers the token itself).
  insert into invitation (
    organization_id, email, intended_role, invited_by, expires_at, token_hash
  ) values (
    v_org, 'expired-invite@example.com', 'guest', v_owner, now() - interval '1 minute',
    encode(extensions.digest('expired-invite-token-abcdefghijklmnopqrst', 'sha256'), 'hex')
  );

  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_expired_user, 'authenticated', 'authenticated',
      'expired-invite@example.com', 'x', now(), '{}'::jsonb,
      '{"full_name":"Expired Invite","invite_token":"expired-invite-token-abcdefghijklmnopqrst"}'::jsonb, now(), now(), '', '', '', ''
    );
    perform tests.ok(false, 'an expired invitation must not provision a user');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'an expired invitation is rejected during provisioning');
  end;

  select count(*) into n from user_profile where id = v_expired_user;
  perform tests.ok(n = 0, 'expired invitation rejection leaves no profile');
  select count(*) into n from organization_membership where user_id = v_expired_user;
  perform tests.ok(n = 0, 'expired invitation rejection leaves no membership');

  insert into invitation (
    organization_id, email, intended_role, invited_by, expires_at, revoked_at, token_hash
  ) values (
    v_org, 'revoked-invite@example.com', 'volunteer', v_owner,
    now() + interval '1 day', now(),
    encode(extensions.digest('revoked-invite-token-abcdefghijklmnopqrst', 'sha256'), 'hex')
  );

  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_revoked_user, 'authenticated', 'authenticated',
      'revoked-invite@example.com', 'x', now(), '{}'::jsonb,
      '{"full_name":"Revoked Invite","invite_token":"revoked-invite-token-abcdefghijklmnopqrst"}'::jsonb, now(), now(), '', '', '', ''
    );
    perform tests.ok(false, 'a revoked invitation must not provision a user');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a revoked invitation is rejected during provisioning');
  end;

  select count(*) into n from user_profile where id = v_revoked_user;
  perform tests.ok(n = 0, 'revoked invitation rejection leaves no profile');
  select count(*) into n from organization_membership where user_id = v_revoked_user;
  perform tests.ok(n = 0, 'revoked invitation rejection leaves no membership');

  insert into invitation (
    organization_id, email, intended_role, invited_by, expires_at, token_hash
  ) values (
    v_org, 'valid-invite@example.com', 'guest', v_owner, now() + interval '1 day',
    encode(extensions.digest('valid-invite-token-abcdefghijklmnopqrstuv', 'sha256'), 'hex')
  ) returning id into v_valid_invitation;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_valid_user, 'authenticated', 'authenticated',
    'valid-invite@example.com', 'x', now(), '{}'::jsonb,
    '{"full_name":"Valid Invite","invite_token":"valid-invite-token-abcdefghijklmnopqrstuv"}'::jsonb, now(), now(), '', '', '', ''
  );

  select count(*) into n
  from organization_membership
  where user_id = v_valid_user
    and organization_id = v_org
    and role = 'guest'
    and status = 'active';
  perform tests.ok(n = 1, 'a valid invitation provisions its intended active role');
  perform tests.ok(
    exists (
      select 1 from invitation
      where id = v_valid_invitation and accepted_at is not null
    ),
    'a valid invitation is consumed exactly when provisioning succeeds'
  );
end;
$$;

rollback;
