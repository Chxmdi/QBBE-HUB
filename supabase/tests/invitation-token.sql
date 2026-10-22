-- An invitation is claimed with the secret it was sent with, and grants
-- nothing until the address is proven (audit SEC-001).
--
-- `app.handle_new_user` used to match an invitation on email alone and grant
-- an ACTIVE membership in the same statement that created the auth user,
-- before the address was confirmed. Anyone who knew an invited address could
-- sign up first and take the seat, an `admin` seat included, and
-- `signup_allowed(email)` told anonymous callers which addresses were invited.
--
-- Creating the user now needs one of: the invitation's token (a password
-- sign-up, or an operator through the Auth admin API), a sign-in provider that
-- has verified the address (Google), or a direct SQL insert marked in
-- `raw_app_meta_data`. The membership waits for `email_confirmed_at`.
--
-- Supabase Auth writes a new user in steps: it inserts the row, then confirms
-- the address with a separate UPDATE and writes user metadata back from its
-- in-memory copy. tests.auth_confirm repeats those steps, so these cases see
-- what the real server does; tests/e2e/invitation-auth-order.spec.ts drives
-- the real server itself.
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

-- What Auth does when it confirms an address: one UPDATE of
-- email_confirmed_at, then user metadata written back from the copy it held
-- in memory (with `email_verified` added), which still has the invite token.
create function tests.auth_confirm(p_id uuid, p_meta_in_memory jsonb default null)
returns void
language plpgsql
set search_path = tests, public, auth
as $$
begin
  update auth.users set email_confirmed_at = now(), confirmation_token = ''
  where id = p_id;
  update auth.users
  set raw_user_meta_data = coalesce(p_meta_in_memory, raw_user_meta_data) || '{"email_verified":true}'::jsonb
  where id = p_id;
end;
$$;

