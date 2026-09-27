-- Approval delegation while an approver is away (#143, migration
-- 20260930160000): who may set and end a delegation, what a delegate may and
-- may not decide, the "on behalf of" trail, no chains, the automatic end, the
-- notification and the audit events. Run after qa-users.sql and rls.sql. All
-- mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_lead uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_pm uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
  v_org uuid;
  v_program uuid;
  v_today date;
  v_delegation uuid;
  v_second uuid;
  v_before uuid;
  v_after uuid;
  v_own uuid;
  v_status text;
  v_count integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_volunteer, v_lead, v_pm);
  delete from public.approval_rule where organization_id = v_org;
  select (now() at time zone coalesce(o.timezone, 'America/Toronto'))::date into v_today
  from public.organization o where o.id = v_org;

  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Delegation fixture', 'delegation-fixture-' || substr(gen_random_uuid()::text, 1, 8), v_lead, v_owner)
  returning id into v_program;
  insert into public.approval_rule (organization_id, approver_kind, label)
  values (v_org, 'program_lead', 'Program lead');

  -- Waiting on the lead before any delegation exists.
  perform tests.authenticate(v_staff, 'aal1');
  v_before := public.submit_approval(v_org, 'expense_claim', 'Printer paper', 4000, v_program);

  -- Who may set a delegation.
  perform tests.authenticate(v_volunteer, 'aal1');
  begin
    perform public.set_approval_delegation(v_org, v_volunteer, v_staff, v_today, v_today + 7);
    perform tests.ok(false, 'volunteers cannot set a delegation');
  exception when insufficient_privilege then
    perform tests.ok(true, 'volunteers cannot set a delegation');
  end;
  perform tests.authenticate(v_pm, 'aal1');
  begin
    perform public.set_approval_delegation(v_org, v_lead, v_pm, v_today, v_today + 7);
    perform tests.ok(false, 'staff cannot set a delegation for someone else');
  exception when insufficient_privilege then
    perform tests.ok(true, 'staff cannot set a delegation for someone else');
  end;
  begin
    insert into public.approval_delegation (organization_id, approver_id, delegate_id,
      starts_on, ends_on, starts_at, ends_at)
    values (v_org, v_lead, v_pm, v_today, v_today + 7, now(), now() + interval '7 days');
    perform tests.ok(false, 'delegations cannot be written directly');
  exception when insufficient_privilege then
    perform tests.ok(true, 'delegations cannot be written directly');
  end;
  perform tests.authenticate(v_admin, 'aal1');
  begin
    perform public.set_approval_delegation(v_org, v_lead, v_pm, v_today, v_today + 7);
    perform tests.ok(false, 'an admin without MFA cannot set a delegation for someone else');
  exception when insufficient_privilege then
    perform tests.ok(true, 'an admin without MFA cannot set a delegation for someone else');
  end;

  -- What a delegation may be.
  perform tests.authenticate(v_lead, 'aal1');
  begin
    perform public.set_approval_delegation(v_org, v_lead, v_volunteer, v_today, v_today + 7);
    perform tests.ok(false, 'a volunteer cannot be a delegate');
  exception when check_violation then
    perform tests.ok(true, 'a volunteer cannot be a delegate');
  end;
  begin
    perform public.set_approval_delegation(v_org, v_lead, v_lead, v_today, v_today + 7);
    perform tests.ok(false, 'an approver cannot delegate to themselves');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'an approver cannot delegate to themselves');
  end;
  begin
    perform public.set_approval_delegation(v_org, v_lead, v_pm, v_today - 1, v_today + 7);
    perform tests.ok(false, 'a delegation cannot start in the past');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'a delegation cannot start in the past');
  end;
  begin
    perform public.set_approval_delegation(v_org, v_lead, v_pm, v_today + 3, v_today + 1);
    perform tests.ok(false, 'the last day cannot come before the first');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'the last day cannot come before the first');
  end;

  -- The lead is away for a week; the project manager covers.
  v_delegation := public.set_approval_delegation(v_org, v_lead, v_pm, v_today, v_today + 7, 'Vacation');
  perform tests.ok(v_delegation is not null, 'an approver sets their own delegate');
  begin
    perform public.set_approval_delegation(v_org, v_lead, v_staff, v_today + 5, v_today + 9);
    perform tests.ok(false, 'one delegate per approver at a time');
  exception when check_violation then
    perform tests.ok(true, 'one delegate per approver at a time');
  end;

  -- No chains: the delegate cannot pass it on, and nobody can delegate to
  -- someone who is away.
  perform tests.authenticate(v_pm, 'aal1');
  begin
    perform public.set_approval_delegation(v_org, v_pm, v_staff, v_today + 1, v_today + 2);
    perform tests.ok(false, 'a delegate cannot pass the delegation on');
  exception when check_violation then
    perform tests.ok(true, 'a delegate cannot pass the delegation on');
  end;
  perform tests.authenticate(v_owner, 'aal2');
  begin
    perform public.set_approval_delegation(v_org, v_owner, v_lead, v_today + 1, v_today + 2);
    perform tests.ok(false, 'nobody can delegate to an approver who is away');
  exception when check_violation then
    perform tests.ok(true, 'nobody can delegate to an approver who is away');
  end;

  -- Who reads delegations.
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.approval_delegation where id = v_delegation;
  perform tests.ok(v_count = 0, 'an unrelated staff member cannot see a delegation');
  perform tests.authenticate(v_pm, 'aal1');
  select count(*) into v_count from public.approval_delegation where id = v_delegation;
  perform tests.ok(v_count = 1, 'the delegate sees the delegation');
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_count from public.approval_delegation where id = v_delegation;
  perform tests.ok(v_count = 1, 'an admin with MFA sees the delegation');

  -- Items waiting on the lead now reach the delegate, and new ones too.
  perform tests.authenticate(v_staff, 'aal1');
  v_after := public.submit_approval(v_org, 'expense_claim', 'Bus pass', 9000, v_program);
  perform tests.authenticate(v_pm, 'aal1');
  v_own := public.submit_approval(v_org, 'expense_claim', 'Delegate''s own taxi', 3000, v_program);
  select count(*) into v_count from public.notification
  where user_id = v_pm and source_id = v_before and category = 'approval';
  perform tests.ok(v_count = 1, 'the delegate is told about items already waiting on the approver');
  select count(*) into v_count from public.notification
  where user_id = v_pm and source_id = v_after and category = 'approval';
  perform tests.ok(v_count = 1, 'the delegate gets the next-approver notification');
  select count(*) into v_count from public.approval_inbox() where id in (v_before, v_after);
  perform tests.ok(v_count = 2, 'the approver''s items are in the delegate''s inbox');

  -- The delegate never approves their own claim.
  select count(*) into v_count from public.approval_inbox() where id = v_own;
  perform tests.ok(v_count = 0, 'the delegate''s own claim is not in their inbox');
  begin
    perform public.decide_approval(v_own, 'approve');
    perform tests.ok(false, 'a delegate cannot approve their own claim');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a delegate cannot approve their own claim');
  end;

  -- Deciding on behalf of the lead, recorded as such.
  v_status := public.decide_approval(v_before, 'approve', 'Covering for the lead');
  perform tests.ok(v_status = 'approved', 'the delegate approves on the approver''s behalf');
  select count(*) into v_count from public.approval_step
  where item_id = v_before and approver_id = v_lead and decided_by = v_pm and on_behalf_of = v_lead;
  perform tests.ok(v_count = 1, 'the step records who decided and on whose behalf');
  select count(*) into v_count from public.approval_event
  where item_id = v_before and kind = 'approved' and actor_id = v_pm and on_behalf_of = v_lead;
  perform tests.ok(v_count = 1, 'the trail records "decided by X on behalf of Y"');

  -- The delegate cannot end the delegation; the approver can.
  begin
    perform public.end_approval_delegation(v_delegation);
    perform tests.ok(false, 'the delegate cannot end the delegation');
  exception when insufficient_privilege then
    perform tests.ok(true, 'the delegate cannot end the delegation');
  end;

  -- It ends by itself at the end of the last day: move it into the past.
  perform tests.clear_auth();
  reset role;
  update public.approval_delegation
  set starts_on = v_today - 10, ends_on = v_today - 3,
      starts_at = now() - interval '10 days', ends_at = now() - interval '2 days'
  where id = v_delegation;
  perform tests.authenticate(v_pm, 'aal1');
  select count(*) into v_count from public.approval_inbox() where id = v_after;
  perform tests.ok(v_count = 0, 'after the end date the item leaves the delegate''s inbox');
  begin
    perform public.decide_approval(v_after, 'approve');
    perform tests.ok(false, 'after the end date the delegate cannot decide');
  exception when insufficient_privilege then
    perform tests.ok(true, 'after the end date the delegate cannot decide');
  end;
  select count(*) into v_count from public.approval_item where id = v_before;
  perform tests.ok(v_count = 1, 'the delegate still reads what they decided');

  -- Ending early, by the approver.
  perform tests.authenticate(v_lead, 'aal1');
  v_second := public.set_approval_delegation(v_org, v_lead, v_pm, v_today, v_today + 2);
  perform tests.authenticate(v_pm, 'aal1');
  select count(*) into v_count from public.approval_inbox() where id = v_after;
  perform tests.ok(v_count = 1, 'a new delegation brings the item back');
  perform tests.authenticate(v_lead, 'aal1');
  perform public.end_approval_delegation(v_second);
  perform tests.authenticate(v_pm, 'aal1');
  begin
    perform public.decide_approval(v_after, 'approve');
    perform tests.ok(false, 'once ended early the delegate cannot decide');
  exception when insufficient_privilege then
    perform tests.ok(true, 'once ended early the delegate cannot decide');
  end;

  -- An owner or admin with MFA sets one for someone else; one that has not
  -- started yet gives no authority.
  perform tests.authenticate(v_admin, 'aal2');
  v_second := public.set_approval_delegation(v_org, v_lead, v_pm, v_today + 1, v_today + 4);
  perform tests.ok(v_second is not null, 'an admin with MFA sets a delegate for an approver');
  perform tests.authenticate(v_pm, 'aal1');
  begin
    perform public.decide_approval(v_after, 'approve');
    perform tests.ok(false, 'a delegation that has not started gives no authority');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a delegation that has not started gives no authority');
  end;

  -- The lead still decides their own items while a delegation exists.
  perform tests.authenticate(v_lead, 'aal1');
  v_status := public.decide_approval(v_after, 'approve');
  perform tests.ok(v_status = 'approved', 'the approver can still decide for themselves');
  select count(*) into v_count from public.approval_step
  where item_id = v_after and decided_by = v_lead and on_behalf_of is null;
  perform tests.ok(v_count = 1, 'the approver''s own decision is not marked as on behalf of anyone');

  -- Setting and ending write audit events.
  perform tests.clear_auth();
  reset role;
  select count(*) into v_count from public.audit_event
  where object_type = 'approval_delegation' and action = 'delegation_set' and organization_id = v_org
    and metadata->>'approver_id' = v_lead::text;
  perform tests.ok(v_count = 3, 'setting a delegation writes an audit event (twice by the lead, once by the admin)');
  select count(*) into v_count from public.audit_event
  where object_type = 'approval_delegation' and action = 'delegation_ended'
    and actor_id = v_lead;
  perform tests.ok(v_count = 1, 'ending a delegation writes an audit event');
  select count(*) into v_count from public.audit_event
  where object_type = 'approval_item' and object_id = v_before and action = 'approved'
    and metadata->>'on_behalf_of' = v_lead::text;
  perform tests.ok(v_count = 1, 'the decision''s audit event names whom it was made for');
end;
$$;

rollback;
