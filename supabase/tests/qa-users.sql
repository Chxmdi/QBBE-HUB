-- QA fixture users (docs/runbooks/qa.md). Idempotent. Never run in production.
-- Password for all of them: QaTest!2026
--
-- One user per organization role, because the permission matrix is only
-- meaningful if every role in it is actually represented: owner, admin, staff,
-- volunteer, guest.
-- The bootstrap trigger provisions the first user as Primary Owner.

create schema if not exists tests;

-- Supabase already installs pgcrypto into `extensions`, so this is a no-op
-- there rather than a guarantee. The helper below therefore carries
-- `extensions` on its search_path: on Supabase that is where crypt() and
-- gen_salt() live, and on a vanilla Postgres the extension lands in `public`,
-- which is on the path already.
create extension if not exists pgcrypto;

-- Helper: insert a confirmed auth user + identity if missing.
create or replace function tests.ensure_auth_user(
  p_id uuid,
  p_email text,
  p_full_name text,
  p_password text default 'QaTest!2026'
) returns void
language plpgsql
security definer
set search_path = tests, public, auth, extensions
as $$
begin
  if exists (select 1 from auth.users where id = p_id or email = p_email) then
    return;
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    p_id,
    'authenticated',
    'authenticated',
    p_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    p_id,
    p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email),
    'email',
    p_id::text,
    now(), now(), now()
  );
end;
$$;

-- The first account bootstraps the workspace and becomes Primary Owner; it is
-- the one sign-up that needs no invitation, and it has to run before the
-- invitations below because they need an organization to belong to.
select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'qa-owner@example.com',
  'QA Owner'
);
-- Every fixture user after the owner needs a live invitation, because sign-up
-- is invite-only and the trigger now enforces that rather than trusting the
-- browser. This is not fixture bookkeeping: it means the suite exercises the
-- real admission path instead of a side door the product does not have.
insert into invitation (organization_id, email, intended_role, invited_by, expires_at)
select o.id, v.email, v.role::org_role,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', now() + interval '30 days'
from organization o
cross join (values
  ('qa-staff@example.com', 'staff'),
  ('qa-volunteer@example.com', 'volunteer'),
  ('qa-admin@example.com', 'admin'),
  ('qa-guest@example.com', 'guest'),
  -- Scoped roles (#110). Their org role is deliberately ordinary: what they
  -- can reach beyond it comes from the grants in qa-scoped-grants.sql, which
  -- is the thing the role matrix exists to prove.
  ('qa-lead@example.com', 'staff'),
  ('qa-pm@example.com', 'staff'),
  ('qa-contributor@example.com', 'volunteer'),
  ('qa-readonly@example.com', 'volunteer')
) as v(email, role)
where not exists (
  select 1 from invitation i where i.email = v.email and i.accepted_at is null
)
and not exists (select 1 from auth.users u where u.email = v.email)
limit 8;

select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  'qa-staff@example.com',
  'QA Staff'
);

select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
  'qa-volunteer@example.com',
  'QA Volunteer'
);

select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
  'qa-admin@example.com',
  'QA Admin'
);
select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5',
  'qa-guest@example.com',
  'QA Guest'
);

select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6',
  'qa-lead@example.com',
  'QA Program Lead'
);
select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7',
  'qa-pm@example.com',
  'QA Project Manager'
);
select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8',
  'qa-contributor@example.com',
  'QA Contributor'
);
select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9',
  'qa-readonly@example.com',
  'QA Read Only'
);

-- Force intended roles in case the trigger ran before the invitation existed.
update organization_membership
  set role = 'staff'
  where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
update organization_membership
  set role = 'volunteer'
  where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
update organization_membership
  set role = 'admin'
  where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
update organization_membership
  set role = 'guest'
  where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
update organization_membership
  set role = 'staff'
  where user_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7');
update organization_membership
  set role = 'volunteer'
  where user_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9');

-- QA users skip first-run onboarding so authenticated Playwright can reach the workspace.
update user_profile
  set onboarded_at = coalesce(onboarded_at, now())
  where id in (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9'
  );
