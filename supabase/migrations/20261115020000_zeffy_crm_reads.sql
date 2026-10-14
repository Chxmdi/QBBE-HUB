-- QBBE Hub — reading Zeffy giving in the CRM.
--
-- zeffy_payment is readable only by finance readers. These functions let the
-- CRM screens show staff what a supporter did (campaign, date, kind) without
-- amounts, and show finance readers the amounts, from one place each:
--   * zeffy_supporter_activity(contact)     - a supporter's timeline
--   * zeffy_supporter_totals(org, purpose)  - giving per supporter, finance
--                                             only, audited like the donor list
--   * zeffy_overview(org, from, to)         - the Zeffy page's figures
--   * zeffy_resolve_match(match, contact)   - staff place a supporter the
--                                             sync could not
-- Net amounts subtract refunds that went through. Failed and deleted payments
-- never count.

-- ---------------------------------------------------------------------------
-- A supporter's Zeffy timeline. Staff: what and when. Finance: how much.
-- ---------------------------------------------------------------------------
create or replace function public.zeffy_supporter_activity(p_contact uuid)
returns table (
  zeffy_id text,
  paid_at timestamptz,
  campaign_title text,
  campaign_category text,
  item_kinds text[],
  status text,
  refund_status text,
  dispute_status text,
  is_recurring boolean,
  recurring_interval text,
  currency text,
  amount_cents bigint,
  refunded_cents bigint,
  receipt_url text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_zeffy text;
  v_finance boolean;
begin
  select c.organization_id, c.zeffy_contact_id into v_org, v_zeffy
  from public.crm_contact c where c.id = p_contact;
  if v_org is null or not app.can_access_crm(v_org) then
    raise exception 'You do not have access to this supporter' using errcode = '42501';
  end if;
  if v_zeffy is null then
    return;
  end if;
  v_finance := app.can_read_ledger(v_org);
  if v_finance then
    perform app.record_material_audit(v_org, 'zeffy', 'supporter_giving_viewed',
      'crm_contact', p_contact, '{}'::jsonb);
  end if;

  return query
  select p.zeffy_id, p.paid_at, p.campaign_title, p.campaign_category, p.item_kinds,
    p.status, p.refund_status, p.dispute_status, p.is_recurring, p.recurring_interval,
    p.currency,
    case when v_finance then p.amount_cents end,
    case when v_finance then p.refunded_cents end,
    case when v_finance then p.receipt_url end
  from public.zeffy_payment p
  where p.organization_id = v_org
    and p.zeffy_contact_id = v_zeffy
    and p.deleted_at is null
    and p.status <> 'failed'
  order by p.paid_at desc
  limit 500;
end;
$$;

revoke all on function public.zeffy_supporter_activity(uuid) from public, anon;
grant execute on function public.zeffy_supporter_activity(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Giving per supporter. Finance readers only; every call audited (view or
-- export), as with the gift donor list. Optionally one supporter.
-- ---------------------------------------------------------------------------
create or replace function public.zeffy_supporter_totals(
  p_organization uuid, p_purpose text default 'view', p_contact uuid default null
)
returns table (
  contact_id uuid,
  full_name text,
  email text,
  currency text,
  net_cents bigint,
  this_year_cents bigint,
  payment_count bigint,
  first_paid_at timestamptz,
  last_paid_at timestamptz,
  last_amount_cents bigint,
  recurring_active boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.can_read_ledger(p_organization) then
    raise exception 'You do not have access to donor records' using errcode = '42501';
  end if;
  if p_purpose not in ('view', 'export') then
    raise exception 'Purpose must be view or export' using errcode = '22023';
  end if;
  perform app.record_material_audit(p_organization, 'zeffy',
    case when p_purpose = 'export' then 'supporter_list_exported' else 'supporter_list_viewed' end,
    case when p_contact is null then 'organization' else 'crm_contact' end,
    coalesce(p_contact, p_organization), '{}'::jsonb);

  return query
  with counted as (
    select c.id as contact_id, c.full_name, c.email, p.currency, p.paid_at,
      p.amount_cents - p.refunded_cents as net, p.amount_cents,
      p.is_recurring and coalesce(p.recurring_status, 'active') = 'active' as recurring_active
    from public.crm_contact c
    join public.zeffy_payment p
      on p.organization_id = c.organization_id and p.zeffy_contact_id = c.zeffy_contact_id
    where c.organization_id = p_organization
      and (p_contact is null or c.id = p_contact)
      and p.deleted_at is null
      and p.status = 'succeeded'
  )
  select k.contact_id, max(k.full_name), max(k.email), max(k.currency),
    sum(k.net)::bigint,
    coalesce(sum(k.net) filter (where k.paid_at >= date_trunc('year', now())), 0)::bigint,
    count(*),
    min(k.paid_at), max(k.paid_at),
    (array_agg(k.amount_cents order by k.paid_at desc))[1]::bigint,
    bool_or(k.recurring_active)
  from counted k
  group by k.contact_id;
end;
$$;

revoke all on function public.zeffy_supporter_totals(uuid, text, uuid) from public, anon;
grant execute on function public.zeffy_supporter_totals(uuid, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The Zeffy page's figures for a period. Staff get counts (supporters,
-- attendance per campaign); finance readers also get money. Monthly recurring
-- normalizes each active recurring donation's latest amount to a month.
-- ---------------------------------------------------------------------------
create or replace function public.zeffy_overview(p_organization uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_finance boolean;
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
  v_money jsonb := null;
begin
  if not app.can_access_crm(p_organization) then
    raise exception 'You do not have access to supporters' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a date range' using errcode = '22023';
  end if;
  v_finance := app.can_read_ledger(p_organization);
  v_from := p_from::timestamptz;
  v_to := (p_to + 1)::timestamptz;

  with good as (
    select * from public.zeffy_payment p
    where p.organization_id = p_organization and p.deleted_at is null and p.status = 'succeeded'
  ),
  firsts as (
    select zeffy_contact_id, min(paid_at) as first_at from good
    where zeffy_contact_id is not null group by zeffy_contact_id
  )
  select jsonb_build_object(
    'supporters', (select count(*) from public.crm_contact c
                   where c.organization_id = p_organization and c.zeffy_contact_id is not null),
    'new_supporters', (select count(*) from firsts where first_at >= v_from and first_at < v_to),
    'payments', (select count(*) from good where paid_at >= v_from and paid_at < v_to),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('campaign_id', a.zeffy_campaign_id, 'title', a.title,
        'tickets', a.tickets, 'buyers', a.buyers) order by a.tickets desc)
      from (
        select g.zeffy_campaign_id, max(g.campaign_title) as title,
          sum((select count(*) from jsonb_array_elements(g.items) i where i->>'type' = 'ticket')) as tickets,
          count(distinct g.zeffy_contact_id) as buyers
        from good g
        where g.paid_at >= v_from and g.paid_at < v_to and 'ticket' = any(g.item_kinds)
          and g.refund_status <> 'full'
        group by g.zeffy_campaign_id
      ) a
    ), '[]'::jsonb),
    'needs_matching', (select count(*) from public.zeffy_contact_match m
                       where m.organization_id = p_organization and m.resolved_at is null),
    -- Staff cannot read integration_connection (admins only); the page still
    -- needs to say whether Zeffy is connected and when it last synced.
    'connection', (select jsonb_build_object('status', ic.status, 'last_sync_at', ic.last_sync_at)
                   from public.integration_connection ic
                   where ic.organization_id = p_organization and ic.provider = 'zeffy' and ic.user_id is null
                   limit 1)
  ) into v_result;

  if v_finance then
    with good as (
      select * from public.zeffy_payment p
      where p.organization_id = p_organization and p.deleted_at is null and p.status = 'succeeded'
    ),
    donors as (
      select zeffy_contact_id, max(paid_at) as last_at from good
      where zeffy_contact_id is not null and 'donor' = any(item_kinds) and refund_status <> 'full'
      group by zeffy_contact_id
    ),
    recurring as (
      select distinct on (coalesce(zeffy_contact_id, zeffy_id), recurring_interval)
        amount_cents, recurring_interval, recurring_status
      from good
      where is_recurring
      order by coalesce(zeffy_contact_id, zeffy_id), recurring_interval, paid_at desc
    )
    select jsonb_build_object(
      'currency', coalesce((select currency from good group by currency order by count(*) desc limit 1), 'cad'),
      'raised_cents', coalesce((select sum(amount_cents - refunded_cents) from good
                                where paid_at >= v_from and paid_at < v_to), 0),
      'raised_year_cents', coalesce((select sum(amount_cents - refunded_cents) from good
                                     where paid_at >= date_trunc('year', now())), 0),
      'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('category', coalesce(campaign_category, 'custom'), 'cents', cents)
          order by cents desc)
        from (select campaign_category, sum(amount_cents - refunded_cents) as cents from good
              where paid_at >= v_from and paid_at < v_to group by campaign_category) x
      ), '[]'::jsonb),
      'recurring_donors', (select count(*) from recurring where coalesce(recurring_status, 'active') = 'active'),
      'monthly_recurring_cents', coalesce((
        select round(sum(case recurring_interval
          when 'weekly' then amount_cents * 52.0 / 12
          when 'yearly' then amount_cents / 12.0
          when 'annually' then amount_cents / 12.0
          when 'quarterly' then amount_cents / 3.0
          else amount_cents end))
        from recurring where coalesce(recurring_status, 'active') = 'active'
      ), 0),
      'lapsed_donors', (select count(*) from donors
                        where last_at < now() - interval '12 months'
                          and last_at >= now() - interval '24 months'),
      'refunded_cents', coalesce((select sum(refunded_cents) from good
                                  where paid_at >= v_from and paid_at < v_to), 0),
      'disputes_open', (select count(*) from good where dispute_status = 'needs_response')
    ) into v_money;
  end if;

  return v_result || jsonb_build_object('money', v_money);
