-- The approval chain behind a journal entry (#154 follow-up, #143). The
-- accountant reviews an entry together with its approval trail without being
-- able to change anything.
--
-- Approval items name the record they approve (subject_type, subject_id);
-- journal entries name the record they came from (source_type, source_id).
-- This connects the two:
--   * an entry posted from a vendor bill (source 'finance_bill') shows the
--     bill's approvals;
--   * an entry posted from a payment (source 'finance_payment') shows the
--     payment's own approvals and those of the bill it pays;
--   * a reversal shows the chain of the entry it reverses.
--
-- Approval rows are readable only by their requester, their approvers and
-- admins (app.can_read_approval_item). Ledger readers, the external accountant
-- included, get this one read-only view of the chain for entries they can
-- already see; nothing else about approvals is opened to them.

create or replace function public.ledger_entry_approvals(p_entry uuid)
returns table (
  item_id uuid,
  item_title text,
  item_status text,
  item_amount_cents bigint,
  item_created_at timestamptz,
  occurred_at timestamptz,
  kind text,
  step smallint,
  step_label text,
  actor_name text,
  note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.journal_entry;
begin
  select * into e from public.journal_entry where id = p_entry;
  if not found or not app.can_read_ledger(e.organization_id) then
    raise exception 'You do not have access to the ledger' using errcode = '42501';
  end if;
  -- A reversal is reviewed with the chain of the entry it undoes.
  if e.kind = 'reversal' and e.reverses_entry_id is not null then
    select * into e from public.journal_entry where id = e.reverses_entry_id;
  end if;

  return query
  with subjects as (
    select 'bill'::text as subject_type, e.source_id as subject_id
    where e.source_type = 'finance_bill'
    union
    select 'payment', e.source_id
    where e.source_type = 'finance_payment'
    union
    select 'bill', p.bill_id
    from public.finance_payment p
    where e.source_type = 'finance_payment' and p.id = e.source_id and p.bill_id is not null
  ),
  items as (
    select i.*
    from public.approval_item i
    join subjects s on s.subject_type = i.subject_type and s.subject_id = i.subject_id
    where i.organization_id = e.organization_id
  )
  select i.id, i.title, i.status, i.amount_cents, i.created_at,
    ev.created_at, ev.kind, ev.step,
    -- The step's label; when a level has several approvers, the one this
    -- person decided.
    (select st.label from public.approval_step st
     where st.item_id = i.id and st.step = ev.step
     order by (st.decided_by is not distinct from ev.actor_id) desc limit 1),
    coalesce(p.full_name, 'System'), ev.note
  from items i
  join public.approval_event ev on ev.item_id = i.id
  left join public.user_profile p on p.id = ev.actor_id
  union all
  -- Steps still waiting, so the chain shows who has not decided yet.
  select i.id, i.title, i.status, i.amount_cents, i.created_at,
    null::timestamptz, 'waiting', st.step, st.label,
    coalesce(ap.full_name, 'Any administrator'), null::text
  from items i
  join public.approval_step st on st.item_id = i.id and st.status = 'pending'
  left join public.user_profile ap on ap.id = st.approver_id
  where i.status = 'pending'
  order by 5, 6 nulls last, 8;
end;
$$;
revoke all on function public.ledger_entry_approvals(uuid) from public, anon;
grant execute on function public.ledger_entry_approvals(uuid) to authenticated, service_role;
