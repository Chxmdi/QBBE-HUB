-- The ledger read policies, now set-based, let every caller read exactly what
-- app.can_read_ledger allows, on every ledger table. Run after qa-users.sql
-- and rls.sql. Rolled back.
--
-- Both the old policy, app.can_read_ledger(organization_id), and the new
-- one, organization_id in (select app.ledger_readable_org_ids()), depend on
-- a row only through its organization. So the proof is in two parts: for
-- every caller, in every state a grant can be in, and every organization
-- (and none), the two answers agree; and on the rows that exist (seed plus a
-- second organization) every caller sees the same rows of all 27 tables
-- before and after.
begin;

-- Callers: user:assurance. "aal2nofactor" is an aal2 claim with no verified
-- authenticator behind it, which is not MFA.
create function tests.ledger_callers() returns text[]
language sql as $$
  select array[
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1:aal2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1:aal1',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1:aal2nofactor',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2:aal2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2:aal1',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2:aal2nofactor',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3:aal2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4:aal2',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4:aal1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4:aal2nofactor',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5:aal2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5:aal1',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5:aal2nofactor',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6:aal2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7:aal2',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8:aal2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9:aal2'];
$$;

create function tests.ledger_sign_in(p_caller text) returns void
language plpgsql as $$
declare
  v_user uuid := split_part(p_caller, ':', 1)::uuid;
  v_level text := split_part(p_caller, ':', 2);
begin
  if v_level = 'aal2nofactor' then
    delete from auth.mfa_factors where user_id = v_user;
    perform tests.authenticate(v_user, 'aal1');
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user, 'role', 'authenticated', 'email', '', 'aal', 'aal2')::text, true);
  else
    perform tests.authenticate(v_user, v_level);
  end if;
end;
$$;

-- Where the two rules disagree, for every caller and organization ('' when nowhere).
create function tests.ledger_rule_mismatches(p_state text) returns text
language plpgsql as $$
declare
  v_caller text;
  v_orgs uuid[];
  v_o uuid;
  v_old boolean;
  v_new boolean;
  v_out text := '';
begin
  select array_agg(id) || array[null::uuid] into v_orgs from organization;
  foreach v_caller in array tests.ledger_callers() loop
    perform tests.ledger_sign_in(v_caller);
    foreach v_o in array v_orgs loop
      v_old := coalesce(app.can_read_ledger(v_o), false);
      v_new := coalesce(v_o in (select app.ledger_readable_org_ids()), false);
      if v_old is distinct from v_new then
        v_out := v_out || format('%s, %s on %s: was %s, now %s; ', p_state, v_caller, coalesce(v_o::text, 'none'), v_old, v_new);
      end if;
    end loop;
    perform tests.clear_auth();
    reset role;
  end loop;
  return v_out;
end;
$$;

create function tests.ledger_visible_rows(p_tables text[]) returns text[]
language plpgsql as $$
declare
  v_caller text;
  v_table text;
  v_rows text;
  v_out text[] := '{}';
