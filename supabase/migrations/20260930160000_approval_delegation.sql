-- Approval delegation while an approver is away (#143, the last piece).
-- Builds on approvals (20260927200000).
--
-- An approver names a delegate and a date range; while it runs, steps waiting
-- on that approver can be decided by the delegate, and the trail records
-- "decided by X on behalf of Y". An owner or admin with MFA can set one for
-- any approver (someone is off sick and did not set it up).
--
-- Rules the database enforces, not the screen:
--   * The delegate can never approve their own request: the existing
--     "nobody approves their own request" check applies to them unchanged,
--     and so does "nobody approves two steps of the same item".
--   * No chains. A delegate acts only on steps that name the approver
--     directly, never on steps that approver could decide as someone else's
--     delegate. On top of that, a delegation is refused when the delegate is
--     away themselves in the same dates, or the approver is covering for
--     someone else in the same dates.
--   * One delegate per approver at a time: ranges for one approver cannot
--     overlap.
--   * It ends by itself at the end of the last day, in the organization's
--     time zone: activity is checked against the clock, so nothing has to run
--     for it to stop. It can also be ended early.
--   * Setting and ending it write an audit event.
--   * Only the functions below write delegations.

create table public.approval_delegation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  approver_id uuid not null references public.user_profile (id) on delete cascade,
  delegate_id uuid not null references public.user_profile (id) on delete cascade,
  -- The dates as chosen, for display; starts_at/ends_at are what is checked.
  starts_on date not null,
  ends_on date not null,
  -- Start of the first day and end of the last day in the organization's zone.
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.user_profile (id) on delete set null,
  constraint approval_delegation_two_people check (approver_id <> delegate_id),
  constraint approval_delegation_dates check (ends_on >= starts_on and ends_at > starts_at)
);

create index idx_approval_delegation_approver
  on public.approval_delegation (organization_id, approver_id, ends_at) where ended_at is null;
create index idx_approval_delegation_delegate
  on public.approval_delegation (delegate_id, ends_at) where ended_at is null;

comment on table public.approval_delegation is
  'Who decides for an approver while they are away (#143). Written only through set_approval_delegation and end_approval_delegation.';

alter table public.approval_delegation enable row level security;

-- The approver, the delegate, and owners/admins with MFA.
create policy approval_delegation_read on public.approval_delegation
for select to authenticated using (
  app.is_org_admin(organization_id)
  or (app.is_org_member(organization_id) and auth.uid() in (approver_id, delegate_id))
);

revoke all on public.approval_delegation from anon, authenticated;
grant select on public.approval_delegation to authenticated;
grant all on public.approval_delegation to service_role;

-- Who decided on whose behalf. Null when the decider acted for themselves
-- (or as an owner/admin covering an absence without a delegation).
alter table public.approval_step
  add column on_behalf_of uuid references public.user_profile (id);
alter table public.approval_event
  add column on_behalf_of uuid references public.user_profile (id);

