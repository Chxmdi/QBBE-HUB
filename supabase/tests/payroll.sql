-- Payroll import (#155; migration 20260929900000). Proves that only admins
-- with MFA import, map, allocate, post, reverse and delete; that ledger
-- readers see runs but cannot change them and everyone else sees nothing;
-- that tables refuse direct writes; that importing the same run twice adds
-- nothing; that a run whose totals do not add up, an incomplete mapping and a
-- closed period are refused; and that a posted run is one balanced entry,
-- balanced within each fund, whose figures add back to the run's totals.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

-- Runs a statement as the current role and asserts that it fails with a
-- message containing p_pattern.
create function tests.payroll_raises(p_sql text, p_pattern text, p_msg text)
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
grant execute on function tests.payroll_raises(text, text, text) to authenticated, anon;

-- One run's totals as the app sends them. Gross 10,000.00; employee
-- deductions 2,650.00; net 7,350.00; employer contributions 1,234.56.
create function tests.payroll_run_json(p_pay date, p_start date, p_end date, p_reference text default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'run_reference', p_reference,
    'pay_date', p_pay, 'period_start', p_start, 'period_end', p_end,
    'gross_wages_cents', 1000000,
    'ee_federal_tax_cents', 90000, 'ee_quebec_tax_cents', 110000, 'ee_qpp_cents', 40000,
    'ee_ei_cents', 13000, 'ee_qpip_cents', 5000, 'ee_other_cents', 7000,
    'er_qpp_cents', 40000, 'er_ei_cents', 18200, 'er_qpip_cents', 7000, 'er_fss_cents', 42600,
    'er_cnesst_cents', 12000, 'er_cnt_cents', 656, 'er_other_cents', 3000,
    'net_pay_cents', 735000);
$$;
grant execute on function tests.payroll_run_json(date, date, date, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_other_org uuid;
  v_program uuid;
  v_gen uuid;
  v_grant uuid;
  v_other_fund uuid;
  v_payable uuid;
  v_wages uuid;
  v_bank uuid;
  v_other_bank uuid;
  v_result jsonb;
  v_run uuid;
  v_run2 uuid;
  v_closed_run uuid;
  v_entry uuid;
  v_number integer;
  v_rows integer;
  v_debits bigint;
  v_credits bigint;
  v_sum bigint;
  v_flag boolean;
  v_runs jsonb;
  v_one jsonb := jsonb_build_array(tests.payroll_run_json(date '2026-10-16', date '2026-10-01', date '2026-10-14', 'R-101'));
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.organization (name, slug) values ('Payroll other org', 'payroll-other-org')
  returning id into v_other_org;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Payroll youth program', 'payroll-youth', v_owner) returning id into v_program;
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';
  select id into strict v_other_fund from public.ledger_fund where organization_id = v_other_org and code = 'GEN';
  select id into strict v_payable from public.ledger_account where organization_id = v_org and code = '2300';
  select id into strict v_wages from public.ledger_account where organization_id = v_org and code = '5000';
  select id into strict v_bank from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_other_bank from public.ledger_account where organization_id = v_other_org and code = '1000';
  v_runs := jsonb_build_array(
    tests.payroll_run_json(date '2026-10-16', date '2026-10-01', date '2026-10-14', 'R-101'),
    tests.payroll_run_json(date '2026-10-30', date '2026-10-15', date '2026-10-28', 'R-102'));

  -- ---------------------------------------------------------------------
  -- Default mapping from the starter chart
  -- ---------------------------------------------------------------------
  select count(*) into v_rows from public.payroll_account_map where organization_id = v_org;
  perform tests.ok(v_rows = 15, format('every category has a mapping row (%s)', v_rows));
  select count(*) into v_rows from public.payroll_account_map where organization_id = v_other_org;
  perform tests.ok(v_rows = 15, 'a new organization gets the default mapping too');
  select (debit_account_id = v_wages) into v_flag from public.payroll_account_map
  where organization_id = v_org and category = 'gross_wages';
  perform tests.ok(v_flag, 'gross wages default to 5000 Salaries and wages');
  select (credit_account_id = v_bank) into v_flag from public.payroll_account_map
  where organization_id = v_org and category = 'net_pay';
  perform tests.ok(v_flag, 'net pay defaults to the chequing account');
  select bool_and(credit_account_id = v_payable) into v_flag from public.payroll_account_map
  where organization_id = v_org and category like 'e_\_%';
  perform tests.ok(v_flag, 'deductions and employer contributions default to source deductions payable');

  -- Fiscal year and chart approval so runs can post.
  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2026-10-01');
  perform public.ledger_record_chart_approval(v_org, date '2026-09-20', 'Payroll Accountant, CPA');
  insert into public.ledger_fund (organization_id, code, name, restriction)
  values (v_org, 'PAYGRANT', 'Payroll test grant', 'externally_restricted') returning id into v_grant;
  insert into public.ledger_fund_program (organization_id, fund_id, program_id) values (v_org, v_grant, v_program);
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Who may import
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.payroll_raises(format(
    'select public.payroll_import_runs(%L, ''nethris'', ''pay.csv'', null, %L)', v_org, v_one),
    'administrator with MFA', 'staff cannot import payroll');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.payroll_raises(format(
    'select public.payroll_import_runs(%L, ''nethris'', ''pay.csv'', null, %L)', v_org, v_one),
    'administrator with MFA', 'the owner without MFA cannot import payroll');
  select count(*) into v_rows from public.payroll_account_map;
  perform tests.ok(v_rows = 0, 'the owner without MFA reads no payroll mapping');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.payroll_raises(format(
    'select public.payroll_import_runs(%L, ''nethris'', ''pay.csv'', null, %L)', v_org, v_one),
    'administrator with MFA', 'volunteers cannot import payroll');
  perform tests.clear_auth(); reset role;

  begin
    set local role anon;
    perform public.payroll_import_runs(v_org, 'nethris', 'pay.csv', null, v_one);
    reset role;
    perform tests.ok(false, 'anon cannot import payroll');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot import payroll');
  end;

  perform tests.authenticate(v_admin, 'aal2');
  perform tests.payroll_raises(format(
    'select public.payroll_import_runs(%L, ''nethris'', ''pay.csv'', null, %L)', v_other_org, v_one),
    'administrator with MFA', 'an admin cannot import into another organization');
  perform tests.payroll_raises(format(
    'insert into public.payroll_run (organization_id, provider, pay_date, period_start, period_end, gross_wages_cents, net_pay_cents, fingerprint) values (%L, ''other'', date ''2026-10-16'', date ''2026-10-01'', date ''2026-10-14'', 100, 100, repeat(''0'', 64))', v_org),
    'permission denied', 'an admin cannot insert pay runs directly');
  perform tests.payroll_raises(format(
    'insert into public.payroll_account_map (organization_id, category) values (%L, ''gross_wages'')', v_org),
    'permission denied', 'an admin cannot write the mapping directly');
  perform tests.payroll_raises(format(
    'select public.payroll_import_runs(%L, ''sage'', ''pay.csv'', null, %L)', v_org, v_one),
    'provider', 'an unknown provider is refused');

  -- A run that does not add up is refused, and nothing of the file is kept.
  perform tests.payroll_raises(format(
    'select public.payroll_import_runs(%L, ''nethris'', ''pay.csv'', null, %L)', v_org,
    jsonb_build_array(tests.payroll_run_json(date '2026-10-16', date '2026-10-01', date '2026-10-14')
      || jsonb_build_object('net_pay_cents', 735001))),
    'does not add up', 'a run whose gross less deductions is not net pay is refused');
  perform tests.payroll_raises(format(
    'select public.payroll_import_runs(%L, ''nethris'', ''pay.csv'', null, %L)', v_org,
    jsonb_build_array(tests.payroll_run_json(date '2026-10-16', date '2026-10-01', date '2026-10-14')
      || jsonb_build_object('er_cnt_cents', -1))),
    'does not add up', 'a negative amount is refused');
  perform tests.payroll_raises(format(
    'select public.payroll_import_runs(%L, ''nethris'', ''pay.csv'', null, %L)', v_org,
    jsonb_build_array(tests.payroll_run_json(date '2026-10-16', date '2026-10-14', date '2026-10-01'))),
    'ends before it starts', 'a period that ends before it starts is refused');

  -- Two runs in, then the same file again adds nothing.
  v_result := public.payroll_import_runs(v_org, 'nethris', 'journal-oct.csv', repeat('a', 64), v_runs);
  perform tests.ok((v_result->>'added')::int = 2 and (v_result->>'skipped')::int = 0,
    format('an admin with MFA imports two runs (%s)', v_result));
  v_run := (v_result->'ids'->>0)::uuid;
  v_run2 := (v_result->'ids'->>1)::uuid;
  v_result := public.payroll_import_runs(v_org, 'nethris', 'journal-oct.csv', repeat('a', 64), v_runs);
  perform tests.ok((v_result->>'added')::int = 0 and (v_result->>'skipped')::int = 2,
    format('importing the same file again adds no run (%s)', v_result));
  v_result := public.payroll_import_runs(v_org, 'other', 'renamed.csv', null, jsonb_build_array(v_runs->0, v_runs->0));
  perform tests.ok((v_result->>'added')::int = 0 and (v_result->>'skipped')::int = 2,
    'the same run from another file or provider, or twice in one file, is skipped');
  select count(*) into v_rows from public.payroll_run where organization_id = v_org;
  perform tests.ok(v_rows = 2, format('two runs exist, not more (%s)', v_rows));
  perform tests.clear_auth(); reset role;

  -- The unique fingerprint holds for the table owner too.
  perform tests.payroll_raises(format(
    'insert into public.payroll_run (organization_id, provider, run_reference, pay_date, period_start, period_end, gross_wages_cents, ee_federal_tax_cents, ee_quebec_tax_cents, ee_qpp_cents, ee_ei_cents, ee_qpip_cents, ee_other_cents, net_pay_cents, fingerprint) values (%L, ''other'', ''R-101'', date ''2026-10-16'', date ''2026-10-01'', date ''2026-10-14'', 1000000, 90000, 110000, 40000, 13000, 5000, 7000, 735000, repeat(''0'', 64))', v_org),
    'uq_payroll_run_fingerprint', 'a duplicate run is refused even for the table owner');

  -- ---------------------------------------------------------------------
  -- Who sees runs
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.payroll_run;
  perform tests.ok(v_rows = 0, 'staff who do not read the ledger see no pay runs');
  perform tests.payroll_raises(format('select * from public.payroll_run_lines(%L)', v_run),
    'do not have access', 'staff who do not read the ledger cannot preview a run');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_rows from public.payroll_run;
  perform tests.ok(v_rows = 0, 'volunteers see no pay runs');
  perform tests.clear_auth(); reset role;

  insert into public.ledger_reader (organization_id, user_id) values (v_org, v_staff);
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.payroll_run where organization_id = v_org;
  perform tests.ok(v_rows = 2, 'a ledger reader sees the pay runs');
  select count(*) into v_rows from public.payroll_run_lines(v_run);
  perform tests.ok(v_rows > 0, 'a ledger reader can preview a run''s entry');
  perform tests.payroll_raises(format(
    'select public.payroll_import_runs(%L, ''nethris'', ''pay.csv'', null, %L)', v_org,
    jsonb_build_array(tests.payroll_run_json(date '2026-11-13', date '2026-10-29', date '2026-11-11'))),
    'administrator with MFA', 'a ledger reader cannot import');
  perform tests.payroll_raises(format('select public.payroll_post_run(%L)', v_run),
    'administrator with MFA', 'a ledger reader cannot post a run');
  perform tests.payroll_raises(format('select public.payroll_save_allocation(%L, ''[]'')', v_run),
    'administrator with MFA', 'a ledger reader cannot allocate a run');
  perform tests.payroll_raises(format('select public.payroll_save_account_map(%L, ''[]'')', v_org),
    'administrator with MFA', 'a ledger reader cannot change the mapping');
  perform tests.payroll_raises(format('select public.payroll_delete_draft(%L)', v_run),
    'administrator with MFA', 'a ledger reader cannot delete a draft');
  perform tests.payroll_raises(format('update public.payroll_run set net_pay_cents = 1 where id = %L', v_run),
    'permission denied', 'a ledger reader cannot update a run directly');
  perform tests.payroll_raises(format('delete from public.payroll_run where id = %L', v_run),
    'permission denied', 'a ledger reader cannot delete a run directly');
  perform tests.clear_auth(); reset role;
  delete from public.ledger_reader where organization_id = v_org and user_id = v_staff;

  -- ---------------------------------------------------------------------
  -- Mapping
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.payroll_raises(format(
    'select public.payroll_save_account_map(%L, %L)', v_org,
    jsonb_build_array(jsonb_build_object('category', 'gross_wages', 'debit_account_id', v_payable))),
    'debit an expense', 'gross wages cannot be mapped to a liability');
  perform tests.payroll_raises(format(
    'select public.payroll_save_account_map(%L, %L)', v_org,
    jsonb_build_array(jsonb_build_object('category', 'ee_qpp', 'credit_account_id', v_wages))),
    'credit a liability', 'an employee deduction cannot be credited to an expense');
  perform tests.payroll_raises(format(
    'select public.payroll_save_account_map(%L, %L)', v_org,
    jsonb_build_array(jsonb_build_object('category', 'ee_qpp', 'debit_account_id', v_wages, 'credit_account_id', v_payable))),
    'never debited', 'an employee deduction has no debit side');
  perform tests.payroll_raises(format(
    'select public.payroll_save_account_map(%L, %L)', v_org,
    jsonb_build_array(jsonb_build_object('category', 'net_pay',
      'credit_account_id', v_other_bank))),
    'not in this organization', 'another organization''s account is refused');
  -- Unmapped net pay stops posting (and the preview) with a reason.
  perform public.payroll_save_account_map(v_org,
    jsonb_build_array(jsonb_build_object('category', 'net_pay', 'credit_account_id', null)));
  perform tests.payroll_raises(format('select public.payroll_post_run(%L)', v_run),
    'Map Net pay', 'an incomplete mapping cannot post');
  -- Net pay to a payable instead of the bank is allowed (admin choice).
  perform public.payroll_save_account_map(v_org,
    jsonb_build_array(jsonb_build_object('category', 'net_pay', 'credit_account_id',
      (select id from public.ledger_account where organization_id = v_org and code = '2100'))));
  perform public.payroll_save_account_map(v_org,
    jsonb_build_array(jsonb_build_object('category', 'net_pay', 'credit_account_id', v_bank)));

  -- ---------------------------------------------------------------------
  -- Allocation
  -- ---------------------------------------------------------------------
  perform tests.payroll_raises(format('select public.payroll_save_allocation(%L, %L)', v_run,
    jsonb_build_array(jsonb_build_object('fund_id', v_gen, 'share_percent', '60'),
                      jsonb_build_object('fund_id', v_grant, 'program_id', v_program, 'share_percent', '30'))),
    'not 100%', 'percentages must add up to 100');
  perform tests.payroll_raises(format('select public.payroll_save_allocation(%L, %L)', v_run,
    jsonb_build_array(jsonb_build_object('fund_id', v_gen, 'share_percent', '60'),
                      jsonb_build_object('fund_id', v_grant, 'program_id', v_program, 'share_cents', 400000))),
    'every share as a percentage', 'percentages and amounts cannot be mixed');
  perform tests.payroll_raises(format('select public.payroll_save_allocation(%L, %L)', v_run,
    jsonb_build_array(jsonb_build_object('fund_id', v_gen, 'share_cents', 600000),
                      jsonb_build_object('fund_id', v_grant, 'program_id', v_program, 'share_cents', 300000))),
    'gross wages', 'amounts must add up to the gross wages');
  perform tests.payroll_raises(format('select public.payroll_save_allocation(%L, %L)', v_run,
    jsonb_build_array(jsonb_build_object('fund_id', v_other_fund, 'share_percent', '100'))),
    'fund of this organization', 'another organization''s fund is refused');
  perform tests.payroll_raises(format('select public.payroll_save_allocation(%L, %L)', v_run,
    jsonb_build_array(jsonb_build_object('fund_id', v_gen, 'share_percent', '33.333'),
                      jsonb_build_object('fund_id', v_grant, 'share_percent', '66.667'))),
    'two decimals', 'a percentage with three decimals is refused, not rounded');

  -- A restricted fund spent without its program fails the ledger's own rule.
  perform public.payroll_save_allocation(v_run,
    jsonb_build_array(jsonb_build_object('fund_id', v_gen, 'share_percent', '50'),
                      jsonb_build_object('fund_id', v_grant, 'share_percent', '50')));
  perform tests.payroll_raises(format('select public.payroll_post_run(%L)', v_run),
    'can only be spent on its programs', 'restricted fund rules apply to payroll');

  -- Three shares that cannot split the cents evenly.
  perform public.payroll_save_allocation(v_run,
    jsonb_build_array(jsonb_build_object('fund_id', v_gen, 'share_percent', '33.33'),
                      jsonb_build_object('fund_id', v_grant, 'program_id', v_program, 'share_percent', '33.33'),
                      jsonb_build_object('fund_id', v_gen, 'program_id', v_program, 'share_percent', '33.34')));
  select count(*) into v_rows from public.payroll_run_allocation where run_id = v_run;
  perform tests.ok(v_rows = 3, 'the allocation is saved');

  -- The preview balances overall and within each fund, and adds back to
  -- the run's totals.
  select sum(debit_cents), sum(credit_cents) into v_debits, v_credits from public.payroll_run_lines(v_run);
  perform tests.ok(v_debits = v_credits and v_debits = 1000000 + 123456,
    format('the entry balances: debits %s, credits %s', v_debits, v_credits));
  select bool_and(d = c) into v_flag from (
    select fund_id, sum(debit_cents) d, sum(credit_cents) c from public.payroll_run_lines(v_run) group by fund_id) x;
  perform tests.ok(v_flag, 'the entry balances within each fund');
  select sum(credit_cents) into v_sum from public.payroll_run_lines(v_run) where category = 'net_pay';
  perform tests.ok(v_sum = 735000, format('net pay adds back to the run''s net (%s)', v_sum));
  select sum(debit_cents) into v_sum from public.payroll_run_lines(v_run) where category = 'gross_wages';
  perform tests.ok(v_sum = 1000000, format('gross wages add back exactly (%s)', v_sum));
  select sum(debit_cents) into v_sum from public.payroll_run_lines(v_run) where category = 'er_cnt';
  perform tests.ok(v_sum = 656, format('an odd employer amount splits without losing a cent (%s)', v_sum));
  select bool_and(program_id is null) into v_flag from public.payroll_run_lines(v_run) where credit_cents > 0;
  perform tests.ok(v_flag, 'only expense lines carry the program');

  -- ---------------------------------------------------------------------
  -- Posting
  -- ---------------------------------------------------------------------
  v_number := public.payroll_post_run(v_run);
  select journal_entry_id into v_entry from public.payroll_run where id = v_run and status = 'posted';
  perform tests.ok(v_entry is not null and v_number > 0, 'an admin with MFA posts the run');
  select count(*) into v_rows from public.journal_entry
  where id = v_entry and status = 'posted' and source_type = 'payroll_run' and source_id = v_run
    and entry_date = date '2026-10-16';
  perform tests.ok(v_rows = 1, 'the run is one posted entry, dated on the pay date, sourced to the run');
  select sum(debit_cents), sum(credit_cents) into v_debits, v_credits from public.journal_line where entry_id = v_entry;
  perform tests.ok(v_debits = v_credits and v_debits = 1123456, 'the posted entry balances');
  select sum(credit_cents) - sum(debit_cents) into v_sum from public.journal_line
  where entry_id = v_entry and account_id = v_payable;
  perform tests.ok(v_sum = 265000 + 123456,
    format('source deductions payable holds employee and employer amounts (%s)', v_sum));
  perform tests.payroll_raises(format('select public.payroll_post_run(%L)', v_run),
    'already posted', 'a run posts once');
  perform tests.payroll_raises(format('select public.payroll_save_allocation(%L, ''[]'')', v_run),
    'cannot change', 'a posted run''s allocation is locked');
  perform tests.payroll_raises(format('select public.payroll_delete_draft(%L)', v_run),
    'reverse it instead', 'a posted run cannot be deleted');
  perform tests.clear_auth(); reset role;

  -- The locks hold for the table owner as well.
  perform tests.payroll_raises(format('update public.payroll_run set net_pay_cents = 0, gross_wages_cents = 265000 where id = %L', v_run),
    'keeps its figures', 'a posted run''s totals cannot change, even for the table owner');
  perform tests.payroll_raises(format('update public.payroll_run set status = ''draft'', journal_entry_id = null, posted_at = null where id = %L', v_run),
    'locked', 'a posted run cannot go back to draft');
  perform tests.payroll_raises(format('delete from public.payroll_run_allocation where run_id = %L', v_run),
    'cannot change', 'a posted run''s allocation cannot be deleted directly');
  perform tests.payroll_raises(format('update public.payroll_run set net_pay_cents = 1 where id = %L', v_run2),
    'keeps its figures', 'a draft run''s totals cannot change either');

  -- ---------------------------------------------------------------------
  -- Periods: closed, or none
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  v_result := public.payroll_import_runs(v_org, 'adp_wfn', 'nov.csv', null,
    jsonb_build_array(tests.payroll_run_json(date '2026-11-13', date '2026-10-29', date '2026-11-11'),
                      tests.payroll_run_json(date '2031-01-15', date '2031-01-01', date '2031-01-14')));
  v_closed_run := (v_result->'ids'->>0)::uuid;
  perform public.ledger_set_period_status(
    (select id from public.ledger_period where organization_id = v_org and starts_on = date '2026-11-01'), 'closed');
  perform tests.payroll_raises(format('select public.payroll_post_run(%L)', v_closed_run),
    'is closed', 'a run paid in a closed period cannot post');
  select status = 'draft' into v_flag from public.payroll_run where id = v_closed_run;
  perform tests.ok(v_flag, 'the refused run stays a draft');
  perform tests.payroll_raises(format('select public.payroll_post_run(%L)', (v_result->'ids'->>1)::uuid),
    'No fiscal period', 'a run paid outside every period cannot post');
  perform public.ledger_set_period_status(
    (select id from public.ledger_period where organization_id = v_org and starts_on = date '2026-11-01'), 'open');

  -- ---------------------------------------------------------------------
  -- Reversal, re-import, delete draft
  -- ---------------------------------------------------------------------
  perform public.payroll_reverse_run(v_run, date '2026-10-20', null);
  select status = 'reversed' and reversal_entry_id is not null into v_flag from public.payroll_run where id = v_run;
  perform tests.ok(v_flag, 'an admin with MFA reverses a posted run');
  select sum(l.debit_cents) filter (where l.entry_id = v_entry) = sum(l.credit_cents) filter (where l.entry_id <> v_entry)
    into v_flag
  from public.journal_line l
  where l.entry_id in (v_entry, (select reversal_entry_id from public.payroll_run where id = v_run));
  perform tests.ok(v_flag, 'the reversal mirrors the entry');
  perform tests.payroll_raises(format('select public.payroll_reverse_run(%L, null, null)', v_run),
    'Only a posted pay run', 'a run is reversed once');
  v_result := public.payroll_import_runs(v_org, 'nethris', 'journal-oct.csv', null, v_one);
  perform tests.ok((v_result->>'added')::int = 1, 'a reversed run can be imported again');

  perform public.payroll_delete_draft(v_run2);
  select count(*) into v_rows from public.payroll_run where id = v_run2;
  perform tests.ok(v_rows = 0, 'an admin with MFA deletes a draft run');
  perform tests.clear_auth(); reset role;

  -- Nothing about employees is stored: no column could hold a name or SIN.
  select count(*) into v_rows from information_schema.columns
  where table_schema = 'public' and table_name like 'payroll%'
    and column_name ~ '(employee|name|sin|social|first|last)' and column_name <> 'file_name';
  perform tests.ok(v_rows = 0, format('no payroll column holds employee details (%s)', v_rows));

  -- Every step left an audit record.
  select count(distinct action) into v_rows from public.audit_event
  where organization_id = v_org and event_type = 'payroll'
    and action in ('runs_imported', 'account_map_saved', 'allocation_saved', 'run_posted', 'run_reversed', 'draft_deleted');
  perform tests.ok(v_rows = 6, format('import, mapping, allocation, post, reverse and delete are audited (%s of 6)', v_rows));
end
$$;

rollback;
