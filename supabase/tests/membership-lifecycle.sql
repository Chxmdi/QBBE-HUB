-- Membership ownership and lifecycle invariants. Run after qa-users.sql and
-- rls.sql. All mutations are transactional and rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_owner_membership uuid;
  v_staff_membership uuid;
  v_admin_membership uuid;
  v_guest_membership uuid;
  v_other_org uuid := gen_random_uuid();
  v_other_membership uuid := gen_random_uuid();
  n integer;
  before_count integer;
begin
  select owner_membership.organization_id, owner_membership.id
    into strict v_org, v_owner_membership
  from organization_membership owner_membership
  where owner_membership.user_id = v_owner
    and exists (
      select 1 from organization_membership peer
      where peer.organization_id = owner_membership.organization_id
        and peer.user_id = v_admin
    );
  select id into strict v_staff_membership
  from organization_membership where organization_id = v_org and user_id = v_staff;
  select id into strict v_admin_membership
  from organization_membership where organization_id = v_org and user_id = v_admin;
  select id into strict v_guest_membership
  from organization_membership where organization_id = v_org and user_id = v_guest;

  insert into organization (id, name, slug)
    values (v_other_org, 'Membership lifecycle other org', 'membership-other-' || v_other_org);
  insert into organization_membership (
    id, organization_id, user_id, role, status
  ) values (
    v_other_membership, v_other_org, v_guest, 'owner', 'active'
  );

  perform tests.authenticate(v_admin, 'aal2');
  set local role authenticated;

  begin
    update organization_membership set role = 'admin' where id = v_owner_membership;
    raise exception 'FAIL: direct authenticated update demoted the owner';
  exception when insufficient_privilege then null;
  end;

  begin
    update organization_membership set role = 'owner' where id = v_staff_membership;
    raise exception 'FAIL: direct authenticated update promoted an owner';
  exception when insufficient_privilege then null;
  end;

  begin
    update organization_membership set status = 'deactivated' where id = v_admin_membership;
    raise exception 'FAIL: administrator deactivated their own account';
  exception when insufficient_privilege then null;
  end;

  select count(*) into before_count from audit_event
  where object_id = v_staff_membership and action = 'role_changed';
  update organization_membership set role = 'volunteer' where id = v_staff_membership;
  select count(*) into n from audit_event
  where object_id = v_staff_membership and action = 'role_changed';
  perform tests.ok(n = before_count + 1, 'ordinary role change writes one transactional audit event');

  select count(*) into before_count from audit_event
  where object_id = v_guest_membership and action = 'user_deactivated';
  update organization_membership
    set status = 'deactivated', deactivated_at = now()
    where id = v_guest_membership;
  select count(*) into n from audit_event
  where object_id = v_guest_membership and action = 'user_deactivated';
  perform tests.ok(n = before_count + 1, 'deactivation writes one transactional audit event');
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  set local role authenticated;
  begin
    perform public.transfer_organization_ownership(v_admin_membership);
    raise exception 'FAIL: AAL1 owner transferred ownership';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  set local role authenticated;
  begin
    perform public.transfer_organization_ownership(v_other_membership);
    raise exception 'FAIL: owner transferred ownership across organizations';
  exception when invalid_parameter_value then null;
  end;
  reset role;

  select count(*) into n from organization_membership
  where organization_id = v_org and role = 'owner' and status = 'active';
  perform tests.ok(n = 1, 'rejected transfers leave exactly one active owner');
  perform tests.ok(
    exists(select 1 from organization_membership where id = v_owner_membership and role = 'owner')
    and exists(select 1 from organization_membership where id = v_admin_membership and role = 'admin'),
    'rejected transfer leaves both membership roles unchanged'
  );

  perform tests.authenticate(v_owner, 'aal2');
  set local role authenticated;
  perform public.transfer_organization_ownership(v_admin_membership);
  reset role;

  perform tests.ok(
    exists(select 1 from organization_membership where id = v_owner_membership and role = 'admin')
    and exists(select 1 from organization_membership where id = v_admin_membership and role = 'owner'),
    'AAL2 owner transfers ownership atomically'
  );
  select count(*) into n from organization_membership
  where organization_id = v_org and role = 'owner' and status = 'active';
  perform tests.ok(n = 1, 'successful transfer keeps exactly one active owner');
  select count(*) into n from audit_event
  where organization_id = v_org
    and action = 'ownership_transferred'
    and object_id = v_admin_membership
    and actor_id = v_owner;
  perform tests.ok(n = 1, 'successful transfer records one attributable ownership event');
end;
$$;

rollback;
