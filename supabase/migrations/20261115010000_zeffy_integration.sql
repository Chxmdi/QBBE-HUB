-- QBBE Hub — Zeffy as a read-only source for the CRM.
--
-- QBBE takes donations, event tickets and memberships through Zeffy. The Hub
-- pulls them in (API sync every 15 minutes, plus Zeffy's signed webhooks) so
-- staff see who supports QBBE and finance readers see how much they gave.
-- Nothing here writes to Zeffy and nothing posts to the ledger: Zeffy stays
-- the record of the money, the Hub is the place people look at it.
--
-- Access follows the rules already in force:
--   * supporters are CRM contacts, so staff read them (app.can_access_crm);
--   * amounts are donor financial data, so only ledger readers see payments
--     (app.can_read_ledger), as with gifts;
--   * only the server (service role) writes any of it.
--
-- Least privilege (Quebec Law 25): the Hub keeps who paid, for what, when and
-- how much. It does not keep postal addresses, answers to checkout questions,
-- payment method details, discount codes or the names in tribute gifts.

-- ---------------------------------------------------------------------------
-- 1. Supporters are CRM contacts that came from, or were linked to, Zeffy.
-- ---------------------------------------------------------------------------
alter table public.crm_contact
  add column if not exists source text not null default 'hub',
  add column if not exists zeffy_contact_id text,
  add column if not exists zeffy_kinds text[] not null default '{}',
  add column if not exists zeffy_last_activity_at timestamptz;

alter table public.crm_contact
  drop constraint if exists crm_contact_source_check;
alter table public.crm_contact
  add constraint crm_contact_source_check check (source in ('hub', 'zeffy'));

comment on column public.crm_contact.source is
  'Where the contact was first created: entered in the Hub, or imported from Zeffy.';
comment on column public.crm_contact.zeffy_contact_id is
  'The Zeffy contact this CRM contact is linked to. Set only by the Zeffy sync or by matching.';
comment on column public.crm_contact.zeffy_kinds is
  'What the supporter did through Zeffy (donor, ticket, member, shop, recurring, ...). No amounts.';

create unique index if not exists uq_crm_contact_zeffy
  on public.crm_contact (organization_id, zeffy_contact_id)
  where zeffy_contact_id is not null;
create index if not exists idx_crm_contact_org_email
  on public.crm_contact (organization_id, lower(email))
  where email is not null;

-- Staff edit contacts freely, but the Zeffy link decides whose giving a
-- contact shows. Only the server, or a database function that sets
-- app.zeffy_link for its own transaction, may change these columns.
create or replace function app.protect_crm_contact_zeffy_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.zeffy_link', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.source <> 'hub'
       or new.zeffy_contact_id is not null
       or new.zeffy_kinds <> '{}'::text[]
       or new.zeffy_last_activity_at is not null then
      raise exception 'Zeffy details are set by the Zeffy sync only.' using errcode = '42501';
    end if;
  elsif new.source is distinct from old.source
     or new.zeffy_contact_id is distinct from old.zeffy_contact_id
     or new.zeffy_kinds is distinct from old.zeffy_kinds
     or new.zeffy_last_activity_at is distinct from old.zeffy_last_activity_at then
    raise exception 'Zeffy details are set by the Zeffy sync only.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_contact_zeffy_fields on public.crm_contact;
create trigger crm_contact_zeffy_fields
  before insert or update on public.crm_contact
  for each row execute function app.protect_crm_contact_zeffy_fields();

-- ---------------------------------------------------------------------------
-- 2. Campaigns: donation forms and ticketed events. Their goal and the amount
--    raised are public on Zeffy's own pages, so staff may read them.
-- ---------------------------------------------------------------------------
create table if not exists public.zeffy_campaign (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  zeffy_id text not null,
  campaign_type text,
  category text,
  status text,
  title text not null default '',
  url text check (url is null or url ~ '^https://'),
  goal_cents bigint,
  raised_cents bigint,
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_archived boolean not null default false,
  deleted_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (organization_id, zeffy_id)
);

comment on table public.zeffy_campaign is
  'Zeffy campaigns (donation forms, ticketed events), copied by the Zeffy sync. Staff read; only the server writes.';

-- ---------------------------------------------------------------------------
-- 3. Payments: donations, tickets, memberships, shop orders. Amounts are in
--    cents. A payment belongs to a supporter through zeffy_contact_id, joined
--    to crm_contact.zeffy_contact_id, so matching a supporter later brings
--    their payments along without rewriting them.
-- ---------------------------------------------------------------------------
create table if not exists public.zeffy_payment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  zeffy_id text not null,
  zeffy_contact_id text,
  zeffy_campaign_id text,
  campaign_title text,
  campaign_category text,
  paid_at timestamptz not null,
  amount_cents bigint not null,
  eligible_amount_cents bigint,
  refunded_cents bigint not null default 0,
  currency text not null,
  status text not null,
  payment_type text,
  refund_status text not null default 'none',
  dispute_status text,
  is_recurring boolean not null default false,
  recurring_interval text,
  recurring_status text,
  fund_code text,
  fund_names jsonb,
  receipt_url text check (receipt_url is null or receipt_url ~ '^https://'),
  company_name text,
  item_kinds text[] not null default '{}',
  items jsonb not null default '[]'::jsonb,
  deleted_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (organization_id, zeffy_id)
);

