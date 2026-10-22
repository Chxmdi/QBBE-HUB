-- Separation of duties on bills.
--
-- 1. The person who drafted a bill, or saved a change to the draft, cannot
--    approve or reject it, whoever sent it for approval and whatever their
--    role; before, only the person who sent the request was kept out, so a
--    bill sent by someone else could be approved by its own drafter.
-- 2. Only the bill's drafter or an administrator sends it for approval.
-- 3. An approval covers the bill's expense accounts, fund and payable account
--    as well as its vendor, dates, amounts and descriptions, so re-coding an
--    approved bill needs a fresh approval. Approvals that still matched their
--    bill when this migration ran keep applying to it as it is now.
--
-- The default approval threshold, budget self-approval and receipt
-- self-review are unchanged here.

-- Approvals valid now, under the old fingerprint, stay valid under the new one.
create temporary table finance_sod_still_approved on commit drop as
select b.id from public.finance_bill b
where b.status = 'draft' and b.approval_fingerprint is not null
  and b.approval_fingerprint = app.finance_bill_fingerprint(b.id);

create or replace function app.finance_bill_fingerprint(p_bill uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(jsonb_build_object('vendor_id', b.vendor_id, 'vendor_reference', b.vendor_reference,
      'receipt_id', b.receipt_id, 'bill_date', b.bill_date, 'subtotal_cents', b.subtotal_cents,
      'gst_cents', b.gst_cents, 'qst_cents', b.qst_cents,
      'fund_id', b.fund_id, 'payable_account_id', b.payable_account_id,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'account_id', l.account_id,
          'program_id', l.program_id, 'description', l.description, 'amount_cents', l.amount_cents)
        order by l.line_no)
        from public.finance_bill_line l where l.bill_id = b.id), '[]'::jsonb))::text)
  from public.finance_bill b where b.id = p_bill;
$$;
revoke all on function app.finance_bill_fingerprint(uuid) from public, anon, authenticated, service_role;

update public.finance_bill b set approval_fingerprint = app.finance_bill_fingerprint(b.id)
from finance_sod_still_approved s where s.id = b.id;

-- Every save of a draft bill is on the audit trail with who saved it.
create index if not exists idx_audit_event_bill_draft_saved
  on public.audit_event (object_id, actor_id) where action = 'bill_draft_saved';

-- Whether the caller drafted the bill an approval is for, or saved a change
-- to it while it was a draft.
create or replace function app.approval_is_own_bill(p_item public.approval_item)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_item.subject_type = 'bill' and p_item.subject_id is not null and exists (
    select 1 from public.finance_bill b
    where b.id = p_item.subject_id and b.organization_id = p_item.organization_id
      and (b.created_by = auth.uid()
           or exists (select 1 from public.audit_event e
                      where e.object_id = b.id and e.action = 'bill_draft_saved'
                        and e.object_type = 'finance_bill' and e.actor_id = auth.uid())));
$$;
revoke all on function app.approval_is_own_bill(public.approval_item) from public, anon, authenticated, service_role;

-- As before, and never a bill the caller drafted.
create or replace function app.can_decide_approval_step(p_step public.approval_step, p_item public.approval_item)
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_item.status = 'pending'
    and p_step.status = 'pending'
    and p_step.step = p_item.current_step
    and p_item.requested_by <> auth.uid()
    and not app.approval_is_own_bill(p_item)
    and not exists (
      select 1 from public.approval_step s
      where s.item_id = p_item.id and s.decided_by = auth.uid() and s.status = 'approved'
    )
    and (
      (p_step.approver_id = auth.uid() and app.is_org_staff(p_item.organization_id))
      or (p_step.approver_kind = 'person'
          and app.is_org_staff(p_item.organization_id)
          and app.is_approval_delegate(p_item.organization_id, p_step.approver_id))
      or app.is_org_admin(p_item.organization_id)
    );
$$;
revoke all on function app.can_decide_approval_step(public.approval_step, public.approval_item) from public, anon, authenticated, service_role;