-- Is the caller the approver's delegate right now?
create or replace function app.is_approval_delegate(p_organization uuid, p_approver uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_approver is not null and exists (
    select 1 from public.approval_delegation d
    where d.organization_id = p_organization
      and d.approver_id = p_approver
      and d.delegate_id = auth.uid()
      and d.ended_at is null
      and d.starts_at <= now() and now() < d.ends_at
  );
$$;
revoke all on function app.is_approval_delegate(uuid, uuid) from public, anon;
grant execute on function app.is_approval_delegate(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Who may read and decide, now with delegates
-- ---------------------------------------------------------------------------

-- As before, plus the current delegate of anyone named on a step, and anyone
-- who decided a step (so a delegate still reads what they decided after the
-- delegation ends).
create or replace function app.can_read_approval_item(p_item uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.approval_item i
    where i.id = p_item
      and (
        (i.requested_by = auth.uid() and app.is_org_member(i.organization_id))
        or app.is_org_admin(i.organization_id)
        or (app.is_org_member(i.organization_id) and exists (
          select 1 from public.approval_step s
          where s.item_id = i.id
            and (s.approver_id = auth.uid() or s.decided_by = auth.uid()
                 or app.is_approval_delegate(i.organization_id, s.approver_id))
        ))
      )
  );
$$;

-- As before, plus the approver's current delegate on a step that names that
-- approver directly. Never their own request, never a second step.
create or replace function app.can_decide_approval_step(p_step public.approval_step, p_item public.approval_item)
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_item.status = 'pending'
    and p_step.status = 'pending'
    and p_step.step = p_item.current_step
    and p_item.requested_by <> auth.uid()
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

-- The next-approver notification goes to each named approver's current
-- delegate too.
create or replace function app.notify_approvers(p_item public.approval_item)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification (user_id, organization_id, category, title, body,
    source_type, source_id, link, urgency, dedupe_key)
  select distinct u.user_id, p_item.organization_id, 'approval',
    'Approval needed: ' || p_item.title,
    case when p_item.amount_cents is null then null
         else 'Amount: $' || to_char(p_item.amount_cents / 100.0, 'FM999,999,999,990.00') end,
    'approval_item', p_item.id, '/approvals?item=' || p_item.id, 'high'::public.notification_urgency,
    'approval:' || p_item.id || ':' || u.user_id || ':step' || p_item.current_step
  from (
    select s.approver_id as user_id
    from public.approval_step s
    where s.item_id = p_item.id and s.step = p_item.current_step
      and s.status = 'pending' and s.approver_kind = 'person'
    union
    select d.delegate_id
    from public.approval_step s
    join public.approval_delegation d
      on d.organization_id = p_item.organization_id
     and d.approver_id = s.approver_id
     and d.ended_at is null and d.starts_at <= now() and now() < d.ends_at
    where s.item_id = p_item.id and s.step = p_item.current_step
      and s.status = 'pending' and s.approver_kind = 'person'
    union
    select m.user_id
    from public.approval_step s
    join public.organization_membership m
      on m.organization_id = p_item.organization_id
     and m.status = 'active' and m.role in ('owner', 'admin')
    where s.item_id = p_item.id and s.step = p_item.current_step
      and s.status = 'pending' and s.approver_kind = 'admins'
  ) u
  where u.user_id <> p_item.requested_by
  on conflict do nothing;
end;
$$;
revoke all on function app.notify_approvers(public.approval_item) from public, anon, authenticated;

-- The inbox now includes steps the caller covers as a delegate.
create or replace function public.approval_inbox()
returns setof public.approval_item
language sql stable security definer set search_path = '' as $$
  select i.* from public.approval_item i
  where i.status = 'pending'
    and app.is_org_member(i.organization_id)
    and exists (
      select 1 from public.approval_step s
      where s.item_id = i.id
        and app.can_decide_approval_step(s, i)
        -- An owner/admin covering for a named person without a delegation
        -- sees those items under "All pending", not in their own inbox.
        and (s.approver_id = auth.uid() or s.approver_kind = 'admins'
             or app.is_approval_delegate(i.organization_id, s.approver_id))
    )
  order by i.created_at;
$$;
revoke all on function public.approval_inbox() from public, anon;
grant execute on function public.approval_inbox() to authenticated;

-- As before; a delegate's decision records whom it was made for.
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
revoke all on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Setting and ending a delegation
-- ---------------------------------------------------------------------------

create or replace function app.audit_approval_delegation(p_delegation public.approval_delegation, p_action text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action,
    object_type, object_id, metadata)
  values (p_delegation.organization_id, auth.uid(), 'user', 'approval', p_action,
    'approval_delegation', p_delegation.id,
    jsonb_build_object('approver_id', p_delegation.approver_id,
      'delegate_id', p_delegation.delegate_id,
      'starts_on', p_delegation.starts_on, 'ends_on', p_delegation.ends_on));
$$;
revoke all on function app.audit_approval_delegation(public.approval_delegation, text) from public, anon, authenticated;

-- The approver sets their own; an owner or admin with MFA sets anyone's.
-- Both people must be active owners, admins or staff of the organization.
create or replace function public.set_approval_delegation(
  p_organization uuid,
  p_approver uuid,
  p_delegate uuid,
  p_starts_on date,
  p_ends_on date,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_zone text;
  v_today date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.approval_delegation;
begin
  if v_uid is null or not (
    (p_approver = v_uid and app.is_org_staff(p_organization))
    or app.is_org_admin(p_organization)
  ) then
    raise exception 'Only the approver, or an owner or administrator with MFA, can set a delegate'
      using errcode = '42501';
  end if;
  if p_approver is null or p_delegate is null or p_approver = p_delegate then
    raise exception 'Choose someone other than the approver as the delegate' using errcode = '22023';
  end if;
  if (select count(*) from public.organization_membership m
      where m.organization_id = p_organization and m.user_id in (p_approver, p_delegate)
        and m.status = 'active' and m.role in ('owner', 'admin', 'staff')) <> 2 then
    raise exception 'The approver and the delegate must both be active staff members or administrators'
      using errcode = '23514';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The note is too long' using errcode = '22023';
  end if;

  select coalesce(o.timezone, 'America/Toronto') into v_zone
  from public.organization o where o.id = p_organization;
  v_today := (now() at time zone v_zone)::date;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'The last day must be on or after the first day' using errcode = '22023';
  end if;
  if p_starts_on < v_today or p_starts_on > v_today + 366 or p_ends_on > p_starts_on + 366 then
    raise exception 'A delegation starts between today and one year from today and lasts at most a year'
      using errcode = '22023';
  end if;

  -- Serialize delegation changes per organization so the overlap and chain
  -- checks below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('approval_delegation:' || p_organization::text, 0));

  if exists (
    select 1 from public.approval_delegation d
    where d.organization_id = p_organization and d.ended_at is null
      and d.approver_id = p_approver
      and d.starts_on <= p_ends_on and p_starts_on <= d.ends_on
  ) then
    raise exception 'This approver already has a delegate for some of those dates' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.approval_delegation d
    where d.organization_id = p_organization and d.ended_at is null
      and d.approver_id = p_delegate
      and d.starts_on <= p_ends_on and p_starts_on <= d.ends_on
  ) then
    raise exception 'The delegate is away themselves for some of those dates; delegations cannot be passed on'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.approval_delegation d
    where d.organization_id = p_organization and d.ended_at is null
      and d.delegate_id = p_approver
      and d.starts_on <= p_ends_on and p_starts_on <= d.ends_on
  ) then
    raise exception 'The approver is covering for someone else for some of those dates; delegations cannot be passed on'
      using errcode = '23514';
  end if;

  insert into public.approval_delegation (organization_id, approver_id, delegate_id,
    starts_on, ends_on, starts_at, ends_at, note, created_by)
  values (p_organization, p_approver, p_delegate, p_starts_on, p_ends_on,
    p_starts_on::timestamp at time zone v_zone,
    (p_ends_on + 1)::timestamp at time zone v_zone,
    v_note, v_uid)
  returning * into v_row;

  perform app.audit_approval_delegation(v_row, 'delegation_set');

  -- Items already waiting on the approver: tell the delegate now if the
  -- delegation starts today.
  if v_row.starts_at <= now() then
    insert into public.notification (user_id, organization_id, category, title, body,
      source_type, source_id, link, urgency, dedupe_key)
    select distinct p_delegate, i.organization_id, 'approval',
      'Approval needed: ' || i.title,
      case when i.amount_cents is null then null
           else 'Amount: $' || to_char(i.amount_cents / 100.0, 'FM999,999,999,990.00') end,
      'approval_item', i.id, '/approvals?item=' || i.id, 'high'::public.notification_urgency,
      'approval:' || i.id || ':' || p_delegate || ':step' || i.current_step
    from public.approval_item i
    join public.approval_step s
      on s.item_id = i.id and s.step = i.current_step and s.status = 'pending'
     and s.approver_kind = 'person' and s.approver_id = p_approver
    where i.organization_id = p_organization and i.status = 'pending'
      and i.requested_by <> p_delegate
    on conflict do nothing;
  end if;

  return v_row.id;
