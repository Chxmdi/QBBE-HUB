-- #90: an accepted invitation grants membership in the organization that
-- issued it.
--
-- `app.handle_new_user` used to pick the organization with
-- `select id from organization limit 1` — an arbitrary row unrelated to the
-- invitation — while reading the role out of the invitation. The role arrived
-- and the organization did not.
--
-- These assertions are written against a second organization on purpose,
-- because that is the only condition under which the old code was wrong. With
-- one organization in the table, `limit 1` returned the right answer by having
-- no alternative, which is why the suite did not catch this for as long as it
-- did.
--
-- Transactional; fixtures are rolled back.
begin;
do $$
declare
  owner_u uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  joiner uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
  admin_joiner uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc2';
  home_org uuid;
  second_org uuid;
  got_org uuid;
  got_role org_role;
  n int;
begin
  select organization_id into strict home_org
    from public.organization_membership where user_id = owner_u limit 1;

  insert into public.organization(name, slug)
    values ('Second org', 'second-org-invite-test')
    returning id into second_org;

  perform tests.ok(second_org <> home_org, 'the test has two organizations to tell apart');

  -- A staff invitation issued by the second organization.
  insert into public.invitation(organization_id, email, intended_role, invited_by, expires_at)
    values (second_org, 'second-org-staff@example.com', 'staff'::org_role,
            owner_u, now() + interval '30 days');

  perform tests.ensure_auth_user(joiner, 'second-org-staff@example.com', 'Second Org Staff');

  select organization_id, role into got_org, got_role
    from public.organization_membership where user_id = joiner;

  -- The assertion that fails against the old function: it landed the member in
  -- whichever organization came back first.
  perform tests.ok(got_org = second_org,
    'an invitation joins the organization that issued it');
  perform tests.ok(got_role = 'staff',
    'the invitation still carries the role');

  select count(*) into n from public.organization_membership
    where user_id = joiner and organization_id = home_org;
  perform tests.ok(n = 0,
    'an invitation from one organization grants nothing in another');

  select count(*) into n from public.organization_membership where user_id = joiner;
  perform tests.ok(n = 1, 'one invitation grants exactly one membership');

  -- The invitation is spent, and spent in its own organization.
  select count(*) into n from public.invitation
    where organization_id = second_org
      and email = 'second-org-staff@example.com'
      and accepted_at is not null;
  perform tests.ok(n = 1, 'the invitation is spent on use');

  -- The audit trail names the organization the person actually joined. This
  -- followed the same wrong value before, so it is asserted rather than assumed.
  select count(*) into n from public.audit_event
    where object_id = joiner and action = 'user_provisioned'
      and organization_id = second_org;
  perform tests.ok(n = 1, 'the audit record names the organization joined');

  select count(*) into n from public.audit_event
    where object_id = joiner and action = 'user_provisioned'
      and organization_id = home_org;
  perform tests.ok(n = 0, 'no audit record is written against the other organization');

  -- Mandatory channel enrolment follows the membership. The second
  -- organization has no mandatory channels, so the test is that the joiner was
  -- not enrolled into the *first* organization's.
  select count(*) into n
    from public.channel_member cm
    join public.channel c on c.id = cm.channel_id
   where cm.user_id = joiner and c.organization_id = home_org;
  perform tests.ok(n = 0,
    'no mandatory channel of another organization is joined');

  -- Role is carried, not defaulted: an admin invitation from the second
  -- organization must not make an administrator of the first.
  insert into public.invitation(organization_id, email, intended_role, invited_by, expires_at)
    values (second_org, 'second-org-admin@example.com', 'admin'::org_role,
            owner_u, now() + interval '30 days');

  perform tests.ensure_auth_user(admin_joiner, 'second-org-admin@example.com', 'Second Org Admin');

  select count(*) into n from public.organization_membership
    where user_id = admin_joiner and organization_id = home_org
      and role in ('admin', 'owner');
  perform tests.ok(n = 0,
    'an admin invitation elsewhere confers no administration here');

  select organization_id, role into got_org, got_role
    from public.organization_membership where user_id = admin_joiner;
  perform tests.ok(got_org = second_org and got_role = 'admin',
    'an admin invitation makes an administrator of its own organization');

  -- The gate itself still holds: no invitation, no account.
  begin
    perform tests.ensure_auth_user(
      'cccccccc-cccc-cccc-cccc-ccccccccccc3',
      'nobody-invited-me@example.com', 'Uninvited');
    raise exception 'FAIL: an uninvited address created an account';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'sign-up is still by invitation only');
end $$;
rollback;
