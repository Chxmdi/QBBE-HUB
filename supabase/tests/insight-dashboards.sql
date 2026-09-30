-- Insight dashboards (V2-5, epic #199): the dashboards add no table. Their
-- Finance figures read gift and finance_bill rows through the viewer's own
-- session, so each figure is visible exactly to those the underlying rules
-- admit: gifts to the ledger's readers (owner and admin with two-step sign-in,
-- and the external accountant), bills to organization staff. Their trend figures read activity_event, which a signed-out
-- visitor must not see. Checked for owner, admin, staff, member (guest),
-- volunteer, the accountant and signed-out.
--
-- The fixture rows are written as the database owner with foreign-key
-- triggers off: what is under test is who may read them, not how a gift is
-- recorded (gift-acknowledgements.sql covers that). Run after qa-users.sql
-- and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_member uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_gift uuid := gen_random_uuid();
  v_bill uuid := gen_random_uuid();
  v_activity uuid;
  v_role record;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  -- The guest becomes the external accountant; the second volunteer-role
  -- fixture account stands in for an ordinary member with no ledger access.
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);

  set local session_replication_role = replica;
  insert into public.gift (id, organization_id, gift_number, gift_type, crm_contact_id, received_on, amount_cents, fund_id, status)
  values (v_gift, v_org, 990001, 'donation', gen_random_uuid(), current_date, 12345, gen_random_uuid(), 'recorded');
  insert into public.finance_bill (id, organization_id, vendor_id, bill_date, due_date, subtotal_cents, gst_cents, qst_cents, paid_cents, status, payable_account_id)
  values (v_bill, v_org, gen_random_uuid(), current_date, current_date + 30, 10000, 0, 0, 0, 'draft', gen_random_uuid());
  set local session_replication_role = origin;
  insert into public.activity_event (organization_id, actor_id, verb, source_type, source_id, summary)
  values (v_org, v_owner, 'created', 'task', gen_random_uuid(), 'dashboard trend check')
  returning id into v_activity;

  -- Gifts follow the ledger: owner and admin with two-step sign-in, and the
  -- external accountant.
  for v_role in select * from (values (v_owner, 'owner'), (v_admin, 'admin'), (v_guest, 'accountant')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.gift where id = v_gift;
    perform tests.ok(n = 1, v_role.name || ' sees gifts for the Finance dashboard');
    reset role;
  end loop;
  for v_role in select * from (values (v_staff, 'staff'), (v_volunteer, 'volunteer'), (v_member, 'member')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.gift where id = v_gift;
    perform tests.ok(n = 0, v_role.name || ' does not see gifts');
    reset role;
  end loop;

  -- Bills follow payables: organization staff (owner, admin, staff) only; the
  -- external accountant, volunteers and members do not see them.
  for v_role in select * from (values (v_owner, 'owner'), (v_admin, 'admin'), (v_staff, 'staff')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.finance_bill where id = v_bill;
    perform tests.ok(n = 1, v_role.name || ' sees bills for the Finance dashboard');
    reset role;
  end loop;
  for v_role in select * from (values (v_guest, 'accountant'), (v_volunteer, 'volunteer'), (v_member, 'member')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.finance_bill where id = v_bill;
    perform tests.ok(n = 0, v_role.name || ' does not see bills');
    reset role;
  end loop;

  -- Owner and admin without two-step sign-in do not see finance either.
  perform tests.authenticate(v_admin, 'aal1');
  select count(*) into n from public.gift where id = v_gift;
  perform tests.ok(n = 0, 'an admin without two-step sign-in does not see gifts');
  reset role;

  -- The activity trend: the owner sees organization activity.
  perform tests.authenticate(v_owner);
  select count(*) into n from public.activity_event where id = v_activity;
  perform tests.ok(n = 1, 'owner sees activity for the trend');
  reset role;

  -- Signed out: refused outright (no grant) or shown nothing; either is a denial.
  perform tests.clear_auth();
  begin
    select count(*) into n from public.gift where id = v_gift;
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.ok(n = 0, 'signed-out: no gifts');
  begin
    select count(*) into n from public.finance_bill where id = v_bill;
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.ok(n = 0, 'signed-out: no bills');
  begin
    select count(*) into n from public.activity_event where id = v_activity;
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.ok(n = 0, 'signed-out: no activity');
  reset role;
end;
$$;

rollback;