end;
$$;
revoke all on function public.set_approval_delegation(uuid, uuid, uuid, date, date, text) from public, anon;
grant execute on function public.set_approval_delegation(uuid, uuid, uuid, date, date, text) to authenticated;

-- Ends a delegation now (or cancels one that has not started). The approver
-- or an owner/admin with MFA. Ending one that is already over does nothing.
create or replace function public.end_approval_delegation(p_delegation uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.approval_delegation;
begin
  select * into v_row from public.approval_delegation where id = p_delegation for update;
  if not found or v_uid is null or not (
    (v_row.approver_id = v_uid and app.is_org_staff(v_row.organization_id))
    or app.is_org_admin(v_row.organization_id)
  ) then
    raise exception 'Only the approver, or an owner or administrator with MFA, can end a delegation'
      using errcode = '42501';
  end if;
  if v_row.ended_at is not null or v_row.ends_at <= now() then
    return;
  end if;
  update public.approval_delegation set ended_at = now(), ended_by = v_uid
  where id = p_delegation returning * into v_row;
  perform app.audit_approval_delegation(v_row, 'delegation_ended');
end;
$$;
revoke all on function public.end_approval_delegation(uuid) from public, anon;
grant execute on function public.end_approval_delegation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The accountant's read-only chain shows "X on behalf of Y" too
-- ---------------------------------------------------------------------------
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
    coalesce(p.full_name, 'System')
      || coalesce(' on behalf of ' || bp.full_name, ''),
    ev.note
  from items i
  join public.approval_event ev on ev.item_id = i.id
  left join public.user_profile p on p.id = ev.actor_id
  left join public.user_profile bp on bp.id = ev.on_behalf_of
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
