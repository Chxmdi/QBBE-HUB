-- An entry posted by a gift, bill, invoice or payment is undone only from that
-- record (migration 20261118100000). Proves: reversing such an entry directly
-- in the ledger is refused, so the record and the ledger cannot drift apart;
-- the record's own void or reversal still works; a manual entry is still
-- reversed in the ledger; an ordinary entry still cannot be dated in a closed
-- period. All mutations are rolled back.
begin;

-- Runs a statement and asserts it fails with a message containing p_pattern.
-- The guard runs at commit, so deferred checks are forced to run here.
create function tests.lsr_raises(p_sql text, p_pattern text, p_msg text)
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
grant execute on function tests.lsr_raises(text, text, text) to authenticated, anon;

-- Runs a statement and asserts it succeeds, deferred checks included.
create function tests.lsr_ok(p_sql text, p_msg text)
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
  perform tests.ok(v_error is null, format('%s (%s)', p_msg, coalesce(v_error, 'ok')));
end;
$$;
grant execute on function tests.lsr_ok(text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_gen uuid;
  v_bank uuid;
  v_donations uuid;
  v_supplies uuid;
  v_membership uuid;
  v_donor uuid;
  v_vendor uuid;
  v_customer uuid;
  v_gift uuid;
  v_bill uuid;
  v_invoice uuid;
  v_payment uuid;
  v_entry uuid;
  v_manual uuid;
  v_period uuid;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';
  select id into strict v_bank from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_donations from public.ledger_account where organization_id = v_org and code = '4200';
  select id into strict v_supplies from public.ledger_account where organization_id = v_org and code = '5300';
  select id into strict v_membership from public.ledger_account where organization_id = v_org and code = '4300';
  insert into public.crm_contact (organization_id, full_name) values (v_org, 'Reversal Test Donor')
  returning id into v_donor;
  insert into public.finance_contact (organization_id, name, is_vendor) values (v_org, 'Reversal vendor', true)
  returning id into v_vendor;
  insert into public.finance_contact (organization_id, name, is_customer) values (v_org, 'Reversal customer', true)
  returning id into v_customer;

  perform tests.authenticate(v_admin, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2026-01-01');
  perform public.ledger_record_chart_approval(v_org, date '2026-01-02', 'Accountant');

  -- ---------------------------------------------------------------------
  -- A gift
  -- ---------------------------------------------------------------------
  v_gift := public.gift_record(v_org, jsonb_build_object(
    'gift_type', 'donation', 'crm_contact_id', v_donor, 'received_on', '2026-03-15',
    'amount_cents', 25000, 'fund_id', v_gen, 'debit_account_id', v_bank, 'credit_account_id', v_donations));
  select journal_entry_id into strict v_entry from public.gift where id = v_gift;
  perform tests.lsr_raises(format('select public.ledger_reverse_entry(%L, date ''2026-03-20'', null)', v_entry),
    'void the gift', 'a gift''s entry cannot be reversed in the ledger');
  perform tests.lsr_ok(format('select public.gift_void(%L, date ''2026-03-20'', ''Entered twice'')', v_gift),
    'the gift can still be voided, which reverses its entry');
  select * into r from public.gift where id = v_gift;
  perform tests.ok(r.status = 'voided' and r.void_entry_id is not null
    and exists (select 1 from public.journal_entry e where e.id = r.void_entry_id and e.reverses_entry_id = v_entry),
    'the void is recorded on the gift and points at the reversal');

  -- ---------------------------------------------------------------------
  -- A bill
  -- ---------------------------------------------------------------------
  v_bill := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'bill_date', '2026-04-05', 'due_date', '2026-05-05', 'fund_id', v_gen),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'description', 'Paper', 'amount_cents', 40000)));
  v_entry := public.finance_post_bill(v_bill);
  perform tests.lsr_raises(format('select public.ledger_reverse_entry(%L, date ''2026-04-10'', null)', v_entry),
    'void the bill', 'a bill''s entry cannot be reversed in the ledger');
  perform tests.ok((select status = 'posted' and void_entry_id is null from public.finance_bill where id = v_bill),
    'the refused reversal left the bill as it was');
  perform tests.lsr_ok(format('select public.finance_void_document(''bill'', %L, date ''2026-04-10'', ''Duplicate'')', v_bill),
    'the bill can still be voided');
  perform tests.ok((select status = 'void' from public.finance_bill where id = v_bill), 'the bill is void');

  -- ---------------------------------------------------------------------
  -- An invoice and its payment
  -- ---------------------------------------------------------------------
  v_invoice := public.finance_save_invoice(v_org, null, jsonb_build_object('customer_id', v_customer,
    'invoice_date', '2026-05-01', 'due_date', '2026-05-31', 'fund_id', v_gen),
    jsonb_build_array(jsonb_build_object('account_id', v_membership, 'description', 'Dues', 'amount_cents', 10000)));
  v_entry := public.finance_post_invoice(v_invoice);
  perform tests.lsr_raises(format('select public.ledger_reverse_entry(%L, date ''2026-05-02'', null)', v_entry),
    'void the invoice', 'an invoice''s entry cannot be reversed in the ledger');

  v_payment := public.finance_record_payment('invoice', v_invoice, date '2026-05-10', 10000, v_bank, 'eft');
  select journal_entry_id into strict v_entry from public.finance_payment where id = v_payment;
  perform tests.lsr_raises(format('select public.ledger_reverse_entry(%L, date ''2026-05-11'', null)', v_entry),
    'reverse the payment', 'a payment''s entry cannot be reversed in the ledger');
  perform tests.ok((select paid_cents = 10000 from public.finance_invoice where id = v_invoice),
    'the refused reversal left the invoice paid');
  perform tests.lsr_ok(format('select public.finance_reverse_payment(%L, date ''2026-05-11'', ''Bounced'')', v_payment),
    'the payment can still be reversed');
  perform tests.ok((select paid_cents = 0 from public.finance_invoice where id = v_invoice),
    'reversing the payment leaves the invoice owing again');

  -- ---------------------------------------------------------------------
  -- Manual entries and closed periods are unchanged
  -- ---------------------------------------------------------------------
  v_manual := public.ledger_save_draft(v_org, null, date '2026-06-15', 'Manual', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_supplies, 'fund_id', v_gen, 'debit_cents', 500),
    jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 500)));
  perform public.ledger_post_entry(v_manual);
  perform tests.lsr_ok(format('select public.ledger_reverse_entry(%L, date ''2026-06-16'', null)', v_manual),
    'a manual entry is still reversed in the ledger');

  select id into strict v_period from public.ledger_period where organization_id = v_org and starts_on = date '2026-01-01';
  perform public.ledger_set_period_status(v_period, 'closed');
  perform tests.lsr_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2026-01-20'', ''late'', ''standard'', %L::jsonb)', v_org,
    jsonb_build_array(
      jsonb_build_object('account_id', v_supplies, 'fund_id', v_gen, 'debit_cents', 100),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 100))),
    'closed', 'an ordinary entry still cannot be dated in a closed period');
  perform tests.clear_auth(); reset role;
end;
$$;

rollback;