-- As before; a bill's drafter or editor is refused with their own message.
create or replace function public.decide_approval(p_item uuid, p_decision text, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item public.approval_item;
  v_step public.approval_step;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_next smallint;
  v_for uuid;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject' using errcode = '22023';
  end if;
  select * into v_item from public.approval_item where id = p_item for update;
  if not found or not app.can_read_approval_item(p_item) then
    raise exception 'That approval is not available to you' using errcode = '42501';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'That approval was already settled' using errcode = '22023';
  end if;
  if v_item.requested_by = v_uid then
    raise exception 'You cannot approve or reject your own request' using errcode = '42501';
  end if;
  if app.approval_is_own_bill(v_item) then
    raise exception 'You drafted this bill, so someone else approves or rejects it'
      using errcode = '42501', hint = 'approval_own_bill';
  end if;
  if p_decision = 'reject' and v_note is null then
    raise exception 'A rejection needs a reason' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'The note is too long' using errcode = '22023';
  end if;

  -- The caller's own step first, then an "any administrator" step, then a
  -- step they cover as a delegate, then (for an owner/admin covering an
  -- absence) someone else's.
  select s.* into v_step
  from public.approval_step s
  where s.item_id = p_item and app.can_decide_approval_step(s, v_item)
  order by (s.approver_id = v_uid) desc nulls last, (s.approver_kind = 'admins') desc,
    app.is_approval_delegate(v_item.organization_id, s.approver_id) desc, s.created_at
  limit 1
  for update;
  if not found then
    raise exception 'You are not an approver for this step' using errcode = '42501';
  end if;

  if v_step.approver_id is not null and v_step.approver_id <> v_uid
     and app.is_approval_delegate(v_item.organization_id, v_step.approver_id) then
    v_for := v_step.approver_id;
  end if;

  update public.approval_step
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      decided_by = v_uid, decided_at = now(), note = v_note, on_behalf_of = v_for
  where id = v_step.id;

  insert into public.approval_event (item_id, organization_id, actor_id, kind, step, note, on_behalf_of)
  values (p_item, v_item.organization_id, v_uid,
    case when p_decision = 'approve' then 'approved' else 'rejected' end, v_step.step, v_note, v_for);

  if p_decision = 'reject' then
    update public.approval_step set status = 'cancelled'
    where item_id = p_item and status = 'pending';
    update public.approval_item
    set status = 'rejected', decided_by = v_uid, decided_at = now(),
        decision_note = v_note, updated_at = now()
    where id = p_item returning * into v_item;
    perform app.notify_approval_requester(v_item, 'Rejected: ' || v_item.title, v_note, 'rejected');
    perform app.audit_approval(v_item, 'rejected',
      jsonb_build_object('step', v_step.step, 'on_behalf_of', v_for));
    return v_item.status;
  end if;

  if not exists (
    select 1 from public.approval_step s
    where s.item_id = p_item and s.step = v_item.current_step and s.status = 'pending'
  ) then
    select min(s.step) into v_next from public.approval_step s
    where s.item_id = p_item and s.status = 'pending';
    if v_next is null then
      update public.approval_item
      set status = 'approved', decided_by = v_uid, decided_at = now(),
          decision_note = v_note, updated_at = now()
      where id = p_item returning * into v_item;
      insert into public.approval_event (item_id, organization_id, actor_id, kind, step, on_behalf_of)
      values (p_item, v_item.organization_id, v_uid, 'completed', v_step.step, v_for);
      perform app.notify_approval_requester(v_item, 'Approved: ' || v_item.title, v_note, 'approved');
    else
      update public.approval_item set current_step = v_next, updated_at = now()
      where id = p_item returning * into v_item;
      perform app.notify_approvers(v_item);
    end if;
  else
    update public.approval_item set updated_at = now() where id = p_item returning * into v_item;
  end if;
  perform app.audit_approval(v_item, 'approved',
    jsonb_build_object('step', v_step.step, 'on_behalf_of', v_for));
  return v_item.status;
end;
$$;
revoke all on function public.decide_approval(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.decide_approval(uuid, text, text) to authenticated, service_role;

-- As before, and only the bill's drafter or an administrator sends it.
create or replace function public.finance_request_bill_approval(p_bill uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.finance_bill;
  v_previous public.approval_item;
  v_fingerprint text;
  v_vendor text;
  v_program uuid;
  v_item uuid;
begin
  select * into b from public.finance_bill where id = p_bill for update;
  if not found or not app.is_org_staff(b.organization_id) then
    raise exception 'Bill not found' using errcode = 'P0002';
  end if;
  if b.created_by is distinct from auth.uid() and not app.is_org_admin(b.organization_id) then
    raise exception 'Only the person who drafted it or an administrator sends a bill for approval'
      using errcode = '42501', hint = 'bill_request_not_drafter';
  end if;
  if b.status <> 'draft' then
    raise exception 'Only a draft bill is sent for approval' using errcode = '22023';
  end if;
  if b.total_cents <= 0 then
    raise exception 'Add the bill''s lines before asking for approval' using errcode = '22023';
  end if;
  v_fingerprint := app.finance_bill_fingerprint(b.id);

  if b.approval_item_id is not null then
    select * into v_previous from public.approval_item where id = b.approval_item_id;
    if found and v_previous.amount_cents = b.total_cents and b.approval_fingerprint = v_fingerprint then
      if v_previous.status = 'pending' then
        raise exception 'This bill is already waiting for approval' using errcode = '22023';
      elsif v_previous.status = 'approved' then
        raise exception 'This bill is already approved' using errcode = '22023';
      end if;
    end if;
    if found and v_previous.status = 'pending' then
      perform app.approval_withdraw_waiting(v_previous.id,
        'The bill changed after it was sent; replaced by a new request.');
    end if;
  end if;

  select c.name into v_vendor from public.finance_contact c where c.id = b.vendor_id;
  -- Route by the program when the whole bill is for one program.
  select min(l.program_id::text)::uuid into v_program from public.finance_bill_line l
  where l.bill_id = b.id having count(distinct l.program_id) = 1 and count(*) = count(l.program_id);

  v_item := public.submit_approval(b.organization_id, 'bill',
    left('Bill from ' || v_vendor || coalesce(' #' || b.vendor_reference, ''), 200),
    b.total_cents, v_program, b.memo, b.id);

  update public.finance_bill set approval_item_id = v_item, approval_fingerprint = v_fingerprint
  where id = b.id;
  perform app.record_material_audit(b.organization_id, 'finance', 'bill_approval_requested',
    'finance_bill', b.id, jsonb_build_object('approval_item_id', v_item, 'total_cents', b.total_cents));
  return v_item;
end;
$$;
revoke all on function public.finance_request_bill_approval(uuid) from public, anon, authenticated, service_role;
grant execute on function public.finance_request_bill_approval(uuid) to authenticated, service_role;
