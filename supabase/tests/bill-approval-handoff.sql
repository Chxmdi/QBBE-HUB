-- Approved bills hand off to the ledger (#143, #150; migration
-- 20260930150000). Proves: only the bill's own approval request unlocks
-- posting; changing what was approved needs a fresh approval, while changing
-- the bookkeeping coding does not; sending a changed bill again withdraws the
-- older waiting request; the people who post are told when a bill is ready;
-- deleting a draft withdraws its request. Run after qa-users.sql and rls.sql.
-- All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_gen uuid;
  v_rent uuid;
  v_supplies uuid;
  v_vendor uuid;
  v_vendor2 uuid;
  v_bill uuid;
  v_bill2 uuid;
  v_small uuid;
  v_forged uuid;
  v_first uuid;
  v_second uuid;
  v_third uuid;
  v_fourth uuid;
  v_header jsonb;
  v_lines jsonb;
  v_error text;
  v_count integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';
  select id into strict v_rent from public.ledger_account where organization_id = v_org and code = '5200';
  select id into strict v_supplies from public.ledger_account where organization_id = v_org and code = '5300';
  -- Approvals from other test files never route this file's bills.
  delete from public.approval_rule where organization_id = v_org;

  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2026-10-01');
  perform public.ledger_record_chart_approval(v_org, date '2026-09-20', 'Jeanne Comptable, CPA');
  perform public.finance_set_bill_approval_threshold(v_org, 100000);
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_staff, 'aal1');
  insert into public.finance_contact (organization_id, name, is_vendor)
  values (v_org, 'Handoff vendor', true) returning id into v_vendor;
  insert into public.finance_contact (organization_id, name, is_vendor)
  values (v_org, 'Handoff other vendor', true) returning id into v_vendor2;
  v_header := jsonb_build_object('vendor_id', v_vendor, 'vendor_reference', 'HO-1',
    'bill_date', '2026-10-15', 'due_date', '2026-11-15', 'fund_id', v_gen);
  v_lines := jsonb_build_array(jsonb_build_object('account_id', v_rent,
    'description', 'October rent', 'amount_cents', 250000));
  v_bill := public.finance_save_bill(v_org, null, v_header, v_lines);

  -- A bill under the threshold never waits for approval.
  v_small := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'vendor_reference', 'HO-SMALL', 'bill_date', '2026-10-15', 'due_date', '2026-11-15', 'fund_id', v_gen),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'amount_cents', 5000)));

  -- An approval submitted by hand, not through the bill, does not count.
  v_forged := public.submit_approval(v_org, 'bill', 'Looks like the bill', 250000, null, null, v_bill);
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform public.finance_post_bill(v_small);
  perform tests.ok((select status from public.finance_bill where id = v_small) = 'posted',
    'a bill under the threshold posts without approval');
  perform public.decide_approval(v_forged, 'approve');
  begin
    perform public.finance_post_bill(v_bill);
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(v_error ilike '%needs an approval%',
    'an approval submitted outside the bill does not unlock posting');
  perform tests.ok(public.finance_bill_approval_status(v_bill) is null,
    'the bill shows no approval of its own');
  perform tests.clear_auth(); reset role;

  -- Sent through the bill: pending, and not sent twice.
  perform tests.authenticate(v_staff, 'aal1');
  v_first := public.finance_request_bill_approval(v_bill);
  perform tests.ok(public.finance_bill_approval_status(v_bill) = 'pending', 'the bill''s own request is pending');
  begin
    perform public.finance_request_bill_approval(v_bill);
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(v_error ilike '%already waiting%', 'an unchanged bill is not sent twice');

  -- Recoding (another expense account) is not a change to what was approved.
  perform public.finance_save_bill(v_org, v_bill, v_header, jsonb_build_array(jsonb_build_object(
    'account_id', v_supplies, 'description', 'October rent', 'amount_cents', 250000)));
  perform tests.ok(public.finance_bill_approval_status(v_bill) = 'pending',
    'changing the expense account keeps the request');

  -- Changing a line's description is: the request is out of date, and sending
  -- again withdraws it.
  v_lines := jsonb_build_array(jsonb_build_object('account_id', v_supplies,
    'description', 'October rent and parking', 'amount_cents', 250000));
  perform public.finance_save_bill(v_org, v_bill, v_header, v_lines);
  perform tests.ok(public.finance_bill_approval_status(v_bill) = 'changed',
    'changing what was approved marks the request out of date');
  v_second := public.finance_request_bill_approval(v_bill);
  perform tests.clear_auth(); reset role;
  perform tests.ok((select status from public.approval_item where id = v_first) = 'withdrawn',
    'sending a changed bill again withdraws the older request');
  perform tests.ok(exists (select 1 from public.approval_event where item_id = v_first and kind = 'withdrawn'
      and note like 'The bill changed%'), 'the withdrawal is on the trail with its reason');
  perform tests.ok((select approval_item_id from public.finance_bill where id = v_bill) = v_second,
    'the bill now points at the new request');

  -- Approved: the people who post are told, and it posts only while unchanged.
  perform tests.authenticate(v_admin, 'aal2');
  perform public.decide_approval(v_second, 'approve');
  perform tests.ok(public.finance_bill_approval_status(v_bill) = 'approved', 'the bill shows it is approved');
  perform tests.clear_auth(); reset role;
  perform tests.ok(exists (select 1 from public.notification where user_id = v_owner
      and source_type = 'finance_bill' and source_id = v_bill and title like 'Ready to post:%'
      and link = '/finance/payables/bills/' || v_bill), 'the owner is told the bill is ready to post');
  perform tests.ok(not exists (select 1 from public.notification where user_id = v_admin
      and source_id = v_bill and title like 'Ready to post:%'), 'the approver who just decided is not told again');
  perform tests.ok(exists (select 1 from public.audit_event where object_id = v_bill
      and action = 'bill_approval_approved'), 'the hand-off is audited');

  perform tests.authenticate(v_staff, 'aal1');
  begin
    perform public.finance_request_bill_approval(v_bill);
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(v_error ilike '%already approved%', 'an approved, unchanged bill is not sent again');
  -- Same total, different vendor: the approval no longer applies.
  perform public.finance_save_bill(v_org, v_bill, v_header || jsonb_build_object('vendor_id', v_vendor2), v_lines);
  perform tests.ok(public.finance_bill_approval_status(v_bill) = 'changed',
    'changing the vendor after approval marks it out of date');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  begin
    perform public.finance_post_bill(v_bill);
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(v_error ilike '%needs an approval%', 'an approval for the old vendor does not post the new one');
  perform tests.clear_auth(); reset role;

  -- Approving an out-of-date request tells nobody it is ready.
  perform tests.authenticate(v_staff, 'aal1');
  v_third := public.finance_request_bill_approval(v_bill);
  perform tests.ok((select status from public.approval_item where id = v_second) = 'approved',
    'an approved request stays approved on the trail when the bill is sent again');
  perform public.finance_save_bill(v_org, v_bill, v_header || jsonb_build_object('vendor_id', v_vendor2),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'description', 'Rent', 'amount_cents', 250000)));
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  perform public.decide_approval(v_third, 'approve');
  perform tests.clear_auth(); reset role;
  select count(*) into v_count from public.notification
  where source_id = v_bill and title like 'Ready to post:%' and dedupe_key like '%' || v_third || '%';
  perform tests.ok(v_count = 0, 'approving an out-of-date request does not announce the bill as ready');

  -- The current version, approved, posts to the ledger.
  perform tests.authenticate(v_staff, 'aal1');
  v_fourth := public.finance_request_bill_approval(v_bill);
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  perform public.decide_approval(v_fourth, 'approve');
  perform public.finance_post_bill(v_bill);
  perform tests.clear_auth(); reset role;
  perform tests.ok((select status = 'posted' and journal_entry_id is not null from public.finance_bill where id = v_bill),
    'once its current version is approved, the bill posts to the ledger');

  -- Deleting a draft withdraws its waiting request.
  perform tests.authenticate(v_staff, 'aal1');
  v_bill2 := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'vendor_reference', 'HO-2', 'bill_date', '2026-10-16', 'due_date', '2026-11-16', 'fund_id', v_gen),
    jsonb_build_array(jsonb_build_object('account_id', v_rent, 'amount_cents', 180000)));
  v_first := public.finance_request_bill_approval(v_bill2);
  perform public.finance_delete_draft('bill', v_bill2);
  perform tests.clear_auth(); reset role;
  perform tests.ok((select status from public.approval_item where id = v_first) = 'withdrawn',
    'deleting a draft withdraws its waiting request');
  perform tests.ok(not exists (select 1 from public.approval_step where item_id = v_first and status = 'pending'),
    'the withdrawn request leaves no step waiting in anyone''s inbox');

  -- Nobody writes the link or the fingerprint directly.
  perform tests.authenticate(v_staff, 'aal1');
  begin
    update public.finance_bill set approval_item_id = v_forged where id = v_bill;
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(v_error is not null, 'the approval link cannot be written directly');
  perform tests.clear_auth(); reset role;
end;
$$;

rollback;
