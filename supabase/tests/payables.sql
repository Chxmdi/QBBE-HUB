-- Payables and receivables (#150; migration 20260928100000). Proves: staff
-- draft and only admins with MFA post, pay and void; every step posts a
-- balanced ledger entry; a bill is never paid twice or beyond its total; the
-- same vendor invoice cannot be entered twice; posted documents and payments
-- keep their figures; aging adds up to the payable and receivable account
-- balances on every date tested; other organizations and volunteers see
-- nothing. Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

create function tests.ap_raises(p_sql text, p_pattern text, p_msg text)
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
grant execute on function tests.ap_raises(text, text, text) to authenticated, anon;

-- Aging total for p_kind on p_as_of next to the ledger balance of the
-- control accounts, as the caller sees them. Payables are credit balances,
-- so their ledger balance is negated.
create function tests.ap_aging_matches(p_org uuid, p_kind text, p_as_of date, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_aging bigint;
  v_ledger bigint;
begin
  select coalesce(sum(open_cents), 0) into v_aging from public.finance_aging(p_org, p_kind, p_as_of);
  select coalesce(sum(t.balance_cents), 0) * case when p_kind = 'bill' then -1 else 1 end into v_ledger
  from public.ledger_trial_balance(p_org, p_as_of) t
  where t.account_id in (
    select payable_account_id from public.finance_bill where p_kind = 'bill' and payable_account_id is not null
    union
    select receivable_account_id from public.finance_invoice where p_kind = 'invoice' and receivable_account_id is not null);
  perform tests.ok(v_aging = v_ledger, format('%s (aging %s, ledger %s)', p_msg, v_aging, v_ledger));
end;
$$;
grant execute on function tests.ap_aging_matches(uuid, text, date, text) to authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_other_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_other_org uuid;
  v_gen uuid;
  v_bank uuid;
  v_ap uuid;
  v_ar uuid;
  v_grants_ar uuid;
  v_rent uuid;
  v_supplies uuid;
  v_membership uuid;
  v_grant_rev uuid;
  v_vendor uuid;
  v_customer uuid;
  v_other_vendor uuid;
  v_bill uuid;
  v_bill2 uuid;
  v_invoice uuid;
  v_invoice2 uuid;
  v_entry uuid;
  v_payment uuid;
  v_payment2 uuid;
  v_rows integer;
  v_sum bigint;
  v_sum2 bigint;
  v_text text;
  r record;
  v_header jsonb;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_volunteer, v_other_staff);
  insert into public.organization (name, slug) values ('Payables other org', 'payables-other-org')
  returning id into v_other_org;
  insert into public.finance_contact (organization_id, name, is_vendor)
  values (v_other_org, 'Other org vendor', true) returning id into v_other_vendor;

  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';
  select id into strict v_bank from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_ar from public.ledger_account where organization_id = v_org and code = '1100';
  select id into strict v_grants_ar from public.ledger_account where organization_id = v_org and code = '1150';
  select id into strict v_ap from public.ledger_account where organization_id = v_org and code = '2000';
  select id into strict v_rent from public.ledger_account where organization_id = v_org and code = '5200';
  select id into strict v_supplies from public.ledger_account where organization_id = v_org and code = '5300';
  select id into strict v_membership from public.ledger_account where organization_id = v_org and code = '4300';
  select id into strict v_grant_rev from public.ledger_account where organization_id = v_org and code = '4010';

  -- The books are open for 2026-10 onward and the chart is approved.
  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2026-10-01');
  perform public.ledger_record_chart_approval(v_org, date '2026-09-20', 'Jeanne Comptable, CPA');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Contacts
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.finance_contact (organization_id, name, is_vendor, gst_number)
  values (v_org, 'Papeterie Laval', true, '123456789RT0001') returning id into v_vendor;
  insert into public.finance_contact (organization_id, name, is_customer, language)
  values (v_org, 'Fondation du Québec', true, 'fr') returning id into v_customer;
  select count(*) into v_rows from public.finance_contact where organization_id = v_other_org;
  perform tests.ok(v_rows = 0, 'staff do not see another organization''s contacts');
  perform tests.ap_raises(format(
    'insert into public.finance_contact (organization_id, name, is_vendor) values (%L, ''x'', true)', v_other_org),
    'row-level security', 'staff cannot add contacts to another organization');
  perform tests.ap_raises(format(
    'insert into public.finance_contact (organization_id, name) values (%L, ''Nobody'')', v_org),
    'finance_contact_has_role', 'a contact is a vendor, a customer or both');
  perform tests.clear_auth(); reset role;
  perform tests.ok((select created_by from public.finance_contact where id = v_vendor) = v_staff,
    'the creator is recorded by the database');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_rows from public.finance_contact;
  perform tests.ok(v_rows = 0, 'volunteers see no contacts');
  select count(*) into v_rows from public.finance_bill;
  perform tests.ok(v_rows = 0, 'volunteers see no bills');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Drafting a bill (staff)
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.finance_posting_choices(v_org) where choice = 'account';
  perform tests.ok(v_rows >= 50, 'staff see account names to draft with, without reading the ledger');
  select count(*) into v_rows from public.ledger_account where organization_id = v_org;
  perform tests.ok(v_rows = 0, 'staff still cannot read the ledger itself');

  v_header := jsonb_build_object('vendor_id', v_vendor, 'vendor_reference', 'F-1001',
    'bill_date', '2026-10-05', 'due_date', '2026-11-04', 'memo', 'Office supplies',
    'fund_id', v_gen, 'gst_cents', 1500, 'qst_cents', 2993);
  v_bill := public.finance_save_bill(v_org, null, v_header, jsonb_build_array(
    jsonb_build_object('account_id', v_supplies, 'description', 'Paper', 'amount_cents', 20000),
    jsonb_build_object('account_id', v_rent, 'description', 'Storage', 'amount_cents', 10000)));
  perform tests.ok((select total_cents from public.finance_bill where id = v_bill) = 34493,
    'a bill totals its lines plus GST and QST');
  perform tests.ap_raises(format('select public.finance_post_bill(%L)', v_bill),
    'administrator', 'staff cannot post a bill');
  perform tests.ap_raises(format(
    'update public.finance_bill set paid_cents = 34493 where id = %L', v_bill),
    'permission denied', 'staff cannot write bills directly');
  perform tests.ap_raises(format(
    'select public.finance_save_bill(%L, null, %L::jsonb, ''[]''::jsonb)', v_org,
      jsonb_build_object('vendor_id', v_other_vendor, 'bill_date', '2026-10-05', 'due_date', '2026-10-05')),
    'vendor of this organization', 'a bill cannot name another organization''s vendor');
  perform tests.ap_raises(format(
    'select public.finance_save_bill(%L, null, %L::jsonb, ''[]''::jsonb)', v_org,
      jsonb_build_object('vendor_id', v_vendor, 'bill_date', '2026-10-05', 'due_date', '2026-10-01')),
    'finance_bill_due_after_bill', 'a bill is not due before it is dated');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_other_staff, 'aal1');
  perform tests.ap_raises(format('select public.finance_save_bill(%L, %L, %L::jsonb, ''[]''::jsonb)',
    v_org, v_bill, v_header), 'Only the person who drafted', 'another staff member cannot change someone''s draft');
  perform tests.ap_raises(format('select public.finance_delete_draft(''bill'', %L)', v_bill),
    'Only the person who drafted', 'another staff member cannot delete someone''s draft');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Posting a bill (admin with MFA)
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ap_raises(format('select public.finance_post_bill(%L)', v_bill),
    'administrator', 'an owner without MFA cannot post');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  v_entry := public.finance_post_bill(v_bill);
  perform tests.clear_auth(); reset role;

  select count(*), sum(debit_cents), sum(credit_cents) into v_rows, v_sum, v_sum2
  from public.journal_line where entry_id = v_entry;
  perform tests.ok(v_rows = 5 and v_sum = 34493 and v_sum2 = 34493,
    format('posting a bill writes a balanced entry of two expenses, GST, QST and payable (%s lines)', v_rows));
  perform tests.ok(exists (select 1 from public.journal_line l join public.ledger_account a on a.id = l.account_id
    where l.entry_id = v_entry and a.code = '1200' and l.debit_cents = 1500), 'GST goes to GST receivable (1200)');
  perform tests.ok(exists (select 1 from public.journal_line l join public.ledger_account a on a.id = l.account_id
    where l.entry_id = v_entry and a.code = '1210' and l.debit_cents = 2993), 'QST goes to QST receivable (1210)');
  perform tests.ok(exists (select 1 from public.journal_line l
    where l.entry_id = v_entry and l.account_id = v_ap and l.credit_cents = 34493), 'the total is credited to accounts payable');
  perform tests.ok(exists (select 1 from public.journal_entry e where e.id = v_entry and e.status = 'posted'
    and e.source_type = 'finance_bill' and e.source_id = v_bill and e.entry_date = date '2026-10-05'),
    'the entry is posted on the bill date and names the bill as its source');
  perform tests.ok((select status from public.finance_bill where id = v_bill) = 'posted', 'the bill is posted');

  -- Posted figures are part of the record, for the table owner too.
  perform tests.ap_raises(format('update public.finance_bill set gst_cents = 0 where id = %L', v_bill),
    'keeps its figures', 'a posted bill''s figures cannot change');
  perform tests.ap_raises(format('update public.finance_bill_line set amount_cents = 1 where bill_id = %L', v_bill),
    'cannot change', 'a posted bill''s lines cannot change');
  perform tests.ap_raises(format('delete from public.finance_bill where id = %L', v_bill),
    'cannot be deleted', 'a posted bill cannot be deleted');

  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ap_raises(format('select public.finance_save_bill(%L, %L, %L::jsonb, ''[]''::jsonb)',
    v_org, v_bill, v_header), 'keeps its figures', 'a posted bill cannot be re-drafted');
  -- The same vendor invoice cannot be entered again.
  perform tests.ap_raises(format('select public.finance_save_bill(%L, null, %L::jsonb, %L::jsonb)',
    v_org, v_header || jsonb_build_object('vendor_reference', ' f-1001 '),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'amount_cents', 100))),
    'uq_finance_bill_vendor_reference', 'the same vendor invoice number cannot be entered twice');
  -- A second bill, no taxes, due sooner.
  v_bill2 := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'vendor_reference', 'F-1002', 'bill_date', '2026-10-10', 'due_date', '2026-10-10', 'fund_id', v_gen),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'amount_cents', 5000)));
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Paying: never twice, never more than owing
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ap_raises(format(
    'select public.finance_record_payment(''bill'', %L, date ''2026-10-20'', 100, %L, ''eft'')', v_bill, v_bank),
    'administrator', 'staff cannot record payments');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ap_raises(format(
    'select public.finance_record_payment(''bill'', %L, date ''2026-10-20'', 100, %L, ''eft'')', v_bill2, v_bank),
    'Only a posted', 'a draft bill cannot be paid');
  perform public.finance_post_bill(v_bill2);
  perform tests.ap_raises(format(
    'select public.finance_record_payment(''bill'', %L, date ''2026-10-20'', 34494, %L, ''eft'')', v_bill, v_bank),
    'more than the bill still owing', 'a payment above the total is refused');
  perform tests.ap_raises(format(
    'select public.finance_record_payment(''bill'', %L, date ''2026-10-01'', 100, %L, ''eft'')', v_bill, v_bank),
    'on or after', 'a payment cannot predate the bill');
  perform tests.ap_raises(format(
    'select public.finance_record_payment(''bill'', %L, date ''2026-10-20'', 100, %L, ''eft'')', v_bill, v_rent),
    'asset', 'a bill is paid from an asset (bank) account');
  v_payment := public.finance_record_payment('bill', v_bill, date '2026-10-20', 20000, v_bank, 'eft', 'EFT-1');
  perform tests.ap_raises(format(
    'select public.finance_record_payment(''bill'', %L, date ''2026-10-21'', 14494, %L, ''eft'')', v_bill, v_bank),
    'more than the bill still owing', 'a second payment cannot exceed what is left');
  v_payment2 := public.finance_record_payment('bill', v_bill, date '2026-11-15', 14493, v_bank, 'cheque', '000123');
  perform tests.ok((select status || ':' || paid_cents from public.finance_bill where id = v_bill) = 'paid:34493',
    'paying the rest marks the bill paid');
  perform tests.ap_raises(format(
    'select public.finance_record_payment(''bill'', %L, date ''2026-11-16'', 1, %L, ''eft'')', v_bill, v_bank),
    'already paid in full', 'a paid bill cannot be paid again');
  perform tests.clear_auth(); reset role;

  select sum(l.debit_cents) filter (where l.account_id = v_ap), sum(l.credit_cents) filter (where l.account_id = v_bank)
    into v_sum, v_sum2
  from public.journal_line l join public.journal_entry e on e.id = l.entry_id
  where e.source_type = 'finance_payment' and e.source_id in (v_payment, v_payment2);
  perform tests.ok(v_sum = 34493 and v_sum2 = 34493, 'payments debit accounts payable and credit the bank');

  perform tests.ap_raises(format('update public.finance_bill set paid_cents = 40000 where id = %L', v_bill),
    'finance_bill_paid_within_total', 'even the table owner cannot record more paid than the total');
  perform tests.ap_raises(format('update public.finance_payment set amount_cents = 1 where id = %L', v_payment),
    'cannot be changed', 'a payment cannot be edited');
  perform tests.ap_raises(format('delete from public.finance_payment where id = %L', v_payment),
    'cannot be deleted', 'a payment cannot be deleted');

  -- Two payments racing for the last dollar: the row lock serializes them,
  -- and the constraint refuses the loser even if the function were bypassed.
  perform tests.ap_raises(format(
    'insert into public.finance_payment (organization_id, bill_id, paid_on, amount_cents, bank_account_id, method, journal_entry_id)
     values (%L, %L, date ''2026-11-20'', 5000, %L, ''eft'', %L); select app.finance_refresh_paid(''bill'', %L)',
    v_org, v_bill, v_bank, v_entry, v_bill),
    'finance_bill_paid_within_total', 'an extra payment written behind the function still cannot overpay');

  -- ---------------------------------------------------------------------
  -- Invoices (receivables)
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  v_invoice := public.finance_save_invoice(v_org, null, jsonb_build_object('customer_id', v_customer,
    'language', 'fr', 'invoice_date', '2026-10-01', 'due_date', '2026-10-31', 'fund_id', v_gen,
    'receivable_account_id', v_grants_ar),
    jsonb_build_array(jsonb_build_object('account_id', v_grant_rev, 'description', 'Subvention 2026-2027, versement 1',
      'amount_cents', 500000)));
  v_invoice2 := public.finance_save_invoice(v_org, null, jsonb_build_object('customer_id', v_customer,
    'language', 'en', 'invoice_date', '2026-10-15', 'due_date', '2026-10-15', 'fund_id', v_gen,
    'gst_cents', 250, 'qst_cents', 499),
    jsonb_build_array(jsonb_build_object('account_id', v_membership, 'description', 'Membership 2027',
      'amount_cents', 5000)));
  perform tests.ap_raises(format('select public.finance_save_invoice(%L, null, %L::jsonb, ''[]''::jsonb)',
    v_org, jsonb_build_object('customer_id', v_vendor, 'invoice_date', '2026-10-01', 'due_date', '2026-10-01')),
    'customer of this organization', 'an invoice goes to a customer');
  perform tests.ap_raises(format('select public.finance_post_invoice(%L)', v_invoice),
    'administrator', 'staff cannot post an invoice');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  v_entry := public.finance_post_invoice(v_invoice);
  perform public.finance_post_invoice(v_invoice2);
  perform tests.ok((select invoice_number from public.finance_invoice where id = v_invoice) = 1
    and (select invoice_number from public.finance_invoice where id = v_invoice2) = 2,
    'posted invoices are numbered in order');
  perform tests.ok(exists (select 1 from public.journal_line l where l.entry_id = v_entry
    and l.account_id = v_grants_ar and l.debit_cents = 500000)
    and exists (select 1 from public.journal_line l where l.entry_id = v_entry
    and l.account_id = v_grant_rev and l.credit_cents = 500000),
    'a grant invoice debits grants receivable and credits the grant revenue');
  perform tests.ok(exists (select 1 from public.journal_line l join public.journal_entry e on e.id = l.entry_id
    join public.ledger_account a on a.id = l.account_id
    where e.source_id = v_invoice2 and a.code = '2210' and l.credit_cents = 499),
    'QST charged on an invoice is credited to QST payable (2210)');
  perform tests.ok((select receivable_account_id from public.finance_invoice where id = v_invoice2) = v_ar,
    'an invoice with no receivable account named uses accounts receivable (1100)');
  perform public.finance_record_payment('invoice', v_invoice, date '2026-11-10', 200000, v_bank, 'eft', 'Dépôt');
  perform tests.ap_raises(format(
    'select public.finance_record_payment(''invoice'', %L, date ''2026-11-10'', 300001, %L, ''eft'')', v_invoice, v_bank),
    'more than the invoice still owing', 'a receipt above what is owing is refused');
  perform tests.clear_auth(); reset role;

  select sum(l.debit_cents) filter (where l.account_id = v_bank), sum(l.credit_cents) filter (where l.account_id = v_grants_ar)
    into v_sum, v_sum2
  from public.journal_line l join public.journal_entry e on e.id = l.entry_id
  where e.source_type = 'finance_payment'
    and e.source_id in (select id from public.finance_payment where invoice_id = v_invoice);
  perform tests.ok(v_sum = 200000 and v_sum2 = 200000, 'a payment received debits the bank and credits the receivable');

  -- ---------------------------------------------------------------------
  -- Aging equals the ledger, on every date
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ap_aging_matches(v_org, 'bill', date '2026-10-04', 'AP aging equals the payable balance before any bill');
  perform tests.ap_aging_matches(v_org, 'bill', date '2026-10-12', 'AP aging equals the payable balance with two open bills');
  perform tests.ap_aging_matches(v_org, 'bill', date '2026-10-25', 'AP aging equals the payable balance after a part payment');
  perform tests.ap_aging_matches(v_org, 'bill', date '2027-01-15', 'AP aging equals the payable balance after paying in full');
  perform tests.ap_aging_matches(v_org, 'invoice', date '2026-10-20', 'AR aging equals the receivable balances before payment');
  perform tests.ap_aging_matches(v_org, 'invoice', date '2027-01-15', 'AR aging equals the receivable balances after a part payment');

  select sum(open_cents) into v_sum from public.finance_aging(v_org, 'bill', date '2026-10-25');
  perform tests.ok(v_sum = 14493 + 5000, format('open payables on 2026-10-25 are what is still owing (%s)', v_sum));
  select bucket into v_text from public.finance_aging(v_org, 'bill', date '2027-01-15') where document_id = v_bill2;
  perform tests.ok(v_text = '90+', format('a bill due 2026-10-10 is 90+ days past due on 2027-01-15 (%s)', v_text));
  select bucket into v_text from public.finance_aging(v_org, 'bill', date '2026-10-25') where document_id = v_bill;
  perform tests.ok(v_text = 'current', format('a bill not yet due is current (%s)', v_text));
  select bucket into v_text from public.finance_aging(v_org, 'invoice', date '2026-12-15') where document_id = v_invoice;
  perform tests.ok(v_text = '31-60', format('an invoice due 2026-10-31 is 31-60 days past due on 2026-12-15 (%s)', v_text));
  perform tests.ok(not exists (select 1 from public.finance_aging(v_org, 'bill', date '2027-01-15') where document_id = v_bill),
    'a paid bill is not in the aging');

  -- ---------------------------------------------------------------------
  -- Voids and reversals
  -- ---------------------------------------------------------------------
  perform tests.ap_raises(format('select public.finance_void_document(''bill'', %L, date ''2026-11-20'', ''Duplicate'')', v_bill),
    'Reverse the payments', 'a bill with payments cannot be voided');
  perform public.finance_reverse_payment(v_payment2, date '2026-11-25', 'Cheque returned');
  perform tests.ok((select status || ':' || paid_cents from public.finance_bill where id = v_bill) = 'posted:20000',
    'reversing a payment reopens the bill');
  perform tests.ap_raises(format('select public.finance_reverse_payment(%L, date ''2026-11-26'')', v_payment2),
    'already been reversed', 'a payment is reversed only once');
  perform public.finance_reverse_payment(v_payment, date '2026-11-25', 'Wrong bill');
  perform public.finance_void_document('bill', v_bill, date '2026-11-30', 'Entered in error');
  perform tests.ok((select status from public.finance_bill where id = v_bill) = 'void', 'the bill is void');
  perform tests.ap_raises(format('select public.finance_void_document(''bill'', %L, date ''2026-11-30'', ''again'')', v_bill),
    'already void', 'a bill is voided only once');
  perform tests.ap_raises(format('select public.finance_record_payment(''bill'', %L, date ''2026-12-01'', 1, %L, ''eft'')',
    v_bill, v_bank), 'Only a posted', 'a void bill cannot be paid');
  perform tests.ap_aging_matches(v_org, 'bill', date '2026-11-27', 'AP aging equals the payable balance after reversed payments');
  perform tests.ap_aging_matches(v_org, 'bill', date '2026-12-31', 'AP aging equals the payable balance after a void');
  perform tests.ap_aging_matches(v_org, 'bill', date '2026-11-10', 'AP aging on an earlier date still matches after the void');
  perform tests.clear_auth(); reset role;

  -- A voided vendor invoice number can be entered again, correctly.
  perform tests.authenticate(v_staff, 'aal1');
  perform public.finance_save_bill(v_org, null, v_header, jsonb_build_array(
    jsonb_build_object('account_id', v_supplies, 'amount_cents', 30000)));
  perform tests.ok(true, 'a void bill''s vendor number can be used again');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Approval threshold hook (#143)
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ap_raises(format('select public.finance_set_bill_approval_threshold(%L, 100000)', v_org),
    'administrator', 'staff cannot set the approval threshold');
  v_bill := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'vendor_reference', 'BIG-1', 'bill_date', '2026-10-15', 'due_date', '2026-11-15', 'fund_id', v_gen),
    jsonb_build_array(jsonb_build_object('account_id', v_rent, 'amount_cents', 250000)));
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  perform public.finance_set_bill_approval_threshold(v_org, 100000);
  perform tests.clear_auth(); reset role;

  if to_regclass('public.approval_item') is not null then
    perform tests.authenticate(v_admin, 'aal2');
    perform tests.ap_raises(format('select public.finance_post_bill(%L)', v_bill),
      'needs an approval', 'a bill over the threshold does not post without approval');
    perform tests.clear_auth(); reset role;
    perform tests.authenticate(v_staff, 'aal1');
    perform public.finance_request_bill_approval(v_bill);
    perform tests.clear_auth(); reset role;
    perform tests.ok(exists (select 1 from public.approval_item where subject_type = 'bill' and subject_id = v_bill
      and status = 'pending' and amount_cents = 250000), 'the bill is sent to approvals for its total');
    perform tests.authenticate(v_admin, 'aal2');
    execute 'select public.decide_approval((select id from public.approval_item where subject_id = $1), ''approve'')'
      using v_bill;
    perform public.finance_post_bill(v_bill);
    perform tests.clear_auth(); reset role;
    perform tests.ok((select status from public.finance_bill where id = v_bill) = 'posted',
      'once approved for its total, the bill posts');
  else
    perform tests.authenticate(v_staff, 'aal1');
    perform tests.ap_raises(format('select public.finance_request_bill_approval(%L)', v_bill),
      'not available', 'without the approvals engine, asking for approval says so');
    perform tests.clear_auth(); reset role;
    perform tests.authenticate(v_admin, 'aal2');
    perform public.finance_post_bill(v_bill);
    perform tests.clear_auth(); reset role;
    perform tests.ok((select status from public.finance_bill where id = v_bill) = 'posted',
      'without the approvals engine, an admin still posts a bill over the threshold');
  end if;

  -- ---------------------------------------------------------------------
  -- Reach
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.finance_aging(v_other_org, 'bill', date '2027-01-01');
  perform tests.ok(v_rows = 0, 'aging shows nothing of another organization');
  perform tests.ap_raises(format('select public.finance_posting_choices(%L)', v_other_org),
    'Only staff', 'staff cannot list another organization''s accounts');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.ap_raises(format('select public.finance_save_bill(%L, null, %L::jsonb, ''[]''::jsonb)', v_org, v_header),
    'Only staff', 'volunteers cannot draft bills');
  select count(*) into v_rows from public.finance_aging(v_org, 'invoice', date '2027-01-01');
  perform tests.ok(v_rows = 0, 'volunteers see no aging');
  perform tests.clear_auth(); reset role;

  begin
    set local role anon;
    perform public.finance_aging(v_org, 'bill', date '2027-01-01');
    reset role;
    perform tests.ok(false, 'anon cannot call the aging');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call the aging');
  end;

  select count(*) into v_rows from public.audit_event where organization_id = v_org and event_type = 'finance'
    and action in ('bill_posted', 'invoice_posted', 'bill_payment_recorded', 'invoice_payment_recorded',
                   'bill_payment_reversed', 'bill_voided', 'bill_approval_threshold_set');
  perform tests.ok(v_rows >= 10, format('posting, payments, reversals and voids are audited (%s)', v_rows));
end
$$;

rollback;
