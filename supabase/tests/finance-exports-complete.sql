-- Finance exports and totals that do not stop at 1,000 rows (DATA-003;
-- migration 20261118010000). PostgREST returns at most 1,000 rows per request,
-- so the app now reads two things in one call instead of a capped list:
--   * gift_donor_list_all: the whole donor list as one JSON value, audited
--     exactly once per view or export (paging the audited set-returning
--     gift_donor_list would write one audit row per page);
--   * gift_year_total: the year's count of recorded gifts and the money
--     received, summed in SQL rather than from the first 1,000 gifts on screen.
-- Both refuse anyone who may not read the ledger. Run after qa-users.sql and
-- rls.sql. All mutations are rolled back.
begin;

create function tests.fx_raises(p_sql text, p_pattern text, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  perform tests.ok(v_error is not null and v_error ilike '%' || p_pattern || '%',
    format('%s (%s)', p_msg, coalesce(v_error, 'no error')));
end;
$$;
grant execute on function tests.fx_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_other_org uuid;
  v_ann uuid;
  v_ben uuid;
  v_cleo uuid;
  v_fdn uuid;
  v_bank uuid;
  v_donations uuid;
  v_supplies uuid;
  v_gen uuid;
  v_void uuid;
  v_list jsonb;
  v_rows integer;
  v_audits_before integer;
  v_audits_after integer;
  v_count bigint;
  v_total bigint;
  v_expect_count bigint;
  v_expect_total bigint;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.organization (name, slug) values ('Exports other org', 'exports-other-org')
  returning id into v_other_org;

  insert into public.crm_contact (organization_id, full_name, email)
  values (v_org, 'Export Ann', 'ann@example.com') returning id into v_ann;
  insert into public.crm_contact (organization_id, full_name)
  values (v_org, 'Export Ben') returning id into v_ben;
  insert into public.crm_contact (organization_id, full_name)
  values (v_org, 'Export Cleo') returning id into v_cleo;
  insert into public.crm_organization (organization_id, name, category, owner_id, status)
  values (v_org, 'Export Foundation', 'funder', v_owner, 'inactive') returning id into v_fdn;

  select id into strict v_bank from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_donations from public.ledger_account where organization_id = v_org and code = '4200';
  select id into strict v_supplies from public.ledger_account where organization_id = v_org and code = '5400';
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';

  perform tests.authenticate(v_admin, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2026-01-01');
  perform public.ledger_record_chart_approval(v_org, date '2026-01-02', 'Accountant');
  -- Money received: 250.00 + 100.00 + 75.00 = 425.00 from three donors.
  perform public.gift_record(v_org, jsonb_build_object('gift_type', 'donation', 'crm_contact_id', v_ann,
    'received_on', '2026-03-15', 'amount_cents', 25000, 'fund_id', v_gen,
    'debit_account_id', v_bank, 'credit_account_id', v_donations));
  perform public.gift_record(v_org, jsonb_build_object('gift_type', 'donation', 'crm_organization_id', v_fdn,
    'received_on', '2026-04-01', 'amount_cents', 10000, 'fund_id', v_gen,
    'debit_account_id', v_bank, 'credit_account_id', v_donations));
  perform public.gift_record(v_org, jsonb_build_object('gift_type', 'donation', 'crm_contact_id', v_ben,
    'received_on', '2026-05-01', 'amount_cents', 7500, 'fund_id', v_gen,
    'debit_account_id', v_bank, 'credit_account_id', v_donations));
  -- An in-kind gift with a donor-supplied value counts as a gift, not as money.
  perform public.gift_record(v_org, jsonb_build_object('gift_type', 'in_kind', 'crm_contact_id', v_ann,
    'received_on', '2026-05-02', 'in_kind_description', 'Printer paper', 'amount_cents', 4000,
    'value_supplied_by_donor', true, 'fund_id', v_gen,
    'debit_account_id', v_supplies, 'credit_account_id', v_donations));
  -- A voided gift counts for nothing.
  v_void := public.gift_record(v_org, jsonb_build_object('gift_type', 'donation', 'crm_contact_id', v_cleo,
    'received_on', '2026-05-03', 'amount_cents', 99900, 'fund_id', v_gen,
    'debit_account_id', v_bank, 'credit_account_id', v_donations));
  perform public.gift_void(v_void, date '2026-05-04', 'Entered twice');
  perform tests.clear_auth(); reset role;

  select count(*), coalesce(sum(amount_cents) filter (where gift_type <> 'in_kind'), 0)
  into v_expect_count, v_expect_total
  from public.gift
  where organization_id = v_org and status = 'recorded'
    and received_on between date '2026-01-01' and date '2026-12-31';

  -- ---------------------------------------------------------------------
  -- Who may call them
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.fx_raises(format('select * from public.gift_year_total(%L, 2026)', v_org),
    'do not have access', 'staff who are not ledger readers cannot read the year''s gift total');
  perform tests.fx_raises(format($f$select public.gift_donor_list_all(%L, date '2026-01-01', date '2026-12-31', 'export')$f$, v_org),
    'do not have access', 'staff who are not ledger readers cannot read the whole donor list');
  perform tests.clear_auth(); reset role;

  begin
    set local role anon;
    perform public.gift_year_total(v_org, 2026);
    reset role;
    perform tests.ok(false, 'anon cannot call gift_year_total');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call gift_year_total');
  end;
  begin
    set local role anon;
    perform public.gift_donor_list_all(v_org, date '2026-01-01', date '2026-12-31', 'view');
    reset role;
    perform tests.ok(false, 'anon cannot call gift_donor_list_all');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call gift_donor_list_all');
  end;

  perform tests.authenticate(v_admin, 'aal2');
  insert into public.ledger_reader (organization_id, user_id) values (v_org, v_staff);
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- The year's total is summed in SQL
  -- ---------------------------------------------------------------------
  -- A ledger reader reads donor totals only after MFA (20261122070000).
  perform tests.authenticate(v_staff, 'aal2');
  select t.gift_count, t.total_cents into v_count, v_total from public.gift_year_total(v_org, 2026) t;
  perform tests.ok(v_count = v_expect_count and v_total = v_expect_total,
    format('the year total counts recorded gifts and sums money received (%s gifts, %s; expected %s, %s)',
      v_count, v_total, v_expect_count, v_expect_total));
  perform tests.ok(v_total >= 42500 and v_count >= 4,
    format('the gifts recorded here are in the year total (%s gifts, %s)', v_count, v_total));
  perform tests.fx_raises(format('select * from public.gift_year_total(%L, 2026)', v_other_org),
    'do not have access', 'a reader cannot read another organization''s gift total');
  perform tests.fx_raises(format('select * from public.gift_year_total(%L, 1800)', v_org),
    'Choose a year', 'the year must be a real one');

  -- ---------------------------------------------------------------------
  -- The whole donor list in one call, audited once
  -- ---------------------------------------------------------------------
  perform tests.clear_auth(); reset role;
  select count(*) into v_audits_before from public.audit_event
  where organization_id = v_org and action = 'donor_list_exported' and actor_id = v_staff;

  -- A ledger reader reads donor totals only after MFA (20261122070000).
  perform tests.authenticate(v_staff, 'aal2');
  v_list := public.gift_donor_list_all(v_org, date '2026-01-01', date '2026-12-31', 'export');
  select count(*) into v_rows from public.gift_donor_list(v_org, date '2026-01-01', date '2026-12-31', 'view');
  perform tests.ok(jsonb_typeof(v_list) = 'array' and jsonb_array_length(v_list) = v_rows,
    format('the whole donor list comes back as one JSON array (%s of %s donors)', jsonb_array_length(v_list), v_rows));
  perform tests.ok(exists (
      select 1 from jsonb_array_elements(v_list) d
      where d ->> 'donor_name' = 'Export Ann' and (d ->> 'total_cents')::bigint = 25000
        and (d ->> 'gift_count')::int = 2 and (d ->> 'in_kind_count')::int = 1
        and d ->> 'donor_kind' = 'contact' and d ->> 'donor_email' = 'ann@example.com'),
    'each donor carries the same figures as gift_donor_list');
  perform tests.ok(not exists (
      select 1 from jsonb_array_elements(v_list) d where d ->> 'donor_name' = 'Export Cleo'),
    'a donor whose only gift was voided is not listed');
  perform tests.ok(coalesce((
      select bool_and(s.prev <= s.name) from (
        select x.d ->> 'donor_name' as name, lag(x.d ->> 'donor_name') over (order by x.i) as prev
        from jsonb_array_elements(v_list) with ordinality as x(d, i)) s
      where s.prev is not null), true),
    'donors are in name order');
  perform tests.fx_raises(format($f$select public.gift_donor_list_all(%L, date '2026-01-01', date '2026-12-31', 'export')$f$, v_other_org),
    'do not have access', 'a reader cannot list another organization''s donors');
  perform tests.fx_raises(format($f$select public.gift_donor_list_all(%L, date '2026-01-01', date '2026-12-31', 'peek')$f$, v_org),
    'Purpose must be', 'the purpose must be view or export');
  perform tests.clear_auth(); reset role;

  select count(*) into v_audits_after from public.audit_event
  where organization_id = v_org and action = 'donor_list_exported' and actor_id = v_staff;
  perform tests.ok(v_audits_after = v_audits_before + 1,
    format('one export writes exactly one audit record (%s new)', v_audits_after - v_audits_before));
end
$$;

rollback;
