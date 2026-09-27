-- Approved bills hand off to the ledger (#143 "an approved bill becomes
-- available to the ledger", #150). Builds on approvals (20260927200000) and
-- payables (20260928100000).
--
-- Payables already refuses to post a bill at or above the approval threshold
-- until an approval exists for that bill at its current total. This makes the
-- approval mean something about the bill that is actually posted:
--
--   * A bill remembers the approval request it sent (approval_item_id) and a
--     fingerprint of what was approved. Only that request counts, so an
--     approval submitted by hand through submit_approval, with a title or
--     program of the submitter's choosing, never unlocks posting.
--   * Changing what was approved (vendor, the vendor's invoice number, the
--     captured receipt, the bill date, amounts and taxes, or any line's
--     program, description or amount) after the request means the bill must
--     be sent again. Bookkeeping coding (fund, payable account, each line's
--     expense account) is left out on purpose: finance often fills it in just
--     before posting, and that is not what the approver decided. Saving the
--     bill without changing those things keeps the approval.
--   * Sending a changed bill again withdraws the older request if it is still
--     waiting, so approvers are not asked twice.
--   * When the approval completes, the owners and administrators who post
--     bills are told the bill is ready to post, with a link to it.
--   * Deleting a draft withdraws its waiting request.
--
-- Posting itself does not change hands: an owner or administrator with MFA
-- still posts, as the ledger requires.

alter table public.finance_bill
  add column approval_item_id uuid references public.approval_item (id) on delete set null,
  add column approval_fingerprint text;

comment on column public.finance_bill.approval_item_id is
  'The approval request this bill sent (#143). Only this request can unlock posting.';
comment on column public.finance_bill.approval_fingerprint is
  'app.finance_bill_fingerprint() when the approval was requested. A different value means the bill changed since.';

-- What an approver approves, as one comparable value.
create or replace function app.finance_bill_fingerprint(p_bill uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(jsonb_build_object(
    'vendor_id', b.vendor_id,
    'vendor_reference', b.vendor_reference,
    'receipt_id', b.receipt_id,
    'bill_date', b.bill_date,
    'subtotal_cents', b.subtotal_cents,
    'gst_cents', b.gst_cents,
    'qst_cents', b.qst_cents,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'line_no', l.line_no, 'program_id', l.program_id,
        'description', l.description, 'amount_cents', l.amount_cents) order by l.line_no)
      from public.finance_bill_line l where l.bill_id = b.id), '[]'::jsonb)
  )::text)
  from public.finance_bill b where b.id = p_bill;
$$;
revoke all on function app.finance_bill_fingerprint(uuid) from public, anon, authenticated;

