-- An invitation is claimed with the secret it was sent with, and grants
-- nothing until the address is proven (audit SEC-001).
--
-- `app.handle_new_user` used to match an invitation on email alone and grant
-- an ACTIVE membership in the same statement that created the auth user,
-- before the address was confirmed. Anyone who knew an invited address could
-- sign up first and take the seat, an `admin` seat included, and
-- `signup_allowed(email)` told anonymous callers which addresses were invited.
--
-- A password sign-up now has to present the invitation's token, and the
-- membership waits for `email_confirmed_at`. Two other ways in keep working,
-- each with its own proof: a sign-in provider that has already verified the
-- address (Google), and an operator provisioning an account with the service
-- role or database access, marked in `raw_app_meta_data`, which a person
-- signing up cannot set.
--
-- Run after qa-users.sql and rls.sql; everything is rolled back.
begin;

create function tests.invitation_signup(
  p_id uuid,
  p_email text,
  p_confirmed boolean,
  p_user_meta jsonb,
  p_app_meta jsonb default '{"provider":"email","providers":["email"]}'::jsonb
) returns void
language plpgsql
set search_path = tests, public, auth, extensions
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    p_id, 'authenticated', 'authenticated', p_email, 'x',
    case when p_confirmed then now() end,
    p_app_meta, p_user_meta,
    now(), now(), '', '', '', ''
  );
end;
$$;

create function tests.token_hash(p_token text)
returns text
language sql
immutable
set search_path = tests, extensions
as $$ select encode(extensions.digest(p_token, 'sha256'), 'hex') $$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_invitation uuid;
  v_mandatory integer;
  n integer;
  r record;
