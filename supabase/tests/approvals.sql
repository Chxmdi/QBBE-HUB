-- Approval routing (#143, migration 20260927200000): who may configure rules,
-- submit, decide, comment and withdraw; how items are routed; and that the
-- trail cannot be edited. Run after qa-users.sql and rls.sql. All mutations
-- are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_lead uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_pm uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
  v_org uuid;
  v_program uuid;
  v_rule uuid;
  v_small uuid;
  v_big uuid;
  v_own uuid;
  v_mid uuid;
  v_withdraw uuid;
  v_cover uuid;
  v_status text;
  v_count integer;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_volunteer, v_guest, v_lead, v_pm);
  -- Start from a clean slate of rules in case seed data added some.
  delete from public.approval_rule where organization_id = v_org;

  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Approvals fixture', 'approvals-fixture-' || substr(gen_random_uuid()::text, 1, 8), v_lead, v_owner)
  returning id into v_program;

  -- Rules: only owners and admins with MFA configure them.
  perform tests.authenticate(v_staff, 'aal1');
  begin
    insert into public.approval_rule (organization_id, approver_kind, label)
    values (v_org, 'admins', 'Staff rule');
    perform tests.ok(false, 'staff cannot create approval rules');
  exception when insufficient_privilege then
    perform tests.ok(true, 'staff cannot create approval rules');
  end;
  select count(*) into v_count from public.approval_rule where organization_id = v_org;
  perform tests.ok(v_count = 0, 'staff can read the (empty) rule list');

  perform tests.authenticate(v_admin, 'aal1');
  begin
    insert into public.approval_rule (organization_id, approver_kind, label)
    values (v_org, 'admins', 'AAL1 rule');
    perform tests.ok(false, 'an admin without MFA cannot create approval rules');
  exception when insufficient_privilege then
    perform tests.ok(true, 'an admin without MFA cannot create approval rules');
  end;

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_count from public.approval_rule where organization_id = v_org;
  perform tests.ok(v_count = 0, 'volunteers read no rules');

  perform tests.authenticate(v_admin, 'aal2');
  -- Under $500: the program lead. $500 and up: the executive director (the
  -- owner). $5,000 and up: plus the treasurer (the admin) at step 2.
  insert into public.approval_rule (organization_id, max_amount_cents, step, approver_kind, label)
  values (v_org, 50000, 1, 'program_lead', 'Program lead');
  insert into public.approval_rule (organization_id, min_amount_cents, step, approver_kind, approver_user_id, label)
  values (v_org, 50000, 1, 'person', v_owner, 'Executive director');
  insert into public.approval_rule (organization_id, min_amount_cents, step, approver_kind, approver_user_id, label)
  values (v_org, 500000, 2, 'person', v_admin, 'Treasurer')
  returning id into v_rule;
  perform tests.ok(v_rule is not null, 'an admin with MFA creates approval rules');

  begin
    insert into public.approval_rule (organization_id, approver_kind, approver_user_id, label)
    values (v_org, 'person', v_volunteer, 'Volunteer approver');
    perform tests.ok(false, 'a volunteer cannot be named as an approver');
  exception when check_violation then
    perform tests.ok(true, 'a volunteer cannot be named as an approver');
  end;
  begin
    insert into public.approval_rule (organization_id, min_amount_cents, max_amount_cents, approver_kind, label)
    values (v_org, 1000, 500, 'admins', 'Backwards');
    perform tests.ok(false, 'a rule range must go upwards');
  exception when check_violation then
    perform tests.ok(true, 'a rule range must go upwards');
  end;
  begin
    insert into public.approval_rule (organization_id, approver_kind, label)
    values (v_org, 'person', 'Nobody named');
    perform tests.ok(false, 'a person rule must name the person');
  exception when check_violation then
    perform tests.ok(true, 'a person rule must name the person');
  end;

  -- Submitting: staff yes, volunteers and guests no.
  perform tests.authenticate(v_volunteer, 'aal1');
  begin
    perform public.submit_approval(v_org, 'expense_claim', 'Volunteer claim', 1000);
    perform tests.ok(false, 'volunteers cannot submit for approval');
  exception when insufficient_privilege then
    perform tests.ok(true, 'volunteers cannot submit for approval');
  end;
  perform tests.authenticate(v_guest, 'aal1');
  begin
    perform public.submit_approval(v_org, 'expense_claim', 'Guest claim', 1000);
    perform tests.ok(false, 'guests cannot submit for approval');
  exception when insufficient_privilege then
    perform tests.ok(true, 'guests cannot submit for approval');
  end;

  perform tests.authenticate(v_staff, 'aal1');
  begin
    insert into public.approval_item (organization_id, subject_type, title, amount_cents, requested_by)
    values (v_org, 'other', 'Direct insert', 0, v_staff);
    perform tests.ok(false, 'items cannot be written directly');
  exception when insufficient_privilege then
    perform tests.ok(true, 'items cannot be written directly');
  end;
  begin
    perform public.submit_approval(v_org, 'purchase', 'No amount');
    perform tests.ok(false, 'a purchase needs an amount');
  exception when check_violation then
    perform tests.ok(true, 'a purchase needs an amount');
  end;

  -- $120 claim in the program: routed to the program lead only.
  v_small := public.submit_approval(v_org, 'expense_claim', 'Snacks for the workshop', 12000, v_program);
  select count(*) into v_count from public.approval_step
  where item_id = v_small and approver_id = v_lead and step = 1 and approver_kind = 'person';
  perform tests.ok(v_count = 1, 'under $500 routes to the program lead');
  select count(*) into v_count from public.approval_step where item_id = v_small;
  perform tests.ok(v_count = 1, 'under $500 has a single step');
  select count(*) into v_count from public.approval_event where item_id = v_small and kind = 'submitted';
  perform tests.ok(v_count = 1, 'submitting writes the trail');

  begin
    update public.approval_item set status = 'approved' where id = v_small;
    perform tests.ok(false, 'the requester cannot change the status directly');
  exception when insufficient_privilege then
    perform tests.ok(true, 'the requester cannot change the status directly');
  end;
  begin
    perform public.decide_approval(v_small, 'approve');
    perform tests.ok(false, 'nobody approves their own request');
  exception when insufficient_privilege then
    perform tests.ok(true, 'nobody approves their own request');
  end;
  perform tests.authenticate(v_pm, 'aal1');
  select count(*) into v_count from public.approval_item where id = v_small;
  perform tests.ok(v_count = 0, 'an unrelated staff member cannot see the item');
  begin
    perform public.decide_approval(v_small, 'approve');
    perform tests.ok(false, 'an unrelated staff member cannot decide');
  exception when insufficient_privilege then
    perform tests.ok(true, 'an unrelated staff member cannot decide');
  end;
  begin
    perform public.comment_on_approval(v_small, 'Hello?');
    perform tests.ok(false, 'an unrelated staff member cannot comment');
  exception when insufficient_privilege then
    perform tests.ok(true, 'an unrelated staff member cannot comment');
  end;

  perform tests.authenticate(v_lead, 'aal1');
  select count(*) into v_count from public.approval_inbox() where id = v_small;
  perform tests.ok(v_count = 1, 'the item is in the program lead''s inbox');
  select count(*) into v_count from public.notification
  where user_id = v_lead and source_id = v_small and category = 'approval';
  perform tests.ok(v_count = 1, 'the program lead is notified');
  begin
    perform public.withdraw_approval(v_small);
    perform tests.ok(false, 'only the requester withdraws');
  exception when insufficient_privilege then
    perform tests.ok(true, 'only the requester withdraws');
  end;
  begin
    perform public.decide_approval(v_small, 'reject', '   ');
    perform tests.ok(false, 'a rejection needs a reason');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'a rejection needs a reason');
  end;
  perform public.comment_on_approval(v_small, 'Which workshop?');
  v_status := public.decide_approval(v_small, 'approve', 'Fine');
  perform tests.ok(v_status = 'approved', 'the program lead approves');
  select count(*) into v_count from public.approval_item
  where id = v_small and decided_by = v_lead and decided_at is not null and status = 'approved';
  perform tests.ok(v_count = 1, 'the database records who decided and when');
  begin
    perform public.decide_approval(v_small, 'reject', 'Changed my mind');
    perform tests.ok(false, 'a settled item cannot be decided again');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'a settled item cannot be decided again');
  end;

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.notification
  where user_id = v_staff and source_id = v_small and title like 'Approved:%';
  perform tests.ok(v_count = 1, 'the requester is told it was approved');
  select count(*) into v_count from public.notification
  where user_id = v_staff and source_id = v_small and title like 'Question on:%';
  perform tests.ok(v_count = 1, 'the requester is told about a question');

  -- $6,000 purchase: the director at step 1, then the treasurer at step 2.
  v_big := public.submit_approval(v_org, 'purchase', 'Laptop for the office', 600000, v_program);
  select count(*) into v_count from public.approval_step where item_id = v_big;
  perform tests.ok(v_count = 2, 'over $5,000 has two steps');
  select count(*) into v_count from public.approval_item where id = v_big and current_step = 1;
  perform tests.ok(v_count = 1, 'the first step opens first');

  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_count from public.approval_inbox() where id = v_big;
  perform tests.ok(v_count = 0, 'step 2 is not in the treasurer''s inbox before step 1 is done');
  select count(*) into v_count from public.notification where user_id = v_admin and source_id = v_big;
  perform tests.ok(v_count = 0, 'the treasurer is not notified before step 1 is done');

  perform tests.authenticate(v_owner, 'aal2');
  select count(*) into v_count from public.approval_inbox() where id = v_big;
  perform tests.ok(v_count = 1, 'step 1 is in the director''s inbox');
  v_status := public.decide_approval(v_big, 'approve');
  perform tests.ok(v_status = 'pending', 'after step 1 the item is still pending');
  select count(*) into v_count from public.approval_item where id = v_big and current_step = 2;
  perform tests.ok(v_count = 1, 'step 2 opens after step 1');
  begin
    perform public.decide_approval(v_big, 'approve');
    perform tests.ok(false, 'one person cannot approve two steps');
  exception when insufficient_privilege then
    perform tests.ok(true, 'one person cannot approve two steps');
  end;

  perform tests.authenticate(v_admin, 'aal1');
  begin
    perform public.decide_approval(v_big, 'approve');
    perform tests.ok(false, 'a named admin without MFA cannot decide');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a named admin without MFA cannot decide');
  end;

  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_count from public.notification
  where user_id = v_admin and source_id = v_big and category = 'approval';
  perform tests.ok(v_count = 1, 'the treasurer is notified when step 2 opens');
  v_status := public.decide_approval(v_big, 'approve', 'Budgeted');
  perform tests.ok(v_status = 'approved', 'the treasurer completes a two-step approval');

  -- A program lead's own claim is never routed to themselves.
  perform tests.authenticate(v_lead, 'aal1');
  v_own := public.submit_approval(v_org, 'expense_claim', 'Lead''s own taxi', 4500, v_program);
  select count(*) into v_count from public.approval_step
  where item_id = v_own and approver_kind = 'admins' and approver_id is null;
  perform tests.ok(v_count = 1, 'a lead''s own claim falls back to the administrators');
  begin
    perform public.decide_approval(v_own, 'approve');
    perform tests.ok(false, 'the lead cannot approve their own claim');
  exception when insufficient_privilege then
    perform tests.ok(true, 'the lead cannot approve their own claim');
  end;

  -- $700 contract: the director rejects it, with a reason.
  perform tests.authenticate(v_staff, 'aal1');
  v_mid := public.submit_approval(v_org, 'contract', 'Caterer contract', 70000);
  perform tests.authenticate(v_owner, 'aal2');
  v_status := public.decide_approval(v_mid, 'reject', 'Get a second quote');
  perform tests.ok(v_status = 'rejected', 'the director rejects');
  select count(*) into v_count from public.approval_item
  where id = v_mid and decision_note = 'Get a second quote' and decided_by = v_owner;
  perform tests.ok(v_count = 1, 'the rejection reason and decider are kept');
  begin
    perform public.comment_on_approval(v_mid, 'Late comment');
    perform tests.ok(false, 'a settled item takes no more comments');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'a settled item takes no more comments');
  end;

  -- Withdrawing, and one open approval per record.
  perform tests.authenticate(v_staff, 'aal1');
  v_withdraw := public.submit_approval(v_org, 'bill', 'Hydro bill', 30000, null, null,
    '11111111-2222-3333-4444-555555555555');
  begin
    perform public.submit_approval(v_org, 'bill', 'Hydro bill again', 30000, null, null,
      '11111111-2222-3333-4444-555555555555');
    perform tests.ok(false, 'a record has one open approval at a time');
  exception when unique_violation then
    perform tests.ok(true, 'a record has one open approval at a time');
  end;
  v_status := public.withdraw_approval(v_withdraw, 'Paid by the landlord');
  perform tests.ok(v_status = 'withdrawn', 'the requester withdraws');
  select count(*) into v_count from public.approval_step where item_id = v_withdraw and status = 'pending';
  perform tests.ok(v_count = 0, 'withdrawing cancels the open steps');

  -- No rule matched ($300 bill has no program lead): an administrator decides.
  select count(*) into v_count from public.approval_step
  where item_id = v_withdraw and approver_kind = 'admins';
  perform tests.ok(v_count = 1, 'with no program lead the step goes to the administrators');

  -- An owner or admin with MFA may cover for an absent approver; it stays out
  -- of their own inbox, and the trail records who actually decided.
  v_cover := public.submit_approval(v_org, 'expense_claim', 'Bus tickets', 3000, v_program);
  perform public.comment_on_approval(v_cover, 'Receipt is in the envelope');
  perform tests.authenticate(v_lead, 'aal1');
  select count(*) into v_count from public.notification
  where user_id = v_lead and source_id = v_cover and title like 'Reply on:%';
  perform tests.ok(v_count = 1, 'the approver is told about the requester''s reply');
  perform tests.authenticate(v_admin, 'aal1');
  select count(*) into v_count from public.approval_item where id = v_cover;
  perform tests.ok(v_count = 0, 'an admin without MFA does not see other people''s items');
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_count from public.approval_inbox() where id = v_cover;
  perform tests.ok(v_count = 0, 'another person''s step is not in an admin''s inbox');
  v_status := public.decide_approval(v_cover, 'approve', 'Covering while the lead is away');
  perform tests.ok(v_status = 'approved', 'an admin with MFA can cover for the named approver');
  select count(*) into v_count from public.approval_step
  where item_id = v_cover and approver_id = v_lead and decided_by = v_admin;
  perform tests.ok(v_count = 1, 'the step records the admin as the one who decided');

  perform tests.authenticate(v_staff, 'aal1');
  -- The trail cannot be edited or deleted by anyone signed in, nor edited by
  -- the server.
  begin
    update public.approval_event set note = 'edited' where item_id = v_small;
    perform tests.ok(false, 'signed-in users cannot edit the trail');
  exception when insufficient_privilege then
    perform tests.ok(true, 'signed-in users cannot edit the trail');
  end;
  begin
    delete from public.approval_event where item_id = v_small;
    perform tests.ok(false, 'signed-in users cannot delete the trail');
  exception when insufficient_privilege then
    perform tests.ok(true, 'signed-in users cannot delete the trail');
  end;
  select count(*) into v_count from public.approval_event where item_id = v_small;
  perform tests.ok(v_count = 4, 'the requester reads the full trail (submitted, commented, approved, completed)');

  perform tests.clear_auth();
  reset role;
  begin
    update public.approval_event set note = 'edited' where item_id = v_small;
    perform tests.ok(false, 'even the server cannot edit the trail');
  exception when insufficient_privilege then
    perform tests.ok(true, 'even the server cannot edit the trail');
  end;
  select count(*) into v_count from public.audit_event
  where object_type = 'approval_item' and object_id = v_big and action in ('submitted', 'approved');
  perform tests.ok(v_count = 3, 'submit and each approval write an audit event');
  select count(*) into v_count from public.approval_step where item_id = v_big and decided_by is not null;
  perform tests.ok(v_count = 2, 'two different people approved the two steps');
end;
$$;

rollback;