-- Withdraws a waiting approval on behalf of the system (the bill changed or
-- was deleted), keeping the trail. Does nothing once the approval is settled.
create or replace function app.approval_withdraw_waiting(p_item uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.approval_item;
begin
  select * into v_item from public.approval_item where id = p_item for update;
  if not found or v_item.status <> 'pending' then
    return;
  end if;
  update public.approval_step set status = 'cancelled' where item_id = p_item and status = 'pending';
  update public.approval_item
  set status = 'withdrawn', decided_at = now(), decision_note = p_note, updated_at = now()
  where id = p_item returning * into v_item;
  insert into public.approval_event (item_id, organization_id, actor_id, kind, step, note)
  values (p_item, v_item.organization_id, auth.uid(), 'withdrawn', v_item.current_step, p_note);
  perform app.audit_approval(v_item, 'withdrawn', jsonb_build_object('reason', p_note));
end;
$$;
revoke all on function app.approval_withdraw_waiting(uuid, text) from public, anon, authenticated;

-- Whether a bill needs an approval it does not have: over the threshold and
-- not approved through its own request, for its current total and contents.
create or replace function app.finance_bill_needs_approval(p_bill public.finance_bill)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_threshold bigint;
begin
  select s.bill_approval_threshold_cents into v_threshold
  from public.finance_billing_settings s where s.organization_id = p_bill.organization_id;
  if v_threshold is null or p_bill.total_cents < v_threshold then
    return false;
  end if;
  return not (
    p_bill.approval_item_id is not null
    and exists (
      select 1 from public.approval_item a
      where a.id = p_bill.approval_item_id
        and a.organization_id = p_bill.organization_id
        and a.subject_type = 'bill' and a.subject_id = p_bill.id
        and a.status = 'approved' and a.amount_cents = p_bill.total_cents
    )
    and p_bill.approval_fingerprint = app.finance_bill_fingerprint(p_bill.id)
  );
end;
$$;
revoke all on function app.finance_bill_needs_approval(public.finance_bill) from public, anon, authenticated;

-- The state of the bill's own approval request: 'pending', 'approved',
-- 'rejected' or 'withdrawn'; 'changed' when the bill no longer matches what
-- was sent; null when it has not been sent.
create or replace function public.finance_bill_approval_status(p_bill uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.finance_bill;
  v_item public.approval_item;
begin
  select * into b from public.finance_bill where id = p_bill;
  if not found or not app.is_org_staff(b.organization_id) or b.approval_item_id is null then
    return null;
  end if;
  select * into v_item from public.approval_item where id = b.approval_item_id;
  if not found then
    return null;
  end if;
  if v_item.status in ('pending', 'approved')
     and (v_item.amount_cents is distinct from b.total_cents
          or b.approval_fingerprint is distinct from app.finance_bill_fingerprint(b.id)) then
    return 'changed';
  end if;
  return v_item.status;
end;
$$;
revoke all on function public.finance_bill_approval_status(uuid) from public, anon;
grant execute on function public.finance_bill_approval_status(uuid) to authenticated, service_role;

-- Sends a draft bill for approval and remembers the request. A request still
-- waiting for an unchanged bill is not duplicated; one waiting for an older
-- version of the bill is withdrawn and replaced.
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
revoke all on function public.finance_request_bill_approval(uuid) from public, anon;
grant execute on function public.finance_request_bill_approval(uuid) to authenticated, service_role;

-- A deleted draft does not leave its request in anyone's inbox.
create or replace function app.finance_bill_withdraw_on_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.approval_item_id is not null then
    perform app.approval_withdraw_waiting(old.approval_item_id, 'The bill was deleted.');
  end if;
  return old;
end;
$$;
revoke all on function app.finance_bill_withdraw_on_delete() from public, anon, authenticated;
create trigger finance_bill_withdraw_approval before delete on public.finance_bill
for each row execute function app.finance_bill_withdraw_on_delete();

-- When a bill's own request is approved, the people who post are told.
create or replace function app.finance_bill_ready_to_post() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b public.finance_bill;
begin
  select * into b from public.finance_bill
  where approval_item_id = new.id and status = 'draft';
  -- An approval for an older version of the bill does not make it postable.
  if not found or new.amount_cents is distinct from b.total_cents
     or b.approval_fingerprint is distinct from app.finance_bill_fingerprint(b.id) then
    return new;
  end if;
  insert into public.notification (user_id, organization_id, category, title, body,
    source_type, source_id, link, urgency, dedupe_key)
  select m.user_id, b.organization_id, 'approval', 'Ready to post: ' || new.title,
    'Approved for ' || to_char(b.total_cents / 100.0, 'FM$999,999,999,990.00') || '. Post it to the ledger.',
    'finance_bill', b.id, '/finance/payables/bills/' || b.id,
    'normal'::public.notification_urgency,
    'bill-ready:' || b.id || ':' || new.id || ':' || m.user_id
  from public.organization_membership m
  where m.organization_id = b.organization_id and m.status = 'active'
    and m.role in ('owner', 'admin')
    and m.user_id is distinct from auth.uid()
  on conflict do nothing;
  perform app.record_material_audit(b.organization_id, 'finance', 'bill_approval_approved',
    'finance_bill', b.id, jsonb_build_object('approval_item_id', new.id, 'total_cents', b.total_cents));
  return new;
end;
$$;
revoke all on function app.finance_bill_ready_to_post() from public, anon, authenticated;
create trigger approval_item_bill_ready after update of status on public.approval_item
for each row
when (new.subject_type = 'bill' and old.status = 'pending' and new.status = 'approved')
execute function app.finance_bill_ready_to_post();

-- Drafts already sent before this migration keep their latest request for
-- their current total, as approved against their current contents.
update public.finance_bill b
set approval_item_id = (
      select i.id from public.approval_item i
      where i.organization_id = b.organization_id and i.subject_type = 'bill'
        and i.subject_id = b.id and i.amount_cents = b.total_cents
      order by i.created_at desc limit 1),
    approval_fingerprint = app.finance_bill_fingerprint(b.id)
where b.status = 'draft' and b.approval_item_id is null
  and exists (
    select 1 from public.approval_item i
    where i.organization_id = b.organization_id and i.subject_type = 'bill'
      and i.subject_id = b.id and i.amount_cents = b.total_cents);
