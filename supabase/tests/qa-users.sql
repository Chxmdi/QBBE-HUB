-- QA fixture users (docs/runbooks/qa.md). Idempotent. Never run in production.
-- Password for all three: QaTest!2026
-- The bootstrap trigger provisions the first user as Primary Owner.

create schema if not exists tests;
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

select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'qa-owner@example.com',
  'QA Owner'
);
select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  'qa-staff@example.com',
  'QA Staff'
);
-- Invitation so the bootstrap trigger assigns volunteer rather than staff.
insert into invitation (organization_id, email, intended_role, invited_by, expires_at)
select o.id, 'qa-volunteer@example.com', 'volunteer',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', now() + interval '30 days'
from organization o
where not exists (
  select 1 from invitation i where i.email = 'qa-volunteer@example.com' and i.accepted_at is null
)
limit 1;

select tests.ensure_auth_user(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
  'qa-volunteer@example.com',
  'QA Volunteer'
);

-- Force intended roles in case the trigger ran before the invitation existed.
update organization_membership
  set role = 'staff'
  where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
update organization_membership
  set role = 'volunteer'
  where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