create index if not exists idx_zeffy_payment_contact
  on public.zeffy_payment (organization_id, zeffy_contact_id, paid_at desc);
create index if not exists idx_zeffy_payment_paid
  on public.zeffy_payment (organization_id, paid_at desc);
create index if not exists idx_zeffy_payment_campaign
  on public.zeffy_payment (organization_id, zeffy_campaign_id);

comment on table public.zeffy_payment is
  'Zeffy payments copied by the Zeffy sync. Donor financial data: only ledger readers see it; only the server writes.';
comment on column public.zeffy_payment.fund_names is
  'The Zeffy fund''s names by language, for example {"EN": "General Fund", "FR": "Fonds général"}.';
comment on column public.zeffy_payment.items is
  'Line items as [{type, amount_cents, title}]. Attendee answers and tribute names are not kept.';

-- ---------------------------------------------------------------------------
-- 4. Supporters the sync could not place on its own: more than one CRM contact
--    has their email address. Staff choose (CRM screens). No amounts here.
-- ---------------------------------------------------------------------------
create table if not exists public.zeffy_contact_match (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  zeffy_contact_id text not null,
  full_name text not null default '',
  email text,
  candidate_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (organization_id, zeffy_contact_id)
);

comment on table public.zeffy_contact_match is
  'Zeffy supporters waiting for staff to pick which CRM contact they are (several contacts share their email).';

