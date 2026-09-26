-- Bank import and reconciliation (#151; migration 20260928200000). Proves in
-- the database: only admins with MFA write and ledger readers read; importing
-- the same lines twice stores them once; a match is only to a posted line of
-- the same cash account for the same amount, each side at most once; an entry
-- created from a statement line posts through the ledger with its source; a
-- reconciliation closes only at a zero difference with every line matched and
-- the statement adding up, even for a direct update by the table owner; and a
-- reconciled statement freezes its lines until reopened. Run after
-- qa-users.sql, rls.sql and ledger-core.sql. All mutations are rolled back.
begin;

create function tests.bank_raises(p_sql text, p_pattern text, p_msg text)
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
grant execute on function tests.bank_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_cash uuid;
  v_savings uuid;
  v_equity uuid;
  v_donations uuid;
  v_rent uuid;
  v_charges uuid;
  v_gen uuid;
  v_account uuid;
  v_entry uuid;
  v_rent_entry uuid;
  v_dep_entry uuid;
  v_rent_line uuid;
  v_dep_line uuid;
  v_t_dep uuid;
  v_t_fee uuid;
  v_t_rent uuid;
  v_t_fee2 uuid;
  v_rec uuid;
  v_rec2 uuid;
  v_import uuid;
  v_result jsonb;
  v_rows integer;
  f record;
  v_lines jsonb := jsonb_build_array(
    jsonb_build_object('posted_on', '2026-10-03', 'amount_cents', 25000, 'description', 'Deposit',
      'fingerprint', repeat('a', 64)),
    jsonb_build_object('posted_on', '2026-10-05', 'amount_cents', -795, 'description', 'Service fee',
      'fingerprint', repeat('b', 64)),
    jsonb_build_object('posted_on', '2026-10-09', 'amount_cents', -30000, 'description', 'Cheque 101',
      'reference', '101', 'fingerprint', repeat('c', 64)));
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  select id into strict v_cash from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_savings from public.ledger_account where organization_id = v_org and code = '1010';
  select id into strict v_equity from public.ledger_account where organization_id = v_org and code = '3000';
  select id into strict v_donations from public.ledger_account where organization_id = v_org and code = '4200';
  select id into strict v_rent from public.ledger_account where organization_id = v_org and code = '5200';
  select id into strict v_charges from public.ledger_account where organization_id = v_org and code = '5800';
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';

  -- Books ready to post: periods, the chart approval, an opening balance.
  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2026-10-01');
  perform public.ledger_record_chart_approval(v_org, date '2026-09-20', 'Accountant, CPA');
  v_entry := public.ledger_save_draft(v_org, null, date '2026-10-01', 'Opening balances', 'opening',
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'fund_id', v_gen, 'debit_cents', 1000000),
      jsonb_build_object('account_id', v_equity, 'fund_id', v_gen, 'credit_cents', 1000000)));
  perform public.ledger_post_entry(v_entry);
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Bank accounts: who may set them up, and what they may point at
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.bank_raises(format(
    'select public.bank_save_account(%L, null, ''Chequing'', ''desjardins'', ''1234'', %L, %L, date ''2026-10-01'', true)',
    v_org, v_cash, v_gen), 'administrator', 'staff cannot add a bank account');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.bank_raises(format(
    'select public.bank_save_account(%L, null, ''Chequing'', ''desjardins'', ''1234'', %L, %L, date ''2026-10-01'', true)',
    v_org, v_cash, v_gen), 'administrator', 'an owner without MFA cannot add a bank account');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.bank_raises(format(
    'insert into public.bank_account (organization_id, name, institution, ledger_account_id, default_fund_id, reconcile_from) values (%L, ''x'', ''td'', %L, %L, date ''2026-10-01'')',
    v_org, v_cash, v_gen), 'permission denied', 'bank tables take no direct writes, admins included');
  perform tests.bank_raises(format(
    'select public.bank_save_account(%L, null, ''Wrong'', ''td'', null, %L, %L, date ''2026-10-01'', true)',
    v_org, v_donations, v_gen), 'asset account', 'a bank account is tied to an asset account');
  perform tests.bank_raises(format(
    'select public.bank_save_account(%L, null, ''Leaky'', ''td'', ''123456789'', %L, %L, date ''2026-10-01'', true)',
    v_org, v_savings, v_gen), 'check constraint', 'only the last four digits are stored');
  v_account := public.bank_save_account(v_org, null, 'Chequing', 'desjardins', '1234', v_cash, v_gen,
    date '2026-10-01', true);
  perform tests.ok(v_account is not null, 'an admin with MFA adds a bank account');
  perform tests.bank_raises(format(
    'select public.bank_save_account(%L, null, ''Twin'', ''td'', null, %L, %L, date ''2026-10-01'', true)',
    v_org, v_cash, v_gen), 'duplicate', 'two bank accounts cannot share a cash account');

  -- ---------------------------------------------------------------------
  -- Import and de-duplication
  -- ---------------------------------------------------------------------
  v_result := public.bank_import_statement(v_account, 'october.csv', 'csv', 'desjardins', repeat('1', 64), v_lines);
  perform tests.ok((v_result->>'added')::int = 3 and (v_result->>'skipped')::int = 0,
    format('a first import adds every line (%s)', v_result));
  v_result := public.bank_import_statement(v_account, 'october.csv', 'csv', 'desjardins', repeat('1', 64), v_lines);
  perform tests.ok((v_result->>'added')::int = 0 and (v_result->>'skipped')::int = 3,
    format('importing the same statement again adds nothing (%s)', v_result));
  v_result := public.bank_import_statement(v_account, 'october-full.csv', 'csv', 'desjardins', repeat('2', 64),
    v_lines || jsonb_build_array(jsonb_build_object('posted_on', '2026-10-31', 'amount_cents', -400,
      'description', 'Monthly fee', 'fingerprint', repeat('d', 64))));
  perform tests.ok((v_result->>'added')::int = 1 and (v_result->>'skipped')::int = 3,
    'a longer, overlapping download adds only the new line');
  select count(*) into v_rows from public.bank_transaction where bank_account_id = v_account;
  perform tests.ok(v_rows = 4, format('four distinct lines are stored (%s)', v_rows));
  perform tests.bank_raises(format('update public.bank_transaction set amount_cents = 1 where bank_account_id = %L', v_account),
    'permission denied', 'an admin cannot edit a statement line');

  select id into strict v_t_dep from public.bank_transaction where bank_account_id = v_account and fingerprint = repeat('a', 64);
  select id into strict v_t_fee from public.bank_transaction where bank_account_id = v_account and fingerprint = repeat('b', 64);
  select id into strict v_t_rent from public.bank_transaction where bank_account_id = v_account and fingerprint = repeat('c', 64);
  select id into strict v_t_fee2 from public.bank_transaction where bank_account_id = v_account and fingerprint = repeat('d', 64);

  -- ---------------------------------------------------------------------
  -- Matching
  -- ---------------------------------------------------------------------
  v_rent_entry := public.ledger_save_draft(v_org, null, date '2026-10-08', 'October rent, cheque 101', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 30000),
      jsonb_build_object('account_id', v_cash, 'fund_id', v_gen, 'credit_cents', 30000)));
  perform public.ledger_post_entry(v_rent_entry);
  select id into strict v_rent_line from public.journal_line where entry_id = v_rent_entry and account_id = v_cash;

  v_dep_entry := public.ledger_save_draft(v_org, null, date '2026-10-03', 'Donations deposited', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'fund_id', v_gen, 'debit_cents', 25000),
      jsonb_build_object('account_id', v_donations, 'fund_id', v_gen, 'credit_cents', 25000)));
  select id into strict v_dep_line from public.journal_line where entry_id = v_dep_entry and account_id = v_cash;
  perform tests.bank_raises(format('select public.bank_match_line(%L, %L, ''manual'')', v_t_dep, v_dep_line),
    'posted ledger line', 'a draft cannot be matched');
  perform public.ledger_post_entry(v_dep_entry);

  select count(*) into v_rows from public.bank_match_candidates(v_account, date '2026-10-01', date '2026-10-31', 7)
  where bank_transaction_id = v_t_rent and journal_line_id = v_rent_line and day_gap = 1;
  perform tests.ok(v_rows = 1, 'the rent cheque is suggested for the rent line, one day apart');
  select count(*) into v_rows from public.bank_match_candidates(v_account, date '2026-10-01', date '2026-10-31', 7)
  where bank_transaction_id = v_t_fee;
  perform tests.ok(v_rows = 0, 'nothing is suggested for a fee the ledger does not have');

  perform tests.bank_raises(format('select public.bank_match_line(%L, %L, ''manual'')', v_t_rent, v_dep_line),
    'same amount', 'a line is not matched to a different amount');
  perform public.bank_match_line(v_t_rent, v_rent_line, 'suggested');
  perform tests.bank_raises(format('select public.bank_match_line(%L, %L, ''manual'')', v_t_fee2, v_rent_line),
    'already matched', 'a ledger line is matched only once');
  perform tests.bank_raises(format('select public.bank_match_line(%L, %L, ''manual'')', v_t_rent, v_rent_line),
    'already matched', 'a statement line is matched only once');
  perform public.bank_unmatch_line(v_t_rent);
  perform public.bank_match_line(v_t_rent, v_rent_line, 'manual');
  perform tests.ok(exists (select 1 from public.bank_match where bank_transaction_id = v_t_rent and method = 'manual'),
    'a match can be undone and made again');

  -- ---------------------------------------------------------------------
  -- Reconciliation
  -- ---------------------------------------------------------------------
  -- 10,000.00 + 250.00 - 7.95 - 300.00 - 4.00 = 9,938.05
  v_rec := public.bank_start_reconciliation(v_account, date '2026-10-01', date '2026-10-31', 1000000, 993805);
  perform tests.bank_raises(format(
    'select public.bank_start_reconciliation(%L, date ''2026-10-15'', date ''2026-11-15'', 0, 0)', v_account),
    'overlap', 'statements of one account cannot overlap');

  select * into f from public.bank_reconciliation_summary(v_rec);
  perform tests.ok(f.unmatched_count = 3 and f.statement_gap_cents = 0,
    format('three lines are unmatched and the statement adds up (%s, %s)', f.unmatched_count, f.statement_gap_cents));
  perform tests.ok(f.difference_cents = 993805 - (1000000 - 30000),
    format('the difference counts only cleared ledger lines (%s)', f.difference_cents));
  perform tests.bank_raises(format('select public.bank_set_reconciliation_status(%L, ''reconciled'')', v_rec),
    'not matched', 'a statement with unmatched lines cannot be reconciled');

  perform public.bank_match_line(v_t_dep, v_dep_line, 'suggested');
  v_entry := public.bank_create_entry(v_t_fee, v_charges, null, null, null);
  perform tests.ok(exists (select 1 from public.journal_entry where id = v_entry and status = 'posted'
      and source_type = 'bank_transaction' and source_id = v_t_fee and entry_date = date '2026-10-05'),
    'an entry created from a statement line is posted with the line as its source');
  perform tests.ok((select sum(credit_cents) from public.journal_line where entry_id = v_entry and account_id = v_cash) = 795
      and (select sum(debit_cents) from public.journal_line where entry_id = v_entry and account_id = v_charges) = 795,
    'a withdrawal credits cash and debits the chosen account');
  perform tests.ok(exists (select 1 from public.bank_match where bank_transaction_id = v_t_fee and method = 'created'),
    'the created entry is matched at once');
  perform tests.bank_raises(format('select public.bank_create_entry(%L, %L, null, null, null)', v_t_fee, v_charges),
    'already matched', 'an entry is not created twice for one line');
  perform tests.bank_raises(format('select public.bank_create_entry(%L, %L, null, null, null)', v_t_fee2, v_cash),
    'other than the bank', 'the other side cannot be the cash account itself');
  perform public.bank_create_entry(v_t_fee2, v_charges, v_gen, null, 'October account fee');

  -- An outstanding cheque: in the ledger, not yet at the bank.
  v_entry := public.ledger_save_draft(v_org, null, date '2026-10-30', 'Cheque 102, not yet cashed', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 5000),
      jsonb_build_object('account_id', v_cash, 'fund_id', v_gen, 'credit_cents', 5000)));
  perform public.ledger_post_entry(v_entry);

  select * into f from public.bank_reconciliation_summary(v_rec);
  perform tests.ok(f.unmatched_count = 0 and f.difference_cents = 0,
    format('every line matched: the difference is zero (%s)', f.difference_cents));
  perform tests.ok(f.ledger_balance_cents = 988805 and f.outstanding_cents = -5000 and f.outstanding_count = 1,
    format('the outstanding cheque explains ledger vs bank (%s, %s)', f.ledger_balance_cents, f.outstanding_cents));
  perform tests.ok((select count(*) from public.bank_reconciliation_outstanding(v_rec)
      where entry_id = v_entry and amount_cents = -5000) = 1
    and (select count(*) from public.bank_reconciliation_outstanding(v_rec)) = 1,
    'the outstanding list holds exactly the uncashed cheque');
  perform tests.ok((select count(*) from public.bank_statement_lines(v_account, date '2026-10-01', date '2026-10-31')
      where entry_id is not null) = 4,
    'the statement lines list shows each line with its ledger entry');

  -- A wrong closing balance is refused, through the function and directly.
  perform public.bank_update_reconciliation(v_rec, 1000000, 993800);
  perform tests.bank_raises(format('select public.bank_set_reconciliation_status(%L, ''reconciled'')', v_rec),
    'do not add up', 'a statement whose lines do not add up cannot be reconciled');
  perform tests.clear_auth(); reset role;

  perform tests.bank_raises(format(
    'update public.bank_reconciliation set status = ''reconciled'', reconciled_at = now() where id = %L', v_rec),
    'do not add up', 'the table owner cannot mark a non-zero statement reconciled either');
  perform tests.bank_raises(format(
    'update public.bank_reconciliation set opening_balance_cents = 999995, status = ''reconciled'', reconciled_at = now() where id = %L', v_rec),
    'difference is not zero', 'a statement that adds up but differs from the ledger is refused');

  perform tests.authenticate(v_staff, 'aal1');
  perform tests.bank_raises(format('select public.bank_set_reconciliation_status(%L, ''reconciled'')', v_rec),
    'administrator', 'staff cannot reconcile');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform public.bank_update_reconciliation(v_rec, 1000000, 993805);
  perform public.bank_set_reconciliation_status(v_rec, 'reconciled');
  perform tests.ok(exists (select 1 from public.bank_reconciliation where id = v_rec and status = 'reconciled'
    and reconciled_by = v_owner), 'a zero-difference statement is reconciled by an admin');

  -- Frozen once reconciled.
  perform tests.bank_raises(format('select public.bank_unmatch_line(%L)', v_t_dep),
    'reconciled statement', 'a reconciled line cannot be unmatched');
  perform tests.bank_raises(format(
    'select public.bank_import_statement(%L, ''late.csv'', ''csv'', ''td'', repeat(''3'', 64), %L::jsonb)', v_account,
    jsonb_build_array(jsonb_build_object('posted_on', '2026-10-20', 'amount_cents', 100, 'description', 'Late',
      'fingerprint', repeat('e', 64)))),
    'reconciled statement', 'no new line lands inside a reconciled statement');
  select id into strict v_import from public.bank_import where bank_account_id = v_account order by created_at limit 1;
  perform tests.bank_raises(format('select public.bank_update_reconciliation(%L, 0, 0)', v_rec),
    'reopen it first', 'a reconciled statement''s balances cannot change');
  perform tests.bank_raises(format('select public.bank_delete_reconciliation(%L)', v_rec),
    'cannot be deleted', 'a reconciled statement cannot be deleted');

  -- The next statement continues from this one.
  v_rec2 := public.bank_start_reconciliation(v_account, date '2026-11-01', date '2026-11-30', 990000, 990000);
  perform tests.bank_raises(format('select public.bank_set_reconciliation_status(%L, ''reconciled'')', v_rec2),
    'previous statement', 'the opening balance must equal the previous closing balance');

  -- Reopening: latest first.
  perform public.bank_update_reconciliation(v_rec2, 993805, 988805);
  v_result := public.bank_import_statement(v_account, 'november.csv', 'csv', 'desjardins', repeat('4', 64),
    jsonb_build_array(jsonb_build_object('posted_on', '2026-11-03', 'amount_cents', -5000, 'description', 'Cheque 102',
      'fingerprint', repeat('f', 64))));
  select id into strict v_t_fee2 from public.bank_transaction where fingerprint = repeat('f', 64) and bank_account_id = v_account;
  perform public.bank_match_line(v_t_fee2, (select l.id from public.journal_line l where l.entry_id = v_entry and l.account_id = v_cash), 'suggested');
  perform public.bank_set_reconciliation_status(v_rec2, 'reconciled');
  perform tests.ok(exists (select 1 from public.bank_reconciliation where id = v_rec2 and status = 'reconciled'),
    'the outstanding cheque clears the next month and that statement reconciles');
  perform tests.bank_raises(format('select public.bank_set_reconciliation_status(%L, ''open'')', v_rec),
    'later reconciled', 'an earlier statement cannot be reopened under a later reconciled one');
  perform public.bank_set_reconciliation_status(v_rec2, 'open');
  perform public.bank_set_reconciliation_status(v_rec, 'open');
  perform public.bank_unmatch_line(v_t_dep);
  perform tests.ok(not exists (select 1 from public.bank_match where bank_transaction_id = v_t_dep),
    'a reopened statement can be corrected');
  perform public.bank_match_line(v_t_dep, v_dep_line, 'manual');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Who reads
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.bank_transaction;
  perform tests.ok(v_rows = 0, 'staff without a ledger grant read no statement lines');
  perform tests.bank_raises(format('select * from public.bank_reconciliation_summary(%L)', v_rec),
    'not found', 'staff without a ledger grant cannot read the figures');
  perform tests.clear_auth(); reset role;

  insert into public.ledger_reader (organization_id, user_id) values (v_org, v_staff);
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.bank_transaction where bank_account_id = v_account;
  perform tests.ok(v_rows = 5, format('a ledger reader reads the statement lines (%s)', v_rows));
  select * into f from public.bank_reconciliation_summary(v_rec);
  perform tests.ok(f.difference_cents = 0, 'a ledger reader reads the figures');
  perform tests.bank_raises(format('select public.bank_unmatch_line(%L)', v_t_dep),
    'administrator', 'a ledger reader cannot unmatch');
  perform tests.bank_raises(format('select public.bank_delete_import(%L)', v_import),
    'administrator', 'a ledger reader cannot delete an import');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_rows from public.bank_account;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 0, 'volunteers read no bank accounts');

  begin
    set local role anon;
    perform public.bank_reconciliation_summary(v_rec);
    reset role;
    perform tests.ok(false, 'anon cannot call the reconciliation figures');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call the reconciliation figures');
  end;

  select count(*) into v_rows from public.audit_event where organization_id = v_org and event_type = 'bank'
    and action in ('account_created', 'statement_imported', 'line_matched', 'line_unmatched', 'entry_created',
                   'reconciliation_started', 'reconciliation_closed', 'reconciliation_reopened');
  perform tests.ok(v_rows >= 12, format('bank steps are audited (%s)', v_rows));
end
$$;

rollback;
