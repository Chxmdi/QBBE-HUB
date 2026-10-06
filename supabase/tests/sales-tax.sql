-- GST/QST tracking (#152; migration 20260928300000). Proves, whoever calls:
-- rates and rounding are exact, only admins with MFA write tax records and
-- only ledger readers see them, tax is calculated and claimed by the rules,
-- receipts come in once each, period totals equal the sum of their lines,
-- closing posts one balanced net-tax entry and freezes the period, and
-- reopening reverses that entry. Run after qa-users.sql, rls.sql and
-- ledger-core.sql. All mutations are rolled back.
begin;

create function tests.tax_raises(p_sql text, p_pattern text, p_msg text)
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
grant execute on function tests.tax_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_other_org uuid;
  v_sale uuid;
  v_zero uuid;
  v_purchase uuid;
  v_half uuid;
  v_line uuid;
  v_receipt uuid;
  v_period uuid;
  v_period2 uuid;
  v_entry uuid;
  v_rows integer;
  v_sum bigint;
  v_sum2 bigint;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.organization (name, slug) values ('Tax other org', 'tax-other-org')
  returning id into v_other_org;

  -- ---------------------------------------------------------------------
  -- Seeding, rates and rounding
  -- ---------------------------------------------------------------------
  perform tests.ok(exists (select 1 from public.sales_tax_settings where organization_id = v_org
    and not gst_registered and not qst_registered and itc_claim_bp = 10000 and not show_psb_rebate),
    'every organization starts unregistered, with the rebate worksheet hidden');
  perform tests.ok((select count(*) from public.ledger_account where organization_id = v_other_org
    and code in ('2220', '2230')) = 2, 'a new organization gets the net tax accounts');
  perform tests.ok(exists (select 1 from public.sales_tax_settings where organization_id = v_other_org),
    'a new organization gets tax settings');

  perform tests.ok(app.sales_tax_rate_on('gst', date '2026-10-01') = 5.00000, 'GST is 5 %');
  perform tests.ok(app.sales_tax_rate_on('qst', date '2026-10-01') = 9.97500, 'QST is 9.975 %');
  perform tests.ok(app.sales_tax_amount(10000, 9.975) = 998, 'QST on $100.00 is $9.98 (997.5 cents rounds up)');
  perform tests.ok(app.sales_tax_amount(10, 5) = 1, 'half a cent rounds up');
  perform tests.ok(app.sales_tax_amount(9, 5) = 0, 'under half a cent rounds down');
  perform tests.ok(app.sales_tax_amount(1990, 9.975) = 199, 'QST on $19.90 is $1.99');
  perform tests.ok(app.sales_tax_amount(123456789, 5) = 6172839, 'GST on $1,234,567.89 is $61,728.39 (exact decimal)');
  perform tests.tax_raises('select app.sales_tax_rate_on(''gst'', date ''1990-01-01'')',
    'No GST rate', 'a date with no rate is refused, not guessed');

  -- ---------------------------------------------------------------------
  -- Who can do what
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal1');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_settings(%L, true, ''1'', true, ''2'', ''quarterly'', 10000, false)', v_org),
    'administrator', 'an owner without MFA cannot change tax settings');
  select count(*) into v_rows from public.sales_tax_settings;
  perform tests.ok(v_rows = 0, 'an owner without MFA reads no tax settings');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.sales_tax_settings;
  perform tests.ok(v_rows = 0, 'staff who are not ledger readers read no tax settings');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_line(%L, null, ''sale'', ''standard'', date ''2026-10-05'', ''x'', null, null, 100)', v_org),
    'administrator', 'staff cannot record tax lines');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_rows from public.sales_tax_period;
  perform tests.ok(v_rows = 0, 'volunteers read no tax periods');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.tax_raises(format(
    'insert into public.sales_tax_line (organization_id, direction, tax_code, transaction_date, counterparty, amount_cents) values (%L, ''sale'', ''standard'', date ''2026-10-05'', ''x'', 1)', v_org),
    'permission denied', 'even an admin cannot insert tax lines directly');
  perform tests.tax_raises(
    'update public.sales_tax_rate set rate_percent = 6 where tax = ''gst''',
    'permission denied', 'nobody signed in can change a rate');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_settings(%L, true, null, false, null, ''daily'', 10000, false)', v_org),
    'monthly, quarterly or annual', 'filing frequency is one of the three');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_settings(%L, true, null, false, null, ''annual'', 10001, false)', v_org),
    'between 0', 'the claimable share is at most 100 %');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_settings(%L, true, null, true, null, ''annual'', 10000, false)', v_other_org),
    'administrator', 'an admin of one organization cannot change another''s settings');

  -- Not registered yet: no tax on a sale, nothing to claim on a purchase.
  v_line := public.sales_tax_save_line(v_org, null, 'sale', 'standard', date '2026-09-15',
    'Before registration', null, null, 10000);
  perform tests.ok((select gst_cents + qst_cents from public.sales_tax_line where id = v_line) = 0,
    'an unregistered organization collects no tax');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_line(%L, null, ''purchase'', ''standard'', date ''2026-09-15'', ''x'', null, null, 1000, 50, 100, 50, null)', v_org),
    'registrant', 'an unregistered organization cannot claim input tax credits');
  perform public.sales_tax_delete_line(v_line);

  perform public.sales_tax_save_settings(v_org, true, '123456789 RT0001', true, '1234567890 TQ0001',
    'quarterly', 10000, false);
  perform tests.clear_auth(); reset role;
  perform tests.ok(exists (select 1 from public.sales_tax_settings where organization_id = v_org
    and gst_registered and qst_number = '1234567890 TQ0001' and filing_frequency = 'quarterly'
    and updated_by = v_owner), 'settings are saved with who saved them');

  -- ---------------------------------------------------------------------
  -- Recording lines
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  v_sale := public.sales_tax_save_line(v_org, null, 'sale', 'standard', date '2026-10-10',
    'Parents association', 'INV-1', 'Program fees', 10000);
  select * into r from public.sales_tax_line where id = v_sale;
  perform tests.ok(r.gst_cents = 500 and r.qst_cents = 998,
    format('a standard-rated sale of $100 collects $5.00 GST and $9.98 QST (%s, %s)', r.gst_cents, r.qst_cents));
  v_zero := public.sales_tax_save_line(v_org, null, 'sale', 'zero_rated', date '2026-10-11',
    'Export client', null, null, 20000);
  perform tests.ok((select gst_cents + qst_cents from public.sales_tax_line where id = v_zero) = 0,
    'a zero-rated sale collects nothing');
  perform public.sales_tax_save_line(v_org, null, 'sale', 'exempt', date '2026-10-12',
    'Member', null, 'Membership', 5000);
  perform tests.tax_raises(format(
    'select public.sales_tax_save_line(%L, null, ''sale'', ''exempt'', date ''2026-10-12'', ''x'', null, null, 100, 5, null)', v_org),
    'Only a standard-rated', 'an exempt line cannot carry tax');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_line(%L, null, ''sale'', ''standard'', date ''2026-10-12'', ''x'', null, null, 100, null, null, 1, null)', v_org),
    'Only a purchase', 'a sale has nothing to claim back');

  v_purchase := public.sales_tax_save_line(v_org, null, 'purchase', 'standard', date '2026-10-15',
    'Office supplier', 'B-77', 'Supplies', 20000, 1000, 1995);
  select * into r from public.sales_tax_line where id = v_purchase;
  perform tests.ok(r.itc_cents = 1000 and r.itr_cents = 1995,
    'a registrant claims all the tax paid by default');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_line(%L, null, ''purchase'', ''standard'', date ''2026-10-15'', ''x'', null, null, 100, 5, 10, 6, null)', v_org),
    'cannot exceed', 'no more can be claimed than was paid');

  -- A claimable share of 50 % rounds half a cent up.
  perform public.sales_tax_save_settings(v_org, true, '123456789 RT0001', true, '1234567890 TQ0001',
    'quarterly', 5000, false);
  v_half := public.sales_tax_save_line(v_org, null, 'purchase', 'standard', date '2026-11-02',
    'Caterer', null, null, 300, 15, 29);
  select * into r from public.sales_tax_line where id = v_half;
  perform tests.ok(r.itc_cents = 8 and r.itr_cents = 15,
    format('half of 15 and 29 cents rounds to 8 and 15 (%s, %s)', r.itc_cents, r.itr_cents));
  perform public.sales_tax_save_settings(v_org, true, '123456789 RT0001', true, '1234567890 TQ0001',
    'quarterly', 10000, false);

  -- Editing a line recalculates it.
  perform public.sales_tax_save_line(v_org, v_sale, 'sale', 'standard', date '2026-10-10',
    'Parents association', 'INV-1', 'Program fees', 20000);
  perform tests.ok((select gst_cents from public.sales_tax_line where id = v_sale) = 1000,
    'editing a sale recalculates its tax');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Receipts come in once each
  -- ---------------------------------------------------------------------
  insert into public.finance_receipt (organization_id, submitted_by, document_date, vendor, total_cents,
    gst_cents, qst_cents, storage_path, file_name, scan_status, status, reviewed_by, reviewed_at)
  values (v_org, v_staff, date '2026-10-20', 'Hardware store', 5749, 250, 499,
    v_org || '/' || v_staff || '/tax-test-1.pdf', 'r1.pdf', 'clean', 'reviewed', v_owner, now())
  returning id into v_receipt;
  insert into public.finance_receipt (organization_id, submitted_by, document_date, vendor, total_cents,
    gst_cents, qst_cents, storage_path, file_name, scan_status, status)
  values (v_org, v_staff, date '2026-10-21', 'Not reviewed yet', 1150, 50, 100,
    v_org || '/' || v_staff || '/tax-test-2.pdf', 'r2.pdf', 'clean', 'submitted');
  insert into public.finance_receipt (organization_id, submitted_by, document_date, vendor, total_cents,
    gst_cents, qst_cents, storage_path, file_name, scan_status, status, reviewed_by, reviewed_at)
  values (v_org, v_staff, date '2026-10-22', 'Post office stamps', 1000, 0, 0,
    v_org || '/' || v_staff || '/tax-test-3.pdf', 'r3.pdf', 'clean', 'reviewed', v_owner, now());

  perform tests.authenticate(v_owner, 'aal2');
  v_rows := public.sales_tax_import_receipts(v_org, date '2026-10-01', date '2026-12-31');
  perform tests.ok(v_rows = 1, format('only the reviewed receipt with tax comes in (%s)', v_rows));
  v_rows := public.sales_tax_import_receipts(v_org, date '2026-10-01', date '2026-12-31');
  perform tests.ok(v_rows = 0, 'importing again brings nothing twice');
  select * into r from public.sales_tax_line where source_type = 'finance_receipt' and source_id = v_receipt;
  perform tests.ok(r.amount_cents = 5000 and r.gst_cents = 250 and r.qst_cents = 499
    and r.itc_cents = 250 and r.itr_cents = 499 and r.direction = 'purchase',
    'a receipt becomes a purchase: amount before tax, tax paid and claimed');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Who sees the lines
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  insert into public.ledger_reader (organization_id, user_id) values (v_org, v_staff);
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.sales_tax_line where organization_id = v_org;
  perform tests.ok(v_rows = 6, format('a ledger reader sees the tax lines (%s)', v_rows));
  perform tests.tax_raises(format('select public.sales_tax_delete_line(%L)', v_sale),
    'administrator', 'a ledger reader cannot delete a tax line');
  perform tests.tax_raises(format(
    'select public.sales_tax_import_receipts(%L, date ''2026-10-01'', date ''2026-12-31'')', v_org),
    'administrator', 'a ledger reader cannot import receipts');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Period totals equal the sum of their lines
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  select coalesce(sum(t.gst_cents) filter (where t.direction = 'sale'), 0),
         coalesce(sum(t.itc_cents) filter (where t.direction = 'purchase'), 0)
    into v_sum, v_sum2
  from public.sales_tax_totals(v_org, date '2026-10-01', date '2026-12-31') t;
  perform tests.ok(v_sum = (select sum(gst_cents) from public.sales_tax_line
    where organization_id = v_org and direction = 'sale' and transaction_date between '2026-10-01' and '2026-12-31'),
    'GST collected in the totals equals the sum of the sale lines');
  perform tests.ok(v_sum = 1000 and v_sum2 = 1000 + 8 + 250,
    format('GST collected 1000 and claimed 1258 (%s, %s)', v_sum, v_sum2));
  select sum(line_count) into v_rows from public.sales_tax_totals(v_org, date '2026-10-01', date '2026-12-31');
  perform tests.ok(v_rows = 6, 'every line of the period is counted once');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_rows from public.sales_tax_totals(v_org, date '2026-10-01', date '2026-12-31');
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 0, 'totals are empty for someone who may not read the ledger');

  -- ---------------------------------------------------------------------
  -- Closing a period
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2026-10-01');
  if not exists (select 1 from public.ledger_settings where organization_id = v_org and chart_approved_on is not null) then
    perform public.ledger_record_chart_approval(v_org, date '2026-09-20', 'Jeanne Comptable, CPA');
  end if;
  v_period := public.sales_tax_create_period(v_org, date '2026-10-01', date '2026-12-31');
  perform tests.tax_raises(format(
    'select public.sales_tax_create_period(%L, date ''2026-12-01'', date ''2027-02-28'')', v_org),
    'cannot overlap', 'tax periods cannot overlap');
  perform tests.tax_raises(format(
    'select public.sales_tax_create_period(%L, date ''2027-02-01'', date ''2027-01-01'')', v_org),
    'on or before', 'a tax period ends after it starts');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_staff, 'aal1');
  perform tests.tax_raises(format('select public.sales_tax_close_period(%L)', v_period),
    'administrator', 'a ledger reader cannot close a tax period');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal2');
  v_entry := public.sales_tax_close_period(v_period);
  perform tests.clear_auth(); reset role;

  select * into r from public.journal_entry where id = v_entry;
  perform tests.ok(r.status = 'posted' and r.entry_date = date '2026-12-31'
    and r.source_type = 'sales_tax_period' and r.source_id = v_period,
    'closing posts one entry dated the last day of the period, linked to it');
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0) into v_sum, v_sum2
  from public.journal_line where entry_id = v_entry;
  perform tests.ok(v_sum = v_sum2 and v_sum > 0, format('the closing entry balances (%s = %s)', v_sum, v_sum2));
  perform tests.ok((select l.debit_cents from public.journal_line l join public.ledger_account a on a.id = l.account_id
    where l.entry_id = v_entry and a.code = '2200') = 1000, 'GST collected is cleared from GST payable');
  perform tests.ok((select l.credit_cents from public.journal_line l join public.ledger_account a on a.id = l.account_id
    where l.entry_id = v_entry and a.code = '1200') = 1258, 'input tax credits are cleared from GST receivable');
  perform tests.ok((select l.debit_cents from public.journal_line l join public.ledger_account a on a.id = l.account_id
    where l.entry_id = v_entry and a.code = '2220') = 258, 'a GST refund of $2.58 is a debit to net GST');
  -- QST: collected 1995 (on $200 of sales), claimed 1995 + 15 + 499 = 2509.
  perform tests.ok((select l.debit_cents from public.journal_line l join public.ledger_account a on a.id = l.account_id
    where l.entry_id = v_entry and a.code = '2230') = 2509 - 1995, 'the QST net is the difference, on its own account');
  perform tests.ok(exists (select 1 from public.sales_tax_period where id = v_period and status = 'closed'
    and gst_collected_cents = 1000 and gst_claimed_cents = 1258 and closing_entry_id = v_entry and closed_by = v_owner),
    'the period keeps the figures it posted');

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_line(%L, null, ''sale'', ''standard'', date ''2026-11-30'', ''Late'', null, null, 100)', v_org),
    'is closed', 'no line can be added to a closed period');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_line(%L, %L, ''sale'', ''standard'', date ''2027-01-10'', ''Moved'', null, null, 100)', v_org, v_sale),
    'is closed', 'a line cannot be moved out of a closed period');
  perform tests.tax_raises(format('select public.sales_tax_delete_line(%L)', v_purchase),
    'is closed', 'a line of a closed period cannot be deleted');
  perform tests.tax_raises(format('select public.sales_tax_close_period(%L)', v_period),
    'already closed', 'a period closes once');
  perform tests.clear_auth(); reset role;
  perform tests.tax_raises(format('update public.sales_tax_line set amount_cents = 1 where id = %L', v_sale),
    'is closed', 'even the table owner cannot change a closed period''s lines');

  -- Reopening reverses the closing entry and unfreezes the lines.
  perform tests.authenticate(v_owner, 'aal2');
  perform public.sales_tax_reopen_period(v_period, date '2027-01-05');
  perform tests.clear_auth(); reset role;
  perform tests.ok(exists (select 1 from public.journal_entry where reverses_entry_id = v_entry
    and status = 'posted' and entry_date = date '2027-01-05'), 'reopening posts a reversal of the closing entry');
  perform tests.ok(exists (select 1 from public.sales_tax_period where id = v_period and status = 'open'
    and closing_entry_id is null and gst_collected_cents is null), 'the reopened period is open again');
  perform tests.authenticate(v_owner, 'aal2');
  perform public.sales_tax_delete_line(v_half);
  perform tests.ok(not exists (select 1 from public.sales_tax_line where id = v_half),
    'a reopened period''s lines can be corrected');
  -- A period with no tax closes without an entry.
  v_period2 := public.sales_tax_create_period(v_org, date '2027-01-01', date '2027-03-31');
  perform tests.ok(public.sales_tax_close_period(v_period2) is null, 'a period with no tax closes without an entry');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Isolation and audit
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  select count(*) into v_rows from public.sales_tax_line where organization_id = v_other_org;
  perform tests.ok(v_rows = 0, 'nobody reads another organization''s tax lines');
  perform tests.tax_raises(format(
    'select public.sales_tax_save_line(%L, null, ''sale'', ''standard'', date ''2026-10-05'', ''x'', null, null, 100)', v_other_org),
    'administrator', 'nobody writes another organization''s tax lines');
  perform tests.clear_auth(); reset role;

  begin
    set local role anon;
    perform public.sales_tax_totals(v_org, date '2026-10-01', date '2026-12-31');
    reset role;
    perform tests.ok(false, 'anon cannot call the tax totals');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call the tax totals');
  end;

  select count(*) into v_rows from public.audit_event where organization_id = v_org and event_type = 'sales_tax'
    and action in ('settings_saved', 'line_created', 'line_updated', 'line_deleted', 'receipts_imported',
                   'period_created', 'period_closed', 'period_reopened');
  perform tests.ok(v_rows >= 15, format('settings, lines, imports, closing and reopening are audited (%s)', v_rows));
end
$$;

rollback;
