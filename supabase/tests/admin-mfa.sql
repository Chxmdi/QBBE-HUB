-- Admin policies must require AAL2 without taking ordinary member access away
-- from the AAL1 session that needs to reach the MFA challenge.
-- Run after qa-users.sql. All test mutations are rolled back.
begin;

do $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_guest_membership uuid;
  v_program uuid;
  n integer;
begin
  select organization_id into strict v_org
  from organization_membership
  where user_id = v_admin;

  select id into strict v_guest_membership
  from organization_membership
  where user_id = v_guest and organization_id = v_org;

  -- Its own program, rather than whichever one happens to be lying around:
  -- this file used to read a row that rls.sql committed, so it only passed on
  -- a database some earlier run had already dirtied.
  insert into program (organization_id, name, slug, created_by)
  values (v_org, 'Admin MFA fixture program', 'admin-mfa-' || gen_random_uuid()::text, v_admin)
  returning id into v_program;

  perform tests.authenticate(v_admin, 'aal1');
  set local role authenticated;
  select count(*) into n from organization_membership where organization_id = v_org;
  perform tests.ok(n > 0, 'AAL1 admin can read the membership needed by the MFA route');
  update organization_membership set updated_at = updated_at where id = v_guest_membership;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'AAL1 admin cannot update organization membership directly');
  update program set updated_at = updated_at where id = v_program;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'AAL1 admin cannot use the staff policy to update operational work');
  reset role;
  perform tests.ok(
    not app.is_staff() and not app.is_org_staff(v_org),
    'AAL1 admin does not satisfy staff write helpers'
  );

  perform tests.authenticate(v_admin, 'aal2');
  set local role authenticated;
  update organization_membership set updated_at = updated_at where id = v_guest_membership;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'AAL2 admin can update organization membership');
  update program set updated_at = updated_at where id = v_program;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'AAL2 admin can update operational work');
  reset role;
  perform tests.ok(
    app.is_staff() and app.is_org_staff(v_org),
    'AAL2 admin satisfies staff write helpers'
  );

  perform tests.authenticate(v_staff, 'aal1');
  set local role authenticated;
  select count(*) into n from organization_membership where organization_id = v_org;
  perform tests.ok(n > 0, 'AAL1 non-admin keeps normal member access');
  update organization_membership set updated_at = updated_at where id = v_guest_membership;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'AAL1 non-admin has no admin privilege');
  reset role;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'service_role')::text,
    true
  );
  perform tests.ok(app.is_admin(), 'service role remains accepted by the admin boundary');
  perform tests.ok(app.is_org_admin(v_org), 'service role remains accepted for organization maintenance');
  reset role;
end;
$$;

rollback;