begin
  select organization_id into strict v_org
  from organization_membership
  where user_id = v_owner and role = 'owner'
  limit 1;
  select count(*) into v_mandatory from channel
  where organization_id = v_org and is_mandatory;

  insert into invitation (organization_id, email, intended_role, invited_by, expires_at, token_hash)
  values (v_org, 'token-invitee@example.org', 'admin', v_owner, now() + interval '1 day',
          tests.token_hash('right-token-0123456789abcdefghijklmnopqr'))
  returning id into v_invitation;

  -- 1. Knowing the address is no longer enough.
  begin
    perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000001',
      'token-invitee@example.org', true, '{"full_name":"No Token"}'::jsonb);
    perform tests.ok(false, 'a password sign-up without the invitation token must be refused');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a password sign-up without the invitation token is refused');
  end;

  begin
    perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000002',
      'token-invitee@example.org', true,
      '{"full_name":"Wrong Token","invite_token":"wrong-token"}'::jsonb);
    perform tests.ok(false, 'a wrong invitation token must be refused');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a wrong invitation token is refused');
  end;

  -- 2. The token is bound to the address it was sent to.
  begin
    perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000003',
      'someone-else@example.org', true,
      '{"full_name":"Other Address","invite_token":"right-token-0123456789abcdefghijklmnopqr"}'::jsonb);
    perform tests.ok(false, 'a token used with another address must be refused');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a token used with another address is refused');
  end;

  select count(*) into n from user_profile
  where id in ('dddddddd-0000-0000-0000-000000000001',
               'dddddddd-0000-0000-0000-000000000002',
               'dddddddd-0000-0000-0000-000000000003');
  perform tests.ok(n = 0, 'refused sign-ups leave no profile behind');
  perform tests.ok(
    exists (select 1 from invitation where id = v_invitation and accepted_at is null),
    'refused sign-ups do not spend the invitation');

  -- 3. Right token, address not yet confirmed: an account, but no seat.
  perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000004',
    'token-invitee@example.org', false,
    '{"full_name":"Token Invitee","invite_token":"right-token-0123456789abcdefghijklmnopqr"}'::jsonb);
  select count(*) into n from user_profile where id = 'dddddddd-0000-0000-0000-000000000004';
  perform tests.ok(n = 1, 'a sign-up with the right token creates the profile');
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000004';
  perform tests.ok(n = 0, 'no membership is granted before the address is confirmed');
  perform tests.ok(
    exists (select 1 from invitation where id = v_invitation and accepted_at is null),
    'the invitation stays open until the address is confirmed');

  -- 4. Confirming the address grants exactly what the invitation named.
  update auth.users set email_confirmed_at = now()
  where id = 'dddddddd-0000-0000-0000-000000000004';
  select role, status, organization_id into r from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000004';
  perform tests.ok(r.role = 'admin' and r.status = 'active' and r.organization_id = v_org,
    'confirming the address grants the invited role in the inviting organization');
  perform tests.ok(
    exists (select 1 from invitation where id = v_invitation and accepted_at is not null),
    'the invitation is spent when the membership is granted');
  select count(*) into n from channel_member cm join channel c on c.id = cm.channel_id
  where cm.user_id = 'dddddddd-0000-0000-0000-000000000004' and c.is_mandatory;
  perform tests.ok(n = v_mandatory, 'the confirmed member joins every mandatory channel');
  select count(*) into n from audit_event
  where object_id = 'dddddddd-0000-0000-0000-000000000004'
    and action = 'user_provisioned' and organization_id = v_org;
  perform tests.ok(n = 1, 'the provisioning is audited once, in the inviting organization');

  -- A second confirmation-like update grants nothing twice.
  update auth.users set email_confirmed_at = now()
  where id = 'dddddddd-0000-0000-0000-000000000004';
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000004';
  perform tests.ok(n = 1, 'one invitation grants exactly one membership');

  -- 5. A spent token cannot be used again.
  begin
    perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000005',
      'token-invitee@example.org', true,
      '{"full_name":"Replay","invite_token":"right-token-0123456789abcdefghijklmnopqr"}'::jsonb);
    perform tests.ok(false, 'a spent invitation token must be refused');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a spent invitation token is refused');
    when unique_violation then
      perform tests.ok(true, 'a spent invitation token is refused (address already registered)');
  end;

  -- 6. Where Auth confirms on sign-up (local, or autoconfirm), the token still
  --    decides and the seat is granted at once.
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at, token_hash)
  values (v_org, 'autoconfirm-invitee@example.org', 'volunteer', v_owner, now() + interval '1 day',
          tests.token_hash('autoconfirm-token-abcdefghijklmnopqrstuvwxyz'));
  perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000006',
    'autoconfirm-invitee@example.org', true,
    '{"full_name":"Autoconfirm","invite_token":"autoconfirm-token-abcdefghijklmnopqrstuvwxyz"}'::jsonb);
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000006' and role = 'volunteer' and status = 'active';
  perform tests.ok(n = 1, 'a confirmed sign-up with the right token is admitted immediately');

  -- 7. Google: the provider has verified the address, so the address is the proof.
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at, token_hash)
  values (v_org, 'google-invitee@example.org', 'staff', v_owner, now() + interval '1 day',
          tests.token_hash('google-token-unused-abcdefghijklmnopqrstuv'));
  begin
    perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000007',
      'google-invitee@example.org', false, '{"full_name":"Unverified Google"}'::jsonb,
      '{"provider":"google","providers":["google"]}'::jsonb);
    perform tests.ok(false, 'a provider sign-up whose address is not verified must be refused');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a provider sign-up whose address is not verified is refused');
  end;
  perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000008',
    'google-invitee@example.org', true, '{"full_name":"Verified Google"}'::jsonb,
    '{"provider":"google","providers":["google"]}'::jsonb);
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000008' and role = 'staff' and status = 'active';
  perform tests.ok(n = 1, 'a Google-verified address matching an invitation is admitted');

  -- 8. Operators provisioning with the service role mark the account in
  --    app metadata, which a person signing up cannot set.
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at)
  values (v_org, 'operator-provisioned@example.org', 'guest', v_owner, now() + interval '1 day');
  perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000009',
    'operator-provisioned@example.org', true, '{"full_name":"Operator Provisioned"}'::jsonb,
    '{"provider":"email","providers":["email"],"provisioned_by_operator":true}'::jsonb);
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000009' and role = 'guest' and status = 'active';
  perform tests.ok(n = 1, 'an operator-provisioned account with an open invitation is admitted');

  begin
    perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000010',
      'nobody-invited-operator@example.org', true, '{"full_name":"No Invitation"}'::jsonb,
      '{"provider":"email","providers":["email"],"provisioned_by_operator":true}'::jsonb);
    perform tests.ok(false, 'operator provisioning still needs an invitation');
  exception when insufficient_privilege then
    perform tests.ok(true, 'operator provisioning still needs an invitation');
  end;

  -- 9. Revoked between sign-up and confirmation: confirming grants nothing.
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at, token_hash)
  values (v_org, 'revoked-later@example.org', 'staff', v_owner, now() + interval '1 day',
          tests.token_hash('revoked-later-token-abcdefghijklmnopqrstuv'))
  returning id into v_invitation;
  perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000011',
    'revoked-later@example.org', false,
    '{"full_name":"Revoked Later","invite_token":"revoked-later-token-abcdefghijklmnopqrstuv"}'::jsonb);
  update invitation set revoked_at = now() where id = v_invitation;
  update auth.users set email_confirmed_at = now()
  where id = 'dddddddd-0000-0000-0000-000000000011';
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000011';
  perform tests.ok(n = 0, 'an invitation revoked before confirmation grants nothing');

  -- 10. Claimed in time, confirmed after the expiry: still honoured.
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at, token_hash)
  values (v_org, 'expires-later@example.org', 'staff', v_owner, now() + interval '1 day',
          tests.token_hash('expires-later-token-abcdefghijklmnopqrstuv'))
  returning id into v_invitation;
  perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000012',
    'expires-later@example.org', false,
    '{"full_name":"Expires Later","invite_token":"expires-later-token-abcdefghijklmnopqrstuv"}'::jsonb);
  update invitation set expires_at = now() - interval '1 minute' where id = v_invitation;
  update auth.users set email_confirmed_at = now()
  where id = 'dddddddd-0000-0000-0000-000000000012';
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000012' and status = 'active';
  perform tests.ok(n = 1, 'an invitation claimed before it expired is honoured on confirmation');