end;
$$;

revoke all on function public.zeffy_overview(uuid, date, date) from public, anon;
grant execute on function public.zeffy_overview(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Staff place a supporter the sync could not: one of the candidate contacts,
-- or a new contact. Audited.
-- ---------------------------------------------------------------------------
create or replace function public.zeffy_resolve_match(p_match uuid, p_contact uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.zeffy_contact_match%rowtype;
  v_contact uuid;
begin
  select * into v_match from public.zeffy_contact_match where id = p_match for update;
  if v_match.id is null or not app.can_access_crm(v_match.organization_id) then
    raise exception 'You do not have access to this supporter' using errcode = '42501';
  end if;
  if v_match.resolved_at is not null then
    raise exception 'This supporter has already been placed' using errcode = '22023';
  end if;
  perform set_config('app.zeffy_link', 'on', true);

  if p_contact is null then
    insert into public.crm_contact (organization_id, full_name, email, status, source, zeffy_contact_id)
    values (v_match.organization_id, v_match.full_name, v_match.email, 'active', 'zeffy', v_match.zeffy_contact_id)
    returning id into v_contact;
  else
    if not p_contact = any(v_match.candidate_ids) then
      raise exception 'Choose one of the suggested contacts' using errcode = '22023';
    end if;
    update public.crm_contact
    set zeffy_contact_id = v_match.zeffy_contact_id
    where id = p_contact and organization_id = v_match.organization_id and zeffy_contact_id is null
    returning id into v_contact;
    if v_contact is null then
      raise exception 'That contact is already linked to another Zeffy supporter' using errcode = '22023';
    end if;
  end if;

  update public.zeffy_contact_match set resolved_at = now() where id = p_match;
  perform public.zeffy_refresh_supporter_kinds(v_match.organization_id, array[v_match.zeffy_contact_id]);
  perform set_config('app.zeffy_link', 'off', true);
  perform app.record_material_audit(v_match.organization_id, 'zeffy', 'supporter_matched',
    'crm_contact', v_contact, jsonb_build_object('zeffy_contact_id', v_match.zeffy_contact_id,
      'created', p_contact is null));
  return v_contact;
end;
$$;

revoke all on function public.zeffy_resolve_match(uuid, uuid) from public, anon;
grant execute on function public.zeffy_resolve_match(uuid, uuid) to authenticated, service_role;