begin
  foreach v_caller in array tests.ledger_callers() loop
    perform tests.ledger_sign_in(v_caller);
    foreach v_table in array p_tables loop
      execute format('select coalesce(string_agg(md5(to_jsonb(t)::text), '','' order by md5(to_jsonb(t)::text)), '''') from public.%I t',
        v_table) into v_rows;
      v_out := v_out || (v_caller || '|' || v_table || '|' || v_rows);
    end loop;
    perform tests.clear_auth();
    reset role;
  end loop;
  return v_out;
end;
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_tables text[];
  v_org uuid;
  v_other_org uuid;
  v_mismatch text := '';
  v_before text[];
  v_after text[];
  v_seen integer;
  v_table_index integer;
  n integer;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;
  -- A second organization (it gets its chart of accounts at once), which the
  -- owner also owns, so the owner's readable set holds two organizations.
  insert into organization (name, slug) values ('Zzledger Other Org', 'zzledger-other-' || txid_current())
    returning id into v_other_org;
  insert into organization_membership (organization_id, user_id, role, status)
    values (v_other_org, v_owner, 'owner', 'active');

  -- A ledger reader (staff) and an outside accountant (guest), as granted in the app.
  insert into ledger_reader (organization_id, user_id) values (v_org, v_staff);
  insert into ledger_accountant_grant (organization_id, user_id, starts_at, expires_at)
    values (v_org, v_guest, now() - interval '1 minute', now() + interval '30 days');
  -- The same two named in the second organization, where they are not
  -- members. The app refuses such rows; they are written past its checks to
  -- show they would still grant nothing.
  set local session_replication_role = replica;
  insert into ledger_reader (organization_id, user_id) values (v_other_org, v_staff);
  insert into ledger_accountant_grant (organization_id, user_id, starts_at, expires_at)
    values (v_other_org, v_guest, now() - interval '1 minute', now() + interval '30 days');
  set local session_replication_role = origin;

  select array_agg(tablename::text order by tablename) into v_tables
  from pg_policies where schemaname = 'public' and cmd = 'SELECT'
    and qual like '%ledger_readable_org_ids%';
  perform tests.ok(coalesce(cardinality(v_tables), 0) = 27,
    format('ledger reads: all 27 ledger read policies are set-based (%s found)', coalesce(cardinality(v_tables), 0)));
  perform tests.ok(not exists (
    select 1 from pg_policies where schemaname = 'public' and qual like '%can_read_ledger(organization_id)%'),
    'ledger reads: no policy calls app.can_read_ledger once per row any more');

  -- Part 1: for every caller, grant state and organization, the two rules agree.
  -- The API roles cannot name the app schema (policies use its functions
  -- without that); this transaction lets them, to ask both rules directly.
  grant usage on schema app to authenticated;

  perform tests.authenticate(v_owner, 'aal2');
  select count(*) into n from app.ledger_readable_org_ids();
  perform tests.clear_auth();
  reset role;
  perform tests.ok(n = 2, 'ledger reads: an owner with MFA of two organizations reads both');

  -- The set-based rule takes the caller's memberships as the only
  -- candidates. This fails if app.can_read_ledger ever lets a non-member
  -- read, which would need the policies rethought.
  perform tests.authenticate(v_staff, 'aal2');
  perform tests.ok(not coalesce(app.can_read_ledger(v_other_org), false),
    'ledger reads: a ledger reader of an organization they are not a member of reads nothing there');
  perform tests.clear_auth();
  reset role;
  perform tests.authenticate(v_guest, 'aal2');
  perform tests.ok(not coalesce(app.can_read_ledger(v_other_org), false),
    'ledger reads: an accountant granted access to an organization they are not a member of reads nothing there');
  perform tests.clear_auth();
  reset role;

  v_mismatch := v_mismatch || tests.ledger_rule_mismatches('grants current');
  update organization_membership set status = 'deactivated' where user_id = v_staff and organization_id = v_org;
  update organization_membership set status = 'invited' where user_id = v_guest and organization_id = v_org;
  v_mismatch := v_mismatch || tests.ledger_rule_mismatches('reader deactivated, accountant only invited');
  update organization_membership set status = 'active' where user_id in (v_staff, v_guest) and organization_id = v_org;
  update ledger_accountant_grant set expires_at = now() - interval '1 second' where user_id = v_guest and organization_id = v_org;
  v_mismatch := v_mismatch || tests.ledger_rule_mismatches('accountant grant expired');
  update ledger_accountant_grant set starts_at = now() + interval '1 day', expires_at = now() + interval '30 days'
    where user_id = v_guest and organization_id = v_org;
  v_mismatch := v_mismatch || tests.ledger_rule_mismatches('accountant grant not started');
  update ledger_accountant_grant set starts_at = now() - interval '1 minute', revoked_at = now()
    where user_id = v_guest and organization_id = v_org;
  v_mismatch := v_mismatch || tests.ledger_rule_mismatches('accountant grant revoked');
  update ledger_accountant_grant set revoked_at = null where user_id = v_guest and organization_id = v_org;
  perform tests.ok(v_mismatch = '',
    'ledger reads: every caller, in every grant state, may read exactly the organizations app.can_read_ledger allows; '
    || coalesce(nullif(v_mismatch, ''), 'no difference'));
  revoke usage on schema app from authenticated;

  -- Part 2: the rows each caller sees, now and with the old policies back.
  v_after := tests.ledger_visible_rows(v_tables);
  for v_table_index in 1 .. cardinality(v_tables) loop
    execute format('drop policy %I on public.%I',
      (select policyname from pg_policies where schemaname = 'public' and tablename = v_tables[v_table_index]
         and qual like '%ledger_readable_org_ids%'),
      v_tables[v_table_index]);
    execute format('create policy zz_old_ledger_read on public.%I for select to authenticated using (app.can_read_ledger(organization_id))',
      v_tables[v_table_index]);
  end loop;
  v_before := tests.ledger_visible_rows(v_tables);

  select count(*) into v_seen from unnest(v_after) a where a !~ '\|$';
  perform tests.ok(v_seen > 0 and exists (select 1 from unnest(v_after) a where a ~ '\|$'),
    format('ledger reads: some callers see rows and some see none (%s non-empty table views)', v_seen));
  perform tests.ok(v_after = v_before,
    'ledger reads: every caller sees the same rows of every ledger table as before; '
    || coalesce((select string_agg(split_part(a, '|', 1) || ' ' || split_part(a, '|', 2), ', ') from (
         select a from unnest(v_after) a except select b from unnest(v_before) b limit 5) d), 'no difference'));
end;
$$;

-- The many-fund available balance gives what the one-fund call gives.
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_other_org uuid;
  v_fund uuid;
  v_other_fund uuid;
  v_cash uuid;
  v_revenue uuid;
  v_expense uuid;
  v_entry uuid;
  v_day date;
  v_bad text := '';
  v_one bigint;
  v_many bigint;
begin
  perform tests.ok(
    not has_function_privilege('anon', 'app.ledger_readable_org_ids()', 'execute')
      and not exists (select 1 from information_schema.routine_privileges
        where routine_schema = 'app' and routine_name = 'ledger_readable_org_ids' and grantee = 'PUBLIC')
      and not has_function_privilege('anon', 'public.ledger_funds_available_cents(uuid[], date)', 'execute'),
    'ledger reads: signed-out visitors cannot call the new helpers');

  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;
  select id into strict v_fund from ledger_fund where organization_id = v_org order by code limit 1;
  select id into strict v_cash from ledger_account where organization_id = v_org and account_type = 'asset' order by code limit 1;
  select id into strict v_revenue from ledger_account where organization_id = v_org and account_type = 'revenue' order by code limit 1;
  select id into strict v_expense from ledger_account where organization_id = v_org and account_type = 'expense' order by code limit 1;
  insert into organization (name, slug) values ('Zzfunds Other Org', 'zzfunds-other-' || txid_current())
    returning id into v_other_org;
  select id into strict v_other_fund from ledger_fund where organization_id = v_other_org limit 1;

  -- Posted entries on the fund (fixture rows, written past the posting
  -- checks): 1,000 received on day 1, 300 spent on day 3, 200 received on day 5.
  set local session_replication_role = replica;
  for v_day, v_one, v_many in values (date '2001-03-01', 1000::bigint, 0::bigint), (date '2001-03-03', 0, 300), (date '2001-03-05', 200, 0) loop
    insert into journal_entry (organization_id, entry_date, memo, status, entry_number, posted_at)
      values (v_org, v_day, 'zzfunds', 'posted', 900000 + extract(day from v_day)::int, now()) returning id into v_entry;
    if v_one > 0 then
      insert into journal_line (organization_id, entry_id, line_no, account_id, fund_id, debit_cents, credit_cents)
        values (v_org, v_entry, 1, v_cash, v_fund, v_one, 0), (v_org, v_entry, 2, v_revenue, v_fund, 0, v_one);
    else
      insert into journal_line (organization_id, entry_id, line_no, account_id, fund_id, debit_cents, credit_cents)
        values (v_org, v_entry, 1, v_expense, v_fund, v_many, 0), (v_org, v_entry, 2, v_cash, v_fund, 0, v_many);
    end if;
  end loop;
  set local session_replication_role = origin;

  perform tests.authenticate(v_owner, 'aal2');
  foreach v_day in array array[date '2001-02-28', date '2001-03-01', date '2001-03-02', date '2001-03-03',
                               date '2001-03-04', date '2001-03-05', date '2001-03-06'] loop
    v_one := public.ledger_fund_available_cents(v_fund, v_day);
    select available_cents into v_many from public.ledger_funds_available_cents(array[v_fund, v_other_fund], v_day)
      where fund_id = v_fund;
    if v_one is distinct from v_many then
      v_bad := v_bad || format('%s: one %s, many %s; ', v_day, v_one, v_many);
    end if;
  end loop;
  perform tests.ok(v_bad = '' and public.ledger_fund_available_cents(v_fund, date '2001-03-02') = 700,
    'funds available: one call for many funds gives what the one-fund call gives, date by date; ' || coalesce(nullif(v_bad, ''), 'no difference'));
  perform tests.ok((select count(*) from public.ledger_funds_available_cents(array[v_fund, v_other_fund], current_date)) = 1,
    'funds available: a fund of an organization the caller cannot read gives no row');
  perform tests.clear_auth();
  reset role;

  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'aal2');
  perform tests.ok((select count(*) from public.ledger_funds_available_cents(array[v_fund], current_date)) = 0,
    'funds available: a volunteer learns nothing about a fund');
  perform tests.clear_auth();
  reset role;
end;
$$;

rollback;
