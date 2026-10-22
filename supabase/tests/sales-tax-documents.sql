-- Posted bills and invoices feed the GST/QST return (migration 20261118110000).
-- Proves: posting an invoice writes one sale line and posting a bill one
-- purchase line, with the claimable share; closing the tax period then clears
-- the tax accounts (1200, 1210, 2200, 2210) the documents posted to; voiding a
-- document in an open period removes its line; an invoice cannot charge a tax
-- the organization is not registered for, or an amount more than a cent away
-- from the rate; voiding after the period closed is still allowed and leaves
-- the filed line; a receipt attached to a bill is not imported as well; staff
-- read the registration numbers printed on invoices, other organizations do
-- not. Dated 2031 so no other test's periods are in the way. All mutations are
-- rolled back.
begin;

create function tests.std_raises(p_sql text, p_pattern text, p_msg text)
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
grant execute on function tests.std_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_other_org uuid;
  v_gen uuid;
  v_supplies uuid;
  v_membership uuid;
  v_vendor uuid;
  v_customer uuid;
  v_invoice uuid;
  v_bill uuid;
  v_bill2 uuid;
  v_invoice2 uuid;
  v_receipt uuid;
  v_period uuid;
  v_rows integer;
  v_sum bigint;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.organization (name, slug) values ('Tax docs other org', 'tax-docs-other-org')
  returning id into v_other_org;
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';
  select id into strict v_supplies from public.ledger_account where organization_id = v_org and code = '5300';
  select id into strict v_membership from public.ledger_account where organization_id = v_org and code = '4300';
  insert into public.finance_contact (organization_id, name, is_vendor) values (v_org, 'Tax docs vendor', true)
  returning id into v_vendor;
  insert into public.finance_contact (organization_id, name, is_customer) values (v_org, 'Tax docs customer', true)
  returning id into v_customer;

  perform tests.authenticate(v_admin, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2031-01-01');
  perform public.ledger_record_chart_approval(v_org, date '2026-01-02', 'Accountant');

  -- ---------------------------------------------------------------------
  -- Not registered: an invoice cannot charge tax
  -- ---------------------------------------------------------------------
  perform public.sales_tax_save_settings(v_org, false, null, false, null, 'quarterly', 10000, false);
  v_invoice := public.finance_save_invoice(v_org, null, jsonb_build_object('customer_id', v_customer,
    'invoice_date', '2031-02-10', 'due_date', '2031-03-12', 'fund_id', v_gen, 'gst_cents', 500, 'qst_cents', 998),
    jsonb_build_array(jsonb_build_object('account_id', v_membership, 'description', 'Dues', 'amount_cents', 10000)));
  perform tests.std_raises(format('select public.finance_post_invoice(%L)', v_invoice),
    'not registered for GST', 'an invoice cannot charge GST while the organization is not registered');

  -- ---------------------------------------------------------------------
  -- Registered: the amounts are checked against the rate
  -- ---------------------------------------------------------------------
  perform public.sales_tax_save_settings(v_org, true, '123456789 RT0001', true, '1234567890 TQ0001',
    'quarterly', 5000, false);
  perform public.finance_save_invoice(v_org, v_invoice, jsonb_build_object('customer_id', v_customer,
    'invoice_date', '2031-02-10', 'due_date', '2031-03-12', 'fund_id', v_gen, 'gst_cents', 700, 'qst_cents', 998),
    jsonb_build_array(jsonb_build_object('account_id', v_membership, 'description', 'Dues', 'amount_cents', 10000)));
  perform tests.std_raises(format('select public.finance_post_invoice(%L)', v_invoice),
    'GST on this invoice can be at most 5.00', 'an invoice cannot charge more GST than the rate gives');
  perform public.finance_save_invoice(v_org, v_invoice, jsonb_build_object('customer_id', v_customer,
    'invoice_date', '2031-02-10', 'due_date', '2031-03-12', 'fund_id', v_gen, 'gst_cents', 500, 'qst_cents', 998),
    jsonb_build_array(jsonb_build_object('account_id', v_membership, 'description', 'Dues', 'amount_cents', 10000)));
  perform public.finance_post_invoice(v_invoice);

  select * into r from public.sales_tax_line where source_type = 'finance_invoice' and source_id = v_invoice;
  perform tests.ok(r.direction = 'sale' and r.tax_code = 'standard' and r.amount_cents = 10000
    and r.gst_cents = 500 and r.qst_cents = 998 and r.transaction_date = date '2031-02-10'
    and r.counterparty = 'Tax docs customer',
    'posting an invoice writes its sale line: amount before tax, GST and QST collected');

  -- A bill: tax paid, half of it claimable (itc_claim_bp 5000).
  v_bill := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'bill_date', '2031-02-12', 'due_date', '2031-03-14', 'fund_id', v_gen, 'gst_cents', 1000, 'qst_cents', 1995),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'description', 'Paper', 'amount_cents', 20000)));
  perform public.finance_post_bill(v_bill);
  select * into r from public.sales_tax_line where source_type = 'finance_bill' and source_id = v_bill;
  perform tests.ok(r.direction = 'purchase' and r.amount_cents = 20000 and r.gst_cents = 1000 and r.qst_cents = 1995
    and r.itc_cents = 500 and r.itr_cents = 998,
    format('posting a bill writes its purchase line with the claimable share (%s, %s)', r.itc_cents, r.itr_cents));

  -- A bill without tax writes no line.
  v_bill2 := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'bill_date', '2031-02-13', 'due_date', '2031-03-14', 'fund_id', v_gen),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'description', 'Stamps', 'amount_cents', 900)));
  perform public.finance_post_bill(v_bill2);
  perform tests.ok(not exists (select 1 from public.sales_tax_line where source_id = v_bill2),
    'a bill without tax writes no tax line');

  -- Voiding in an open period removes the line.
  perform public.finance_void_document('bill', v_bill2, date '2031-02-14', 'Duplicate');
  v_bill2 := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'bill_date', '2031-02-15', 'due_date', '2031-03-14', 'fund_id', v_gen, 'gst_cents', 50, 'qst_cents', 100),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'description', 'Ink', 'amount_cents', 1000)));
  perform public.finance_post_bill(v_bill2);
  perform tests.ok(exists (select 1 from public.sales_tax_line where source_id = v_bill2), 'the second bill has a line');
  perform public.finance_void_document('bill', v_bill2, date '2031-02-16', 'Entered by mistake');
  perform tests.ok(not exists (select 1 from public.sales_tax_line where source_id = v_bill2),
    'voiding a bill in an open tax period removes its line');

  -- A partly exempt invoice: half the amount taxed. The line records the
  -- taxed part.
  v_invoice2 := public.finance_save_invoice(v_org, null, jsonb_build_object('customer_id', v_customer,
    'invoice_date', '2031-02-11', 'due_date', '2031-03-12', 'fund_id', v_gen, 'gst_cents', 250, 'qst_cents', 499),
    jsonb_build_array(
      jsonb_build_object('account_id', v_membership, 'description', 'Workshop (taxable)', 'amount_cents', 5000),
      jsonb_build_object('account_id', v_membership, 'description', 'Dues (exempt)', 'amount_cents', 5000)));
  perform public.finance_post_invoice(v_invoice2);
  select * into r from public.sales_tax_line where source_id = v_invoice2;
  perform tests.ok(r.amount_cents = 5000 and r.gst_cents = 250 and r.qst_cents = 499,
    format('a partly exempt invoice posts and its line records the taxed part (%s)', r.amount_cents));
  perform public.finance_void_document('invoice', v_invoice2, date '2031-02-12', 'Test');

  -- A receipt imported first, then attached to a bill: the bill takes the
  -- line over, and voiding the bill removes it.
  perform tests.clear_auth(); reset role;
  insert into public.finance_receipt (organization_id, submitted_by, kind, document_date, vendor, total_cents,
    gst_cents, qst_cents, storage_path, file_name, scan_status, status, reviewed_by, reviewed_at)
  values (v_org, v_staff, 'bill', date '2031-02-18', 'Imported first', 2299, 100, 199,
    v_org || '/' || v_staff || '/tax-docs-0.pdf', 'r0.pdf', 'clean', 'reviewed', v_owner, now())
  returning id into v_receipt;
  perform tests.authenticate(v_admin, 'aal2');
  v_rows := public.sales_tax_import_receipts(v_org, date '2031-01-01', date '2031-03-31');
  perform tests.ok(v_rows = 1, 'the unattached receipt is imported');
  v_bill2 := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor, 'receipt_id', v_receipt,
    'bill_date', '2031-02-18', 'due_date', '2031-03-18', 'fund_id', v_gen, 'gst_cents', 100, 'qst_cents', 199),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'description', 'Toner', 'amount_cents', 2000)));
  perform public.finance_post_bill(v_bill2);
  perform tests.ok((select count(*) = 1 from public.sales_tax_line
    where (source_type = 'finance_receipt' and source_id = v_receipt) or source_id = v_bill2)
    and exists (select 1 from public.sales_tax_line where source_type = 'finance_bill' and source_id = v_bill2),
    'posting the bill takes over its receipt''s line: one line, now the bill''s');
  perform public.finance_void_document('bill', v_bill2, date '2031-02-19', 'Duplicate');
  perform tests.ok(not exists (select 1 from public.sales_tax_line
    where (source_type = 'finance_receipt' and source_id = v_receipt) or source_id = v_bill2),
    'voiding that bill leaves no line claiming its tax');
  v_rows := public.sales_tax_import_receipts(v_org, date '2031-01-01', date '2031-03-31');
  perform tests.ok(v_rows = 0, 'the receipt of a voided bill is not imported again');

  -- A receipt attached to a bill is not imported on top of the bill.
  perform tests.clear_auth(); reset role;
  insert into public.finance_receipt (organization_id, submitted_by, kind, document_date, vendor, total_cents,
    gst_cents, qst_cents, storage_path, file_name, scan_status, status, reviewed_by, reviewed_at)
  values (v_org, v_staff, 'bill', date '2031-02-20', 'Receipt for a bill', 11498, 500, 998,
    v_org || '/' || v_staff || '/tax-docs-1.pdf', 'r.pdf', 'clean', 'reviewed', v_owner, now())
  returning id into v_receipt;
  perform tests.authenticate(v_admin, 'aal2');
  perform public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor, 'receipt_id', v_receipt,
    'bill_date', '2031-02-20', 'due_date', '2031-03-20', 'fund_id', v_gen, 'gst_cents', 500, 'qst_cents', 998),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'description', 'Chairs', 'amount_cents', 10000)));
  v_rows := public.sales_tax_import_receipts(v_org, date '2031-01-01', date '2031-03-31');
  perform tests.ok(v_rows = 0, format('a receipt attached to a bill is not imported (%s)', v_rows));

  -- ---------------------------------------------------------------------
  -- The return and the close
  -- ---------------------------------------------------------------------
  select count(*) into v_rows from public.sales_tax_totals(v_org, date '2031-01-01', date '2031-03-31');
  perform tests.ok(v_rows = 2, format('the worksheet has a sale and a purchase total (%s)', v_rows));
  v_period := public.sales_tax_create_period(v_org, date '2031-01-01', date '2031-03-31');
  perform public.sales_tax_close_period(v_period, null);
  select * into r from public.sales_tax_period where id = v_period;
  perform tests.ok(r.gst_collected_cents = 500 and r.qst_collected_cents = 998
    and r.gst_claimed_cents = 500 and r.qst_claimed_cents = 998,
    'closing the period records the tax collected on the invoice and claimed on the bill');

  -- Collected tax is cleared from 2200/2210, the claimed share from 1200/1210.
  -- Only this quarter's movement counts: other data may sit in earlier years.
  select coalesce(sum(t.balance_cents), 0) - coalesce((select sum(b.balance_cents)
    from public.ledger_trial_balance(v_org, date '2030-12-31') b where b.code in ('2200', '2210')), 0)
  into v_sum from public.ledger_trial_balance(v_org, date '2031-03-31') t
  where t.code in ('2200', '2210');
  perform tests.ok(v_sum = 0, format('the collected-tax accounts are cleared (%s)', v_sum));
  select coalesce(sum(t.balance_cents), 0) - coalesce((select sum(b.balance_cents)
    from public.ledger_trial_balance(v_org, date '2030-12-31') b where b.code in ('1200', '1210')), 0)
  into v_sum from public.ledger_trial_balance(v_org, date '2031-03-31') t
  where t.code in ('1200', '1210');
  perform tests.ok(v_sum = 1497, format('only the unclaimable half of the tax paid stays in 1200/1210 (%s)', v_sum));

  -- A bill dated in the filed quarter is reported in the next open return.
  v_bill2 := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'bill_date', '2031-03-20', 'due_date', '2031-04-20', 'fund_id', v_gen, 'gst_cents', 100, 'qst_cents', 200),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'description', 'Late bill', 'amount_cents', 2000)));
  perform public.finance_post_bill(v_bill2);
  perform tests.ok((select transaction_date = date '2031-04-01' from public.sales_tax_line where source_id = v_bill2),
    'a document dated in a filed tax period is reported in the next open one');

  -- Voiding after the return is closed is still allowed, as before; the line
  -- stays on the closed return (how to correct a filed return is the
  -- accountant's call).
  perform public.finance_void_document('invoice', v_invoice, date '2031-04-02', 'Cancelled after filing');
  perform tests.ok(exists (select 1 from public.sales_tax_line where source_id = v_invoice),
    'voiding a document after its tax period closed leaves the filed line in place');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Registration numbers for the printed invoice
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select * into r from public.finance_tax_registration(v_org, date '2031-02-10');
  perform tests.ok(r.gst_number = '123456789 RT0001' and r.qst_number = '1234567890 TQ0001'
    and r.gst_rate = 5 and r.qst_rate = 9.975,
    'staff read the registration numbers and rates printed on an invoice');
  perform tests.std_raises(format('select * from public.finance_tax_registration(%L, current_date)', v_other_org),
    'not', 'nobody reads another organization''s registration');
  perform tests.clear_auth(); reset role;
end;
$$;

rollback;