end;
$$;

-- 11. Anonymous visitors: no address oracle, and a token answers only for itself.
insert into invitation (organization_id, email, intended_role, invited_by, expires_at, token_hash)
select organization_id, 'preview-invitee@example.org', 'staff', user_id, now() + interval '1 day',
       tests.token_hash('preview-token-abcdefghijklmnopqrstuvwxyz0123')
from organization_membership
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' and role = 'owner'
limit 1;

do $$
declare
  n integer;
  r record;
begin
  perform tests.clear_auth();

  begin
    perform public.signup_allowed('preview-invitee@example.org');
    perform tests.ok(false, 'anonymous visitors must not be able to ask who is invited');
  exception when insufficient_privilege then
    perform tests.ok(true, 'anonymous visitors cannot ask who is invited');
  end;

  select * into r from public.invitation_preview('preview-token-abcdefghijklmnopqrstuvwxyz0123');
  perform tests.ok(r.email = 'preview-invitee@example.org' and r.intended_role = 'staff'
    and r.organization_name is not null,
    'the invitation link previews its own address, role and organization');

  select count(*) into n from public.invitation_preview('not-a-real-token');
  perform tests.ok(n = 0, 'an unknown token previews nothing');

  select count(*) into n from public.invitation_preview('');
  perform tests.ok(n = 0, 'an empty token previews nothing');

  perform tests.ok(public.workspace_bootstrap_open() = false,
    'sign-up without an invitation is closed once a workspace exists');

  reset role;
end;
$$;

-- The token is stored only as its SHA-256 fingerprint.
do $$
begin
  begin
    insert into invitation (organization_id, email, intended_role, invited_by, token_hash)
    select organization_id, 'bad-hash@example.org', 'staff', user_id, 'not-a-hash'
    from organization_membership
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' and role = 'owner'
    limit 1;
    perform tests.ok(false, 'a token_hash that is not a SHA-256 hex digest must be refused');
  exception when check_violation then
    perform tests.ok(true, 'only SHA-256 hex digests are stored as invitation tokens');
  end;
end;
$$;

rollback;