-- ---------------------------------------------------------------------------
-- 5. Webhook deliveries, keyed by Zeffy's event id: Zeffy retries a failed
--    delivery for up to 3 days with the same id, so a repeat does nothing.
-- ---------------------------------------------------------------------------
create table if not exists public.zeffy_webhook_event (
  event_id text primary key,
  organization_id uuid references public.organization (id) on delete cascade,
  event_type text not null,
  resource_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create index if not exists idx_zeffy_webhook_event_pending
  on public.zeffy_webhook_event (received_at)
  where processed_at is null;

-- ---------------------------------------------------------------------------
-- 6. Where each organization's sync got to (cursors, last runs).
-- ---------------------------------------------------------------------------
create table if not exists public.zeffy_sync_state (
  organization_id uuid primary key references public.organization (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  last_webhook_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. Access. Reads as described above; no client writes at all.
-- ---------------------------------------------------------------------------
alter table public.zeffy_campaign enable row level security;
alter table public.zeffy_payment enable row level security;
alter table public.zeffy_contact_match enable row level security;
alter table public.zeffy_webhook_event enable row level security;
alter table public.zeffy_sync_state enable row level security;

revoke insert, update, delete, truncate on public.zeffy_campaign from anon, authenticated;
revoke insert, update, delete, truncate on public.zeffy_payment from anon, authenticated;
revoke insert, update, delete, truncate on public.zeffy_contact_match from anon, authenticated;
revoke all on public.zeffy_webhook_event from anon, authenticated;
revoke insert, update, delete, truncate on public.zeffy_sync_state from anon, authenticated;
revoke all on public.zeffy_campaign, public.zeffy_payment, public.zeffy_contact_match,
  public.zeffy_sync_state from anon;

drop policy if exists zeffy_campaign_read on public.zeffy_campaign;
create policy zeffy_campaign_read on public.zeffy_campaign
  for select to authenticated
  using (app.can_access_crm(organization_id));

drop policy if exists zeffy_payment_read on public.zeffy_payment;
create policy zeffy_payment_read on public.zeffy_payment
  for select to authenticated
  using (app.can_read_ledger(organization_id));

drop policy if exists zeffy_contact_match_read on public.zeffy_contact_match;
create policy zeffy_contact_match_read on public.zeffy_contact_match
  for select to authenticated
  using (app.can_access_crm(organization_id));

-- Admins see how far the sync got (Admin > Integrations).
drop policy if exists zeffy_sync_state_admin on public.zeffy_sync_state;
create policy zeffy_sync_state_admin on public.zeffy_sync_state
  for select to authenticated
  using (app.is_org_admin(organization_id));

-- One Zeffy account belongs to one Hub organization: the API key is per
-- Zeffy organization, so two connected Hub organizations would copy the same
-- supporters into both.
create unique index if not exists uq_integration_zeffy_single_org
  on public.integration_connection ((provider))
  where provider = 'zeffy' and user_id is null and status <> 'disconnected';

-- The sync matches a Zeffy buyer to CRM contacts by email, ignoring case.
-- Server only: it reads every contact's email in the organization.
create or replace function public.zeffy_contacts_by_email(p_organization uuid, p_emails text[])
returns table (id uuid, email text, zeffy_contact_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.email, c.zeffy_contact_id
  from public.crm_contact c
  where c.organization_id = p_organization
    and c.email is not null
    and lower(c.email) = any (select lower(e) from unnest(p_emails) as e);
$$;

revoke all on function public.zeffy_contacts_by_email(uuid, text[]) from public, anon, authenticated;
grant execute on function public.zeffy_contacts_by_email(uuid, text[]) to service_role;

-- What each supporter did through Zeffy, and when they last did it, from
-- their payments. A failed, fully refunded or deleted payment does not make
-- someone a donor. One statement for a whole page of supporters. Server only.
create or replace function public.zeffy_refresh_supporter_kinds(
  p_organization uuid, p_zeffy_contact_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  with wanted as (
    select distinct unnest(p_zeffy_contact_ids) as zeffy_contact_id
  ),
  counted as (
    select p.zeffy_contact_id, p.item_kinds, p.paid_at
    from public.zeffy_payment p
    join wanted w on w.zeffy_contact_id = p.zeffy_contact_id
    where p.organization_id = p_organization
      and p.deleted_at is null
      and p.status = 'succeeded'
      and p.refund_status <> 'full'
  ),
  summary as (
    select w.zeffy_contact_id,
      coalesce((
        select array_agg(distinct k order by k)
        from counted c, unnest(c.item_kinds) as k
        where c.zeffy_contact_id = w.zeffy_contact_id
      ), '{}'::text[]) as kinds,
      (select max(c.paid_at) from counted c where c.zeffy_contact_id = w.zeffy_contact_id) as last_at
    from wanted w
  )
  update public.crm_contact c
  set zeffy_kinds = s.kinds,
      zeffy_last_activity_at = s.last_at
  from summary s
  where c.organization_id = p_organization
    and c.zeffy_contact_id = s.zeffy_contact_id
    and (c.zeffy_kinds is distinct from s.kinds
         or c.zeffy_last_activity_at is distinct from s.last_at);
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.zeffy_refresh_supporter_kinds(uuid, text[]) from public, anon, authenticated;
grant execute on function public.zeffy_refresh_supporter_kinds(uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Jobs: the 15-minute sync and the one-minute webhook worker. Both skip
--    quietly when ZEFFY_API_KEY is not set.
-- ---------------------------------------------------------------------------
insert into job_definition (name, description, schedule, queue, batch_size, max_attempts)
values
  ('zeffy-sync',
   'Pulls payments, supporters and campaigns from Zeffy into the CRM.',
   '*/15 * * * *', null, 100, 3),
  ('zeffy-events',
   'Applies the payment and supporter changes Zeffy reported by webhook.',
   '* * * * *', null, 50, 3)
on conflict (name) do nothing;

do $$
declare
  j record;
begin
  for j in
    select name, schedule from job_definition
    where name in ('zeffy-sync', 'zeffy-events')
  loop
    perform cron.unschedule(j.name)
      where exists (select 1 from cron.job c where c.jobname = j.name);
    perform cron.schedule(j.name, j.schedule,
      format('select app.dispatch_job(%L)', j.name));
  end loop;
end;
$$;
