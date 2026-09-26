-- Approval routing (#143 v1, epic #139). From 2026-10-01 purchases, expense
-- claims, vendor bills, contracts, payments and forms are approved in the app
-- instead of on paper. This is the generic engine: receipts and bills (#142),
-- payments (#150) and forms (#145) attach later by submitting an item that
-- names their record in (subject_type, subject_id).
--
-- The shape:
--   * approval_rule   Admin-configured routing. A rule matches by kind of
--                     item, program and amount range, and names who approves
--                     at which step: one person (e.g. the treasurer), the
--                     program's lead, or any owner/admin.
--   * approval_item   One thing waiting for a decision. Its status, decision
--                     and who decided are written only by the functions below.
--   * approval_step   The approvers the rules resolved to when the item was
--                     submitted. Every step at the current level must approve
--                     before the next level opens; one rejection ends it.
--   * approval_event  The trail. Append-only: nobody can edit or delete it
--                     from the app.
--
-- Rules the database enforces, not the screen:
--   * Nobody approves their own request, and nobody approves two steps of the
--     same item (so "director plus treasurer" is always two people).
--   * Routing is fixed when the item is submitted. Changing a rule later does
--     not re-route items already waiting.
--   * Signed-in users cannot write items, steps or events directly; every
--     change goes through the functions, which write the trail, the
--     notification and the audit event in the same transaction.

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
create table public.approval_rule (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  -- Null matches every kind of item.
  subject_type text check (subject_type is null or subject_type in
    ('purchase', 'expense_claim', 'bill', 'contract', 'payment', 'form', 'other')),
  -- Null matches every program (and items with no program).
  program_id uuid references public.program (id) on delete cascade,
  -- The rule applies when min <= amount < max. An item without an amount
  -- counts as zero. Money is in cents.
  min_amount_cents bigint not null default 0 check (min_amount_cents >= 0),
  max_amount_cents bigint check (max_amount_cents is null or max_amount_cents > min_amount_cents),
  step smallint not null default 1 check (step between 1 and 5),
  approver_kind text not null check (approver_kind in ('person', 'program_lead', 'admins')),
  approver_user_id uuid references public.user_profile (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 100),
  active boolean not null default true,
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_rule_person_named
    check ((approver_kind = 'person') = (approver_user_id is not null))
);

create index idx_approval_rule_org on public.approval_rule (organization_id, active, step);

comment on table public.approval_rule is
  'Approval routing per organization (#143): which approver signs off which items, by kind, program and amount.';

alter table public.approval_rule enable row level security;

create policy approval_rule_read on public.approval_rule
for select to authenticated using (app.is_org_staff(organization_id));

create policy approval_rule_insert on public.approval_rule
for insert to authenticated with check (app.is_org_admin(organization_id));

create policy approval_rule_update on public.approval_rule
for update to authenticated
using (app.is_org_admin(organization_id))
with check (app.is_org_admin(organization_id));

create policy approval_rule_delete on public.approval_rule
for delete to authenticated using (app.is_org_admin(organization_id));

revoke all on public.approval_rule from anon, authenticated;
grant select, insert, update, delete on public.approval_rule to authenticated;
grant all on public.approval_rule to service_role;

create or replace function app.check_approval_rule() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.organization_id := old.organization_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.program_id is not null and not exists (
    select 1 from public.program p
    where p.id = new.program_id and p.organization_id = new.organization_id
  ) then
    raise exception 'Program is not in this organization' using errcode = '23514';
  end if;
  -- A named approver must be someone who can sign in and act: an active
  -- owner, admin or staff member of this organization.
  if new.approver_user_id is not null and not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id
      and m.user_id = new.approver_user_id
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'staff')
  ) then
    raise exception 'The approver must be an active staff member or administrator' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.check_approval_rule() from public, anon, authenticated;
create trigger approval_rule_check before insert or update on public.approval_rule
for each row execute function app.check_approval_rule();

-- ---------------------------------------------------------------------------
-- Items, steps and the trail
-- ---------------------------------------------------------------------------
create table public.approval_item (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  subject_type text not null check (subject_type in
    ('purchase', 'expense_claim', 'bill', 'contract', 'payment', 'form', 'other')),
  -- The record being approved, owned by the feature that submitted it. Null
  -- for a free-standing request typed into the Approvals screen.
  subject_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  amount_cents bigint check (amount_cents is null or amount_cents between 0 and 100000000000),
  program_id uuid references public.program (id) on delete set null,
  requested_by uuid not null references public.user_profile (id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  current_step smallint,
  decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
  decided_by uuid references public.user_profile (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_item_money_has_amount
    check (subject_type in ('contract', 'form', 'other') or amount_cents is not null),
  constraint approval_item_decision_recorded
    check ((status = 'pending') = (decided_at is null)),
  constraint approval_item_decider_recorded
    check (status in ('pending', 'withdrawn') or decided_by is not null)
);

-- One open approval per record: a second submission while the first is
-- waiting is a mistake, not a new decision.
create unique index uq_approval_item_pending_subject
  on public.approval_item (subject_type, subject_id)
  where status = 'pending' and subject_id is not null;
create index idx_approval_item_org on public.approval_item (organization_id, status, created_at desc);
create index idx_approval_item_requester on public.approval_item (requested_by, created_at desc);

create table public.approval_step (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.approval_item (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  step smallint not null check (step between 1 and 5),
  rule_id uuid references public.approval_rule (id) on delete set null,
  -- Copied from the rule so the trail still reads correctly after the rule
  -- is edited or removed.
  label text not null,
  approver_kind text not null check (approver_kind in ('person', 'admins')),
  approver_id uuid references public.user_profile (id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.user_profile (id),
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint approval_step_person_named
    check ((approver_kind = 'person') = (approver_id is not null))
);

create index idx_approval_step_item on public.approval_step (item_id, step);
create index idx_approval_step_approver on public.approval_step (approver_id, status);

create table public.approval_event (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.approval_item (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  actor_id uuid references public.user_profile (id),
  kind text not null check (kind in
    ('submitted', 'approved', 'rejected', 'commented', 'withdrawn', 'completed')),
  step smallint,
  note text,
  created_at timestamptz not null default now()
);

create index idx_approval_event_item on public.approval_event (item_id, created_at);

comment on table public.approval_item is
  'Something waiting for approval (#143). Written only through submit_approval, decide_approval, comment_on_approval and withdraw_approval.';
comment on table public.approval_event is
  'Approval trail (#143). Append-only.';

alter table public.approval_item enable row level security;
alter table public.approval_step enable row level security;
alter table public.approval_event enable row level security;

-- The requester, anyone named on a step, and owners/admins with MFA.
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
          where s.item_id = i.id and s.approver_id = auth.uid()
        ))
      )
  );
$$;
revoke all on function app.can_read_approval_item(uuid) from public, anon;
grant execute on function app.can_read_approval_item(uuid) to authenticated, service_role;

create policy approval_item_read on public.approval_item
for select to authenticated using (app.can_read_approval_item(id));
create policy approval_step_read on public.approval_step
for select to authenticated using (app.can_read_approval_item(item_id));
create policy approval_event_read on public.approval_event
for select to authenticated using (app.can_read_approval_item(item_id));

revoke all on public.approval_item, public.approval_step, public.approval_event from anon, authenticated;
grant select on public.approval_item, public.approval_step, public.approval_event to authenticated;
grant all on public.approval_item, public.approval_step to service_role;
grant select, insert on public.approval_event to service_role;

-- The trail cannot be edited by anyone, and cannot be deleted from the app.
-- Deleting a whole organization still cascades.
create or replace function app.protect_approval_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'The approval trail cannot be edited' using errcode = '42501';
  end if;
  if current_setting('role', true) in ('authenticated', 'anon')
     or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon', 'service_role') then
    raise exception 'The approval trail cannot be deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function app.protect_approval_event() from public, anon, authenticated;
create trigger approval_event_append_only before update or delete on public.approval_event
for each row execute function app.protect_approval_event();

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- May the caller decide this step? Never their own request; the named person
-- or, for an "any administrator" step, an owner/admin with MFA. An owner or
-- admin may also act on a named person's step so an absence cannot stall the
-- queue; the trail records who actually decided.
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
      or app.is_org_admin(p_item.organization_id)
    );
$$;
revoke all on function app.can_decide_approval_step(public.approval_step, public.approval_item) from public, anon, authenticated;

-- Tell whoever must act on the item's current step.
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

create or replace function app.notify_approval_requester(p_item public.approval_item, p_title text, p_body text, p_key text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_item.requested_by = auth.uid() then return; end if;
  insert into public.notification (user_id, organization_id, category, title, body,
    source_type, source_id, link, urgency, dedupe_key)
  values (p_item.requested_by, p_item.organization_id, 'approval', p_title, p_body,
    'approval_item', p_item.id, '/approvals?item=' || p_item.id, 'normal'::public.notification_urgency,
    'approval:' || p_item.id || ':' || p_key)
  on conflict do nothing;
end;
$$;
revoke all on function app.notify_approval_requester(public.approval_item, text, text, text) from public, anon, authenticated;

create or replace function app.audit_approval(p_item public.approval_item, p_action text, p_metadata jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action,
    object_type, object_id, metadata)
  values (p_item.organization_id, auth.uid(), 'user', 'approval', p_action,
    'approval_item', p_item.id,
    jsonb_build_object('subject_type', p_item.subject_type, 'subject_id', p_item.subject_id,
      'amount_cents', p_item.amount_cents, 'status', p_item.status) || coalesce(p_metadata, '{}'::jsonb));
$$;
revoke all on function app.audit_approval(public.approval_item, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public functions (the only way to write items, steps and events)
-- ---------------------------------------------------------------------------

create or replace function public.submit_approval(
  p_organization uuid,
  p_subject_type text,
  p_title text,
  p_amount_cents bigint default null,
  p_program_id uuid default null,
  p_description text default null,
  p_subject_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item public.approval_item;
  v_amount bigint;
  v_lead uuid;
  v_approver uuid;
  v_kind text;
  r record;
begin
  if v_uid is null or not app.is_org_staff(p_organization) then
    raise exception 'Only staff can submit items for approval' using errcode = '42501';
  end if;
  if p_program_id is not null and not exists (
    select 1 from public.program p where p.id = p_program_id and p.organization_id = p_organization
  ) then
    raise exception 'Program is not in this organization' using errcode = '23514';
  end if;

  insert into public.approval_item (organization_id, subject_type, subject_id, title,
    description, amount_cents, program_id, requested_by)
  values (p_organization, p_subject_type, p_subject_id, btrim(coalesce(p_title, '')),
    nullif(btrim(coalesce(p_description, '')), ''), p_amount_cents, p_program_id, v_uid)
  returning * into v_item;

  v_amount := coalesce(p_amount_cents, 0);
  select p.lead_id into v_lead from public.program p where p.id = p_program_id;

  for r in
    select * from public.approval_rule ar
    where ar.organization_id = p_organization and ar.active
      and (ar.subject_type is null or ar.subject_type = p_subject_type)
      and (ar.program_id is null or ar.program_id = p_program_id)
      and v_amount >= ar.min_amount_cents
      and (ar.max_amount_cents is null or v_amount < ar.max_amount_cents)
    order by ar.step, ar.created_at, ar.id
  loop
    v_kind := r.approver_kind;
    v_approver := case r.approver_kind
      when 'person' then r.approver_user_id
      when 'program_lead' then v_lead
      else null end;
    -- Nobody is routed their own request, and a missing or departed approver
    -- falls back to the administrators rather than stalling the item.
    if v_kind <> 'admins' and (v_approver is null or v_approver = v_uid or not exists (
      select 1 from public.organization_membership m
      where m.organization_id = p_organization and m.user_id = v_approver
        and m.status = 'active' and m.role in ('owner', 'admin', 'staff')
    )) then
      v_kind := 'admins';
      v_approver := null;
    else
      v_kind := case when v_kind = 'admins' then 'admins' else 'person' end;
    end if;
    if not exists (
      select 1 from public.approval_step s
      where s.item_id = v_item.id and s.step = r.step
        and s.approver_kind = v_kind and s.approver_id is not distinct from v_approver
    ) then
      insert into public.approval_step (item_id, organization_id, step, rule_id, label, approver_kind, approver_id)
      values (v_item.id, p_organization, r.step, r.id, r.label, v_kind, v_approver);
    end if;
  end loop;

  -- No rule matched: an administrator decides.
  if not exists (select 1 from public.approval_step s where s.item_id = v_item.id) then
    insert into public.approval_step (item_id, organization_id, step, label, approver_kind)
    values (v_item.id, p_organization, 1, 'Administrator', 'admins');
  end if;

  update public.approval_item
  set current_step = (select min(s.step) from public.approval_step s where s.item_id = v_item.id)
  where id = v_item.id
  returning * into v_item;

  insert into public.approval_event (item_id, organization_id, actor_id, kind, step)
  values (v_item.id, p_organization, v_uid, 'submitted', v_item.current_step);
  perform app.notify_approvers(v_item);
  perform app.audit_approval(v_item, 'submitted');
  return v_item.id;
end;
$$;
revoke all on function public.submit_approval(uuid, text, text, bigint, uuid, text, uuid) from public, anon;
grant execute on function public.submit_approval(uuid, text, text, bigint, uuid, text, uuid) to authenticated;

create or replace function public.decide_approval(p_item uuid, p_decision text, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item public.approval_item;
  v_step public.approval_step;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_next smallint;
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

  -- The caller's own step first, then an "any administrator" step, then (for
  -- an owner/admin covering an absence) someone else's.
  select s.* into v_step
  from public.approval_step s
  where s.item_id = p_item and app.can_decide_approval_step(s, v_item)
  order by (s.approver_id = v_uid) desc nulls last, (s.approver_kind = 'admins') desc, s.created_at
  limit 1
  for update;
  if not found then
    raise exception 'You are not an approver for this step' using errcode = '42501';
  end if;

  update public.approval_step
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      decided_by = v_uid, decided_at = now(), note = v_note
  where id = v_step.id;

  insert into public.approval_event (item_id, organization_id, actor_id, kind, step, note)
  values (p_item, v_item.organization_id, v_uid,
    case when p_decision = 'approve' then 'approved' else 'rejected' end, v_step.step, v_note);

  if p_decision = 'reject' then
    update public.approval_step set status = 'cancelled'
    where item_id = p_item and status = 'pending';
    update public.approval_item
    set status = 'rejected', decided_by = v_uid, decided_at = now(),
        decision_note = v_note, updated_at = now()
    where id = p_item returning * into v_item;
    perform app.notify_approval_requester(v_item, 'Rejected: ' || v_item.title, v_note, 'rejected');
    perform app.audit_approval(v_item, 'rejected', jsonb_build_object('step', v_step.step));
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
      insert into public.approval_event (item_id, organization_id, actor_id, kind, step)
      values (p_item, v_item.organization_id, v_uid, 'completed', v_step.step);
      perform app.notify_approval_requester(v_item, 'Approved: ' || v_item.title, v_note, 'approved');
    else
      update public.approval_item set current_step = v_next, updated_at = now()
      where id = p_item returning * into v_item;
      perform app.notify_approvers(v_item);
    end if;
  else
    update public.approval_item set updated_at = now() where id = p_item returning * into v_item;
  end if;
  perform app.audit_approval(v_item, 'approved', jsonb_build_object('step', v_step.step));
  return v_item.status;
end;
$$;
revoke all on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

-- Ask a question or answer one. Anyone who can see a pending item may comment;
-- the other side is notified.
create or replace function public.comment_on_approval(p_item uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item public.approval_item;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_event uuid;
begin
  select * into v_item from public.approval_item where id = p_item;
  if not found or not app.can_read_approval_item(p_item) then
    raise exception 'That approval is not available to you' using errcode = '42501';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'That approval was already settled' using errcode = '22023';
  end if;
  if v_note is null or char_length(v_note) > 2000 then
    raise exception 'A comment needs between 1 and 2000 characters' using errcode = '22023';
  end if;
  insert into public.approval_event (item_id, organization_id, actor_id, kind, step, note)
  values (p_item, v_item.organization_id, v_uid, 'commented', v_item.current_step, v_note)
  returning id into v_event;
  if v_uid = v_item.requested_by then
    insert into public.notification (user_id, organization_id, category, title, body,
      source_type, source_id, link, dedupe_key)
    select distinct s.approver_id, v_item.organization_id, 'approval',
      'Reply on: ' || v_item.title, v_note, 'approval_item', v_item.id,
      '/approvals?item=' || v_item.id, 'approval:' || v_item.id || ':' || s.approver_id || ':c' || v_event
    from public.approval_step s
    where s.item_id = p_item and s.step = v_item.current_step and s.status = 'pending'
      and s.approver_id is not null and s.approver_id <> v_uid
    on conflict do nothing;
  else
    perform app.notify_approval_requester(v_item, 'Question on: ' || v_item.title, v_note, 'c' || v_event);
  end if;
  perform app.audit_approval(v_item, 'commented');
  return v_event;
end;
$$;
revoke all on function public.comment_on_approval(uuid, text) from public, anon;
grant execute on function public.comment_on_approval(uuid, text) to authenticated;

create or replace function public.withdraw_approval(p_item uuid, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item public.approval_item;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_item from public.approval_item where id = p_item for update;
  if not found or not app.can_read_approval_item(p_item) then
    raise exception 'That approval is not available to you' using errcode = '42501';
  end if;
  if v_item.requested_by <> v_uid then
    raise exception 'Only the requester can withdraw a request' using errcode = '42501';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'That approval was already settled' using errcode = '22023';
  end if;
  update public.approval_step set status = 'cancelled' where item_id = p_item and status = 'pending';
  update public.approval_item
  set status = 'withdrawn', decided_at = now(), decision_note = left(v_note, 2000), updated_at = now()
  where id = p_item returning * into v_item;
  insert into public.approval_event (item_id, organization_id, actor_id, kind, step, note)
  values (p_item, v_item.organization_id, v_uid, 'withdrawn', v_item.current_step, left(v_note, 2000));
  perform app.audit_approval(v_item, 'withdrawn');
  return v_item.status;
end;
$$;
revoke all on function public.withdraw_approval(uuid, text) from public, anon;
grant execute on function public.withdraw_approval(uuid, text) to authenticated;

-- The items the caller can decide right now: their inbox.
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
        -- An owner/admin covering for a named person sees those items under
        -- "All pending", not in their own inbox.
        and (s.approver_id = auth.uid() or s.approver_kind = 'admins')
    )
  order by i.created_at;
$$;
revoke all on function public.approval_inbox() from public, anon;
grant execute on function public.approval_inbox() to authenticated;
