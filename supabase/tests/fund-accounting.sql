-- Statement of changes in fund balances and releases of restricted money
-- (#149; migration 20261001200000). Proves: the statement's closing balance
-- for every fund equals ledger_fund_balances, the funds together equal the
-- ledger's net assets, and each row adds up; only an owner or admin with MFA
-- releases, only from a restricted fund to an unrestricted one, never more
-- than the fund's available balance and never into a closed period; a
-- release is one balanced entry posted with the condition in its memo.
-- Ledger readers see the statement and the releases; others see nothing.
-- All mutations are rolled back.
begin;

create function tests.fa_raises(p_sql text, p_pattern text, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
    set constraints all immediate;
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  set constraints all deferred;
  perform tests.ok(v_error is not null and v_error ilike '%' || p_pattern || '%',
    format('%s (%s)', p_msg, coalesce(v_error, 'no error')));
end;
$$;
grant execute on function tests.fa_raises(text, text, text) to authenticated, anon;

-- Interfund accounts reach existing organizations and new ones.
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_other_org uuid;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.organization (name, slug) values ('Fund accounting other org', 'fund-accounting-other-org')
  returning id into v_other_org;
  perform tests.ok(exists (select 1 from public.ledger_account where organization_id = v_other_org
    and code = '1900' and account_type = 'asset'), 'a new organization gets 1900 Due from other funds');
  perform tests.ok(exists (select 1 from public.ledger_account where organization_id = v_org
    and code = '2900' and account_type = 'liability'), 'existing organizations get 2900 Due to other funds');
end
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_other_org uuid;
  v_other_fund uuid;
  v_bank uuid;
  v_donations uuid;
  v_grant_rev uuid;
  v_rent uuid;
  v_gen uuid;
  v_grant uuid;
  v_board uuid;
  v_entry uuid;
  v_release uuid;
  v_release2 uuid;
  v_period uuid;
  v_rows integer;
  v_sum bigint;
  v_sum2 bigint;
  v_row record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  select id into strict v_other_org from public.organization where slug = 'fund-accounting-other-org';
  select id into strict v_other_fund from public.ledger_fund where organization_id = v_other_org and code = 'GEN';

  select id into strict v_bank from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_donations from public.ledger_account where organization_id = v_org and code = '4200';
  select id into strict v_grant_rev from public.ledger_account where organization_id = v_org and code = '4010';
  select id into strict v_rent from public.ledger_account where organization_id = v_org and code = '5200';
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';

  insert into public.ledger_fund (organization_id, code, name, restriction, funder, starts_on, ends_on)
  values (v_org, 'FA-GRANT', 'Fund accounting test grant', 'externally_restricted', 'Test funder',
          date '2025-10-01', date '2026-09-30')
  returning id into v_grant;
  insert into public.ledger_fund (organization_id, code, name, restriction)
  values (v_org, 'FA-BOARD', 'Board reserve', 'internally_restricted')
  returning id into v_board;

  -- A year of activity, as the owner with MFA.
  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_record_chart_approval(v_org, date '2025-09-01', 'Fund Accountant, CPA');
  perform public.ledger_create_fiscal_year(v_org, date '2025-10-01');
  perform public.ledger_create_fiscal_year(v_org, date '2026-10-01');
  v_entry := public.ledger_save_draft(v_org, null, date '2025-11-15', 'Donation', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'debit_cents', 100000),
    jsonb_build_object('account_id', v_donations, 'fund_id', v_gen, 'credit_cents', 100000)));
  perform public.ledger_post_entry(v_entry);
  v_entry := public.ledger_save_draft(v_org, null, date '2025-12-01', 'Rent', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 30000),
    jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 30000)));
  perform public.ledger_post_entry(v_entry);
  v_entry := public.ledger_save_draft(v_org, null, date '2026-01-10', 'Grant received', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_bank, 'fund_id', v_grant, 'debit_cents', 50000),
    jsonb_build_object('account_id', v_grant_rev, 'fund_id', v_grant, 'credit_cents', 50000)));
  perform public.ledger_post_entry(v_entry);
  v_entry := public.ledger_save_draft(v_org, null, date '2026-02-01', 'Board reserve donation', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_bank, 'fund_id', v_board, 'debit_cents', 10000),
    jsonb_build_object('account_id', v_donations, 'fund_id', v_board, 'credit_cents', 10000)));
  perform public.ledger_post_entry(v_entry);
  v_entry := public.ledger_save_draft(v_org, null, date '2026-03-01', 'Grant rent', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_rent, 'fund_id', v_grant, 'debit_cents', 20000),
    jsonb_build_object('account_id', v_bank, 'fund_id', v_grant, 'credit_cents', 20000)));
  perform public.ledger_post_entry(v_entry);
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Who may release
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 1000, date ''2026-03-15'', ''Report accepted'')',
    v_org, v_grant, v_gen), 'administrator', 'staff cannot release restricted money');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 1000, date ''2026-03-15'', ''Report accepted'')',
    v_org, v_grant, v_gen), 'administrator', 'an owner without MFA cannot release restricted money');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- What is refused
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(public.ledger_fund_available_cents(v_grant, date '2026-03-15') = 30000,
    'the grant has 300.00 available after spending 200.00 of 500.00');
  perform tests.ok(public.ledger_fund_available_cents(v_grant, date '2026-02-01') = 30000,
    'a back-dated release sees the lowest later balance, not the balance on the day');

  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 1000, date ''2026-03-15'', ''Report accepted'')',
    v_org, v_gen, v_grant), 'unrestricted', 'an unrestricted fund cannot be released');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 1000, date ''2026-03-15'', ''Report accepted'')',
    v_org, v_grant, v_board), 'goes to an unrestricted fund', 'released money cannot go to a restricted fund');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 30001, date ''2026-03-15'', ''Report accepted'')',
    v_org, v_grant, v_gen), 'only 300.00 available', 'more than the available balance is refused');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 40000, date ''2026-02-01'', ''Report accepted'')',
    v_org, v_grant, v_gen), 'only 300.00 available',
    'a back-dated release cannot take a later balance below zero');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 0, date ''2026-03-15'', ''Report accepted'')',
    v_org, v_grant, v_gen), 'more than zero', 'a zero release is refused');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 1000, date ''2026-03-15'', ''  '')',
    v_org, v_grant, v_gen), 'condition', 'a release names the condition met');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 1000, date ''2026-03-15'', ''Report accepted'')',
    v_org, v_grant, v_other_fund), 'not found', 'money cannot be released into another organization''s fund');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 1000, date ''2031-01-15'', ''Report accepted'')',
    v_org, v_grant, v_gen), 'No fiscal period', 'a release needs a fiscal period');

  select id into strict v_period from public.ledger_period where organization_id = v_org and starts_on = date '2026-04-01';
  perform public.ledger_set_period_status(v_period, 'closed');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 1000, date ''2026-04-10'', ''Report accepted'')',
    v_org, v_grant, v_gen), 'closed', 'a release cannot be dated in a closed period');
  perform public.ledger_set_period_status(v_period, 'open');

  perform tests.fa_raises(format(
    'insert into public.ledger_fund_release (organization_id, from_fund_id, to_fund_id, amount_cents, release_date, condition, entry_id) values (%L, %L, %L, 100, date ''2026-03-15'', ''x'', %L)',
    v_org, v_grant, v_gen, v_entry), 'permission denied', 'releases are not written directly, even by the owner');
  select count(*) into v_rows from public.journal_entry where organization_id = v_org and source_type = 'fund_release';
  perform tests.ok(v_rows = 0, 'no refused release left an entry behind');

  -- ---------------------------------------------------------------------
  -- A release
  -- ---------------------------------------------------------------------
  v_release := public.ledger_release_restricted(v_org, v_grant, v_gen, 12000, date '2026-03-15',
    'Funder accepted the interim report');
  select entry_id into strict v_entry from public.ledger_fund_release where id = v_release;
  perform tests.ok((select status = 'posted' and entry_number is not null and kind = 'standard'
      and source_type = 'fund_release' and source_id = v_release and entry_date = date '2026-03-15'
      and memo like 'Release from restricted fund FA-GRANT to GEN%'
      and memo like '%Condition met: Funder accepted the interim report'
    from public.journal_entry where id = v_entry), 'the release is posted with the condition in its memo');
  select count(*), sum(debit_cents), sum(credit_cents) into v_rows, v_sum, v_sum2
  from public.journal_line where entry_id = v_entry;
  perform tests.ok(v_rows = 4 and v_sum = 24000 and v_sum2 = 24000, 'the release entry balances (two lines a side)');
  perform tests.ok(not exists (select 1 from public.journal_line where entry_id = v_entry
    group by fund_id having sum(debit_cents) <> sum(credit_cents)), 'the release balances within each fund');
  perform tests.ok(exists (select 1 from public.journal_line l join public.ledger_account a on a.id = l.account_id
    where l.entry_id = v_entry and l.fund_id = v_grant and a.code = '3200' and l.debit_cents = 12000),
    'an externally restricted fund releases from 3200');

  select fund_balance_cents into v_sum from public.ledger_fund_balances(v_org, date '2026-09-30') where fund_id = v_grant;
  perform tests.ok(v_sum = 18000, format('the grant keeps 180.00 (%s)', v_sum));
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 18001, date ''2026-03-20'', ''Final report accepted'')',
    v_org, v_grant, v_gen), 'only 180.00 available', 'the available balance falls with each release');

  v_release2 := public.ledger_release_restricted(v_org, v_board, v_gen, 5000, date '2026-03-20',
    'Board resolution 2026-03');
  perform tests.ok(exists (select 1 from public.ledger_fund_release r
    join public.journal_line l on l.entry_id = r.entry_id
    join public.ledger_account a on a.id = l.account_id
    where r.id = v_release2 and l.fund_id = v_board and a.code = '3100' and l.debit_cents = 5000),
    'an internally restricted fund releases from 3100');
  perform tests.clear_auth(); reset role;

  perform tests.ok(exists (select 1 from public.ledger_fund_release where id = v_release
    and released_by = v_owner and amount_cents = 12000 and condition = 'Funder accepted the interim report'),
    'the release and who made it are recorded');
  select count(*) into v_rows from public.audit_event
  where organization_id = v_org and event_type = 'ledger' and action = 'restricted_released';
  perform tests.ok(v_rows = 2, format('each release is audited (%s)', v_rows));

  -- ---------------------------------------------------------------------
  -- Statement of changes in fund balances
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  select * into strict v_row from public.ledger_fund_changes(v_org, date '2025-10-01', date '2026-09-30')
  where fund_id = v_gen;
  perform tests.ok(v_row.opening_cents = 0 and v_row.revenue_cents = 100000 and v_row.expenses_cents = 30000
    and v_row.transfers_cents = 17000 and v_row.closing_cents = 87000,
    format('the general fund: 0 + 1000.00 - 300.00 + 170.00 released = 870.00 (%s)', row_to_json(v_row)));
  select * into strict v_row from public.ledger_fund_changes(v_org, date '2025-10-01', date '2026-09-30')
  where fund_id = v_grant;
  perform tests.ok(v_row.revenue_cents = 50000 and v_row.expenses_cents = 20000
    and v_row.transfers_cents = -12000 and v_row.closing_cents = 18000,
    format('the grant: 500.00 - 200.00 - 120.00 released = 180.00 (%s)', row_to_json(v_row)));

  select count(*) into v_rows
  from public.ledger_fund_changes(v_org, date '2025-10-01', date '2026-09-30') c
  where c.closing_cents <> c.opening_cents + c.revenue_cents - c.expenses_cents + c.transfers_cents;
  perform tests.ok(v_rows = 0, 'every fund''s row adds up');

  select count(*) into v_rows
  from public.ledger_fund_changes(v_org, date '2025-10-01', date '2026-09-30') c
  full join public.ledger_fund_balances(v_org, date '2026-09-30') b on b.fund_id = c.fund_id
  where c.closing_cents is distinct from b.fund_balance_cents;
  perform tests.ok(v_rows = 0, 'closing balances equal the fund balances already reported');

  select sum(closing_cents), sum(transfers_cents) into v_sum, v_sum2
  from public.ledger_fund_changes(v_org, date '2025-10-01', date '2026-09-30');
  perform tests.ok(v_sum2 = 0, 'transfers between funds add up to zero');
  perform tests.ok(v_sum = (select sum(-balance_cents) from public.ledger_trial_balance(v_org, date '2026-09-30')
                            where account_type in ('net_assets', 'revenue', 'expense')),
    format('the funds together equal the ledger''s net assets (%s)', v_sum));
  perform tests.ok(v_sum = (select sum(balance_cents) from public.ledger_trial_balance(v_org, date '2026-09-30')
                            where account_type in ('asset', 'liability')),
    'the funds together equal the ledger''s assets less liabilities');
  perform tests.clear_auth(); reset role;

  -- Closing the year leaves the statement unchanged, and the next year opens
  -- where this one closed. A release cannot be dated in the closed year.
  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_close_fiscal_year(v_org, date '2025-10-01');
  select * into strict v_row from public.ledger_fund_changes(v_org, date '2025-10-01', date '2026-09-30')
  where fund_id = v_gen;
  perform tests.ok(v_row.revenue_cents = 100000 and v_row.expenses_cents = 30000
    and v_row.transfers_cents = 17000 and v_row.closing_cents = 87000,
    format('the closing entry is left out of the year''s changes (%s)', row_to_json(v_row)));
  select opening_cents into v_sum from public.ledger_fund_changes(v_org, date '2026-10-01', date '2027-09-30')
  where fund_id = v_grant;
  perform tests.ok(v_sum = 18000, format('the next year opens with the closing balance (%s)', v_sum));
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 1000, date ''2026-06-01'', ''Report accepted'')',
    v_org, v_grant, v_gen), 'closed', 'a release cannot be dated in a closed fiscal year');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Who reads
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.ledger_fund_changes(v_org, date '2025-10-01', date '2026-09-30');
  perform tests.ok(v_rows = 0, 'staff who are not ledger readers see no statement');
  select count(*) into v_rows from public.ledger_fund_release;
  perform tests.ok(v_rows = 0, 'staff who are not ledger readers see no releases');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  insert into public.ledger_reader (organization_id, user_id) values (v_org, v_staff);
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_staff, 'aal1');
  select sum(closing_cents) into v_sum from public.ledger_fund_changes(v_org, date '2025-10-01', date '2026-09-30')
  where fund_id in (v_gen, v_grant, v_board);
  perform tests.ok(v_sum = 87000 + 18000 + 5000, format('a ledger reader reads the statement (%s)', v_sum));
  select count(*) into v_rows from public.ledger_fund_release where organization_id = v_org;
  perform tests.ok(v_rows = 2, 'a ledger reader reads the releases');
  perform tests.fa_raises(format(
    'select public.ledger_release_restricted(%L, %L, %L, 1000, date ''2026-10-15'', ''Report accepted'')',
    v_org, v_grant, v_gen), 'administrator', 'a ledger reader cannot release');
  select count(*) into v_rows from public.ledger_fund_changes(v_other_org, date '2025-10-01', date '2026-09-30');
  perform tests.ok(v_rows = 0, 'a reader sees nothing of another organization');
  perform tests.clear_auth(); reset role;

  begin
    set local role anon;
    perform public.ledger_fund_changes(v_org, date '2025-10-01', date '2026-09-30');
    reset role;
    perform tests.ok(false, 'anon cannot call the statement of changes in fund balances');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call the statement of changes in fund balances');
  end;
  begin
    set local role anon;
    perform public.ledger_release_restricted(v_org, v_grant, v_gen, 100, date '2026-10-15', 'x');
    reset role;
    perform tests.ok(false, 'anon cannot release');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot release');
  end;
end
$$;

rollback;
