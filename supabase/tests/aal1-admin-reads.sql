-- An owner or administrator who signed in with a password only (no second
-- factor yet) reads no more than a staff member; with MFA they read the
-- organization. Staff named as ledger readers read payroll and gifts only
-- with MFA, like the outside accountant.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  org uuid;
  r record;
  staff_n int;
  admin_n int;
  admin2_n int;
  n int;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  perform tests.ensure_verified_mfa_factor(admin_user);
  perform tests.ensure_verified_mfa_factor(staff_user);
  -- Something of each kind outside staff's reach.
  insert into public.project (organization_id, name, owner_id, created_by)
  values (org, 'AAR project', owner_user, owner_user);
  insert into public.task (organization_id, project_id, title, created_by)
  select org, id, 'AAR task', owner_user from public.project where name = 'AAR project';
  insert into public.meeting (organization_id, title, starts_at, organizer_id, project_id)
  select org, 'AAR meeting', now(), owner_user, id from public.project where name = 'AAR project';
  insert into public.event (organization_id, name, starts_at, project_id, created_by)
  select org, 'AAR event', now(), id, owner_user from public.project where name = 'AAR project';
  insert into public.gift (organization_id, gift_number, gift_type, crm_contact_id, received_on, amount_cents, fund_id, created_by)
  select org, 990101, 'donation', c.id, current_date, 500,
         (select id from public.ledger_fund where organization_id = org and code = 'GEN'), owner_user
  from public.crm_contact c where c.organization_id = org limit 1;
  insert into public.ledger_reader (organization_id, user_id, granted_by)
  values (org, staff_user, owner_user)
  on conflict do nothing;

  for r in select * from (values ('project'), ('program'), ('task'), ('meeting'), ('event'), ('report_instance'), ('object')) as t(tbl) loop
    perform tests.authenticate(staff_user, 'aal1');
    set local role authenticated;
    execute format('select count(*) from public.%I', r.tbl) into staff_n;
    reset role;
    perform tests.authenticate(admin_user, 'aal1');
    set local role authenticated;
    execute format('select count(*) from public.%I', r.tbl) into admin_n;
    reset role;
    perform tests.authenticate(admin_user, 'aal2');
    set local role authenticated;
    execute format('select count(*) from public.%I', r.tbl) into admin2_n;
    reset role;
    perform tests.ok(admin_n <= staff_n,
      format('an administrator without MFA reads no more %s rows than staff (%s vs %s)', r.tbl, admin_n, staff_n));
    perform tests.ok(admin2_n >= staff_n, format('an administrator with MFA still reads every %s row staff do', r.tbl));
  end loop;

  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  select count(*) into n from public.task where title = 'AAR task';
  reset role;
  perform tests.ok(n = 1, 'an administrator with MFA reads a task on a project they are not on');

  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  select count(*) into n from public.gift where gift_number = 990101;
  reset role;
  perform tests.ok(n = 0, 'a ledger reader without MFA reads no gifts');
  perform tests.authenticate(staff_user, 'aal2');
  set local role authenticated;
  select count(*) into n from public.gift where gift_number = 990101;
  reset role;
  perform tests.ok(n = 1, 'a ledger reader with MFA reads gifts');
  -- Admin tables need MFA too.
  reset role;
  insert into public.background_job_run (organization_id, job_name, status) values (org, 'aar_test', 'succeeded');
  perform tests.authenticate(admin_user, 'aal1');
  set local role authenticated;
  select count(*) into n from public.background_job_run where job_name = 'aar_test';
  reset role;
  perform tests.ok(n = 0, 'an administrator without MFA reads no background job runs');

  -- An MFA session whose authenticator has since been removed has no
  -- organization-wide reach.
  -- Claims set by hand: tests.authenticate would add a factor back.
  delete from auth.mfa_factors where user_id = admin_user;
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
  select count(*) into n from public.event where name = 'AAR event';
  select count(*) into admin_n from public.task where title = 'AAR task';
  reset role;
  perform tests.ok(n = 0 and admin_n = 0,
    'an administrator whose authenticator was removed reads no organization-wide events or tasks');
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