create function tests.has_invite_token(p_id uuid)
returns boolean
language sql
stable
set search_path = tests, auth
as $$ select raw_user_meta_data ? 'invite_token' from auth.users where id = p_id $$;

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
  perform tests.ok(not tests.has_invite_token('dddddddd-0000-0000-0000-000000000004'),
    'the token is removed from user metadata once the sign-up is checked');

  -- 4. Confirming the address grants exactly what the invitation named.
  perform tests.auth_confirm('dddddddd-0000-0000-0000-000000000004',
    '{"full_name":"Token Invitee","invite_token":"right-token-0123456789abcdefghijklmnopqr"}'::jsonb);
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
  perform tests.ok(not tests.has_invite_token('dddddddd-0000-0000-0000-000000000004'),
    'Auth writing its in-memory metadata back does not restore the token');

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
  update auth.users
  set raw_user_meta_data = '{"full_name":"Autoconfirm","invite_token":"autoconfirm-token-abcdefghijklmnopqrstuvwxyz","email_verified":true}'::jsonb
  where id = 'dddddddd-0000-0000-0000-000000000006';
  perform tests.ok(not tests.has_invite_token('dddddddd-0000-0000-0000-000000000006'),
    'any later write of the token to user metadata is stripped');

  -- 7. Google, in the order Auth writes it: the user is inserted unconfirmed
  --    with the provider's claims as user metadata, then confirmed. The
  --    invitation predates links (no token_hash), which Google still honours.
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at)
  values (v_org, 'google-invitee@example.org', 'staff', v_owner, now() + interval '1 day');
  begin
    perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000007',
      'google-invitee@example.org', false,
      '{"full_name":"Unverified Google","email_verified":false}'::jsonb,
      '{"provider":"google","providers":["google"]}'::jsonb);
    perform tests.ok(false, 'a provider sign-up whose address the provider has not verified must be refused');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a provider sign-up whose address the provider has not verified is refused');
  end;
  perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000008',
    'google-invitee@example.org', false,
    '{"full_name":"Verified Google","email_verified":true}'::jsonb,
    '{"provider":"google","providers":["google"]}'::jsonb);
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000008';
  perform tests.ok(n = 0, 'a Google account is created but holds no seat until Auth confirms it');
  perform tests.auth_confirm('dddddddd-0000-0000-0000-000000000008');
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000008' and role = 'staff' and status = 'active';
  perform tests.ok(n = 1, 'a Google-verified address matching an invitation is admitted once confirmed');

  -- A password sign-up cannot claim the provider's word for itself.
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at)
  values (v_org, 'claims-verified@example.org', 'staff', v_owner, now() + interval '1 day');
  begin
    perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000013',
      'claims-verified@example.org', true,
      '{"full_name":"Claims Verified","email_verified":true}'::jsonb);
    perform tests.ok(false, 'email_verified in a password sign-up''s own metadata must prove nothing');
  exception when insufficient_privilege then
    perform tests.ok(true, 'email_verified in a password sign-up''s own metadata proves nothing');
  end;

  -- 8. A direct SQL insert by an operator (test fixtures) marks the account in
  --    app metadata, which a person signing up cannot set. The Auth admin API
  --    adds app_metadata after the insert, so operators there use the token
  --    (tests/e2e/invitation-auth-order.spec.ts).
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
  perform tests.auth_confirm('dddddddd-0000-0000-0000-000000000011');
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000011';
  perform tests.ok(n = 0, 'an invitation revoked before confirmation grants nothing');
  perform tests.ok(
    exists (select 1 from auth.users where id = 'dddddddd-0000-0000-0000-000000000011'
            and email_confirmed_at is not null),
    'the confirmation itself still succeeds');

  -- 10. Claimed in time, confirmed after the expiry: still honoured.
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at, token_hash)
  values (v_org, 'expires-later@example.org', 'staff', v_owner, now() + interval '1 day',
          tests.token_hash('expires-later-token-abcdefghijklmnopqrstuv'))
  returning id into v_invitation;
  perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000012',
    'expires-later@example.org', false,
    '{"full_name":"Expires Later","invite_token":"expires-later-token-abcdefghijklmnopqrstuv"}'::jsonb);
  -- now() is fixed inside this transaction, so date the sign-up back instead
  -- of waiting: the account was created two days ago, the invitation lapsed
  -- a minute ago.
  update auth.users set created_at = now() - interval '2 days'
  where id = 'dddddddd-0000-0000-0000-000000000012';
  update invitation set expires_at = now() - interval '1 minute' where id = v_invitation;
  perform tests.auth_confirm('dddddddd-0000-0000-0000-000000000012');
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000012' and status = 'active';
  perform tests.ok(n = 1, 'an invitation claimed before it expired is honoured on confirmation');

  -- 11. "New link" between sign-up and confirmation replaces the token the
  --     person signed up with. Confirming their address still grants the seat.
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at, token_hash)
  values (v_org, 'relinked@example.org', 'volunteer', v_owner, now() + interval '1 day',
          tests.token_hash('relinked-old-token-abcdefghijklmnopqrstuvw'))
  returning id into v_invitation;
  perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000014',
    'relinked@example.org', false,
    '{"full_name":"Relinked","invite_token":"relinked-old-token-abcdefghijklmnopqrstuvw"}'::jsonb);
  update invitation
  set token_hash = tests.token_hash('relinked-new-token-abcdefghijklmnopqrstuvw'),
      expires_at = now() + interval '14 days'
  where id = v_invitation;
  perform tests.auth_confirm('dddddddd-0000-0000-0000-000000000014');
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000014' and role = 'volunteer' and status = 'active';
  perform tests.ok(n = 1, 'a New link issued before confirmation does not strand the person');

  -- 12. Someone who already holds a membership (granted at sign-up before this
  --     change) confirms later: nothing is granted or audited twice.
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at)
  values (v_org, 'already-member@example.org', 'staff', v_owner, now() + interval '1 day');
  perform tests.invitation_signup('dddddddd-0000-0000-0000-000000000015',
    'already-member@example.org', false, '{"full_name":"Already Member"}'::jsonb,
    '{"provider":"email","providers":["email"],"provisioned_by_operator":true}'::jsonb);
  insert into organization_membership (organization_id, user_id, role, status)
  values (v_org, 'dddddddd-0000-0000-0000-000000000015', 'staff', 'active');
  perform tests.auth_confirm('dddddddd-0000-0000-0000-000000000015');
  select count(*) into n from organization_membership
  where user_id = 'dddddddd-0000-0000-0000-000000000015';
  perform tests.ok(n = 1, 'confirming an existing member grants nothing new');
  select count(*) into n from audit_event
  where object_id = 'dddddddd-0000-0000-0000-000000000015' and action = 'user_provisioned';
  perform tests.ok(n = 0, 'confirming an existing member audits nothing new');
  perform tests.ok(
    exists (select 1 from invitation where email = 'already-member@example.org' and accepted_at is null),
    'confirming an existing member leaves other invitations unspent');
end;
$$;

-- 13. Anonymous visitors: no address oracle, and a token answers only for itself.
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
