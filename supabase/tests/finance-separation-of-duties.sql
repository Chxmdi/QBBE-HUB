-- Separation of duties on bills (migration 20261123000000). Proves: the
-- person who drafted a bill, or changed the draft, cannot approve or reject
-- it, even when someone else sent it for approval and even when they are its
-- named approver or an administrator; only the drafter or an administrator
-- sends a bill for approval; an approval no longer covers a bill whose expense account, fund
-- or payable account changed after it was sent. Run after qa-users.sql and
-- rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_clerk uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_gen uuid;
  v_other_fund uuid;
  v_rent uuid;
  v_supplies uuid;
  v_payable uuid;
  v_accrued uuid;
  v_vendor uuid;
  v_header jsonb;
  v_lines jsonb;
  v_bill uuid;
  v_admin_bill uuid;
  v_item uuid;
  v_error text;
  v_state text;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';
  select id into strict v_rent from public.ledger_account where organization_id = v_org and code = '5200';
  select id into strict v_supplies from public.ledger_account where organization_id = v_org and code = '5300';
  select id into strict v_payable from public.ledger_account where organization_id = v_org and code = '2000';
  select id into strict v_accrued from public.ledger_account where organization_id = v_org and code = '2100';
  delete from public.approval_rule where organization_id = v_org;
  -- Bills go to the clerk by name.
  insert into public.approval_rule (organization_id, subject_type, approver_kind, approver_user_id, label)
  values (v_org, 'bill', 'person', v_clerk, 'Finance clerk');

  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2026-10-01');
  perform public.ledger_record_chart_approval(v_org, date '2026-09-20', 'Jeanne Comptable, CPA');
  perform public.finance_set_bill_approval_threshold(v_org, 100000);
  insert into public.ledger_fund (organization_id, code, name, restriction)
  values (v_org, 'SODFUND', 'Separation test fund', 'unrestricted') returning id into v_other_fund;
  perform tests.clear_auth(); reset role;

  -- The named approver drafts a bill; the owner sends it for approval.
  perform tests.authenticate(v_clerk, 'aal1');
  insert into public.finance_contact (organization_id, name, is_vendor)
  values (v_org, 'Separation vendor', true) returning id into v_vendor;
  v_header := jsonb_build_object('vendor_id', v_vendor, 'vendor_reference', 'SOD-1',
    'bill_date', '2026-10-15', 'due_date', '2026-11-15', 'fund_id', v_gen);
  v_lines := jsonb_build_array(jsonb_build_object('account_id', v_rent,
    'description', 'October rent', 'amount_cents', 250000));
  v_bill := public.finance_save_bill(v_org, null, v_header, v_lines);
  perform tests.clear_auth(); reset role;

  -- Staff who did not draft it cannot send it.
  perform tests.authenticate(v_staff, 'aal1');
  begin
    perform public.finance_request_bill_approval(v_bill);
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(coalesce(v_error, '') ilike '%drafted it or an administrator%',
    'someone who neither drafted the bill nor administers the organization cannot send it for approval');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal2');
  v_item := public.finance_request_bill_approval(v_bill);
  perform tests.ok(v_item is not null, 'an administrator sends someone else''s draft for approval');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_clerk, 'aal1');
  perform tests.ok(not exists (select 1 from public.approval_inbox() where id = v_item),
    'the bill is not in its drafter''s inbox, though they are its named approver');
  begin
    perform public.decide_approval(v_item, 'approve');
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(coalesce(v_error, '') ilike '%drafted this bill%', 'the drafter cannot approve a bill someone else sent');
  begin
    perform public.decide_approval(v_item, 'reject', 'Not mine to judge');
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(coalesce(v_error, '') ilike '%drafted this bill%', 'the drafter cannot reject it either');
  perform tests.clear_auth(); reset role;
  perform tests.ok((select status from public.approval_item where id = v_item) = 'pending',
    'the request is still waiting after the drafter''s attempts');

  -- An administrator who did not draft it decides, covering the clerk.
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(public.decide_approval(v_item, 'approve') = 'approved',
    'an administrator who did not draft the bill approves it');
  perform tests.ok(public.finance_bill_approval_status(v_bill) = 'approved', 'the bill shows it is approved');
  perform tests.clear_auth(); reset role;

  -- Re-coding after approval: the approval no longer covers the bill.
  perform tests.authenticate(v_clerk, 'aal1');
  perform public.finance_save_bill(v_org, v_bill, v_header, jsonb_build_array(jsonb_build_object(
    'account_id', v_supplies, 'description', 'October rent', 'amount_cents', 250000)));
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(public.finance_bill_approval_status(v_bill) = 'changed',
    'changing a line''s expense account after approval marks it out of date');
  begin
    perform public.finance_post_bill(v_bill);
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(coalesce(v_error, '') ilike '%needs an approval%', 'a re-coded bill does not post on the old approval');
  perform tests.clear_auth(); reset role;

  -- Back to the approved coding: the approval applies again.
  perform tests.authenticate(v_clerk, 'aal1');
  perform public.finance_save_bill(v_org, v_bill, v_header, v_lines);
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(public.finance_bill_approval_status(v_bill) = 'approved',
    'restoring the approved coding restores the approval');
  perform tests.clear_auth(); reset role;

  -- Another fund.
  perform tests.authenticate(v_clerk, 'aal1');
  perform public.finance_save_bill(v_org, v_bill, v_header || jsonb_build_object('fund_id', v_other_fund), v_lines);
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(public.finance_bill_approval_status(v_bill) = 'changed',
    'changing the fund after approval marks it out of date');
  perform tests.clear_auth(); reset role;

  -- Another payable account.
  perform tests.authenticate(v_clerk, 'aal1');
  perform public.finance_save_bill(v_org, v_bill, v_header || jsonb_build_object('payable_account_id', v_accrued), v_lines);
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(public.finance_bill_approval_status(v_bill) = 'changed',
    'changing the payable account after approval marks it out of date');
  perform tests.clear_auth(); reset role;

  -- The drafter sends the current version; the administrator approves; it posts.
  perform tests.authenticate(v_clerk, 'aal1');
  perform public.finance_save_bill(v_org, v_bill, v_header || jsonb_build_object('payable_account_id', v_payable), v_lines);
  v_item := public.finance_request_bill_approval(v_bill);
  perform tests.ok(v_item is not null, 'the drafter sends their own bill for approval');
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  perform public.decide_approval(v_item, 'approve');
  perform public.finance_post_bill(v_bill);
  select status into v_state from public.finance_bill where id = v_bill;
  perform tests.ok(v_state = 'posted', 'approved by someone other than its drafter, the bill posts');

  -- An administrator's own draft: they send it, and still cannot decide it.
  v_admin_bill := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'vendor_reference', 'SOD-2', 'bill_date', '2026-10-16', 'due_date', '2026-11-16', 'fund_id', v_gen),
    jsonb_build_array(jsonb_build_object('account_id', v_rent, 'amount_cents', 180000)));
  v_item := public.finance_request_bill_approval(v_admin_bill);
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  begin
    perform public.decide_approval(v_item, 'approve');
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(v_error is not null, 'an administrator cannot approve the bill they drafted and sent');
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_clerk, 'aal1');
  perform tests.ok(public.decide_approval(v_item, 'approve') = 'approved',
    'the named approver decides an administrator''s bill');
  perform tests.clear_auth(); reset role;

  -- An administrator who rewrote someone else's draft counts as its drafter.
  perform tests.authenticate(v_clerk, 'aal1');
  v_bill := public.finance_save_bill(v_org, null, jsonb_build_object('vendor_id', v_vendor,
    'vendor_reference', 'SOD-3', 'bill_date', '2026-10-17', 'due_date', '2026-11-17', 'fund_id', v_gen),
    jsonb_build_array(jsonb_build_object('account_id', v_rent, 'amount_cents', 300000)));
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  perform public.finance_save_bill(v_org, v_bill, jsonb_build_object('vendor_id', v_vendor,
    'vendor_reference', 'SOD-3', 'bill_date', '2026-10-17', 'due_date', '2026-11-17', 'fund_id', v_gen),
    jsonb_build_array(jsonb_build_object('account_id', v_supplies, 'amount_cents', 900000)));
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_clerk, 'aal1');
  v_item := public.finance_request_bill_approval(v_bill);
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  begin
    perform public.decide_approval(v_item, 'approve');
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform tests.ok(coalesce(v_error, '') ilike '%drafted this bill%',
    'an administrator who changed someone else''s draft cannot approve it');
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(public.decide_approval(v_item, 'approve') = 'approved',
    'an administrator who did not touch it can');
  perform tests.clear_auth(); reset role;

  -- Other kinds of approval are untouched: the rule above only covers bills.
  perform tests.authenticate(v_clerk, 'aal1');
  v_item := public.submit_approval(v_org, 'purchase', 'Printer paper', 4000, null, null, null);
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(public.decide_approval(v_item, 'approve') = 'approved',
    'approvals other than bills decide as before');
  perform tests.clear_auth(); reset role;
end;
$$;

rollback;
