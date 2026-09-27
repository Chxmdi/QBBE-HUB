-- Fund accounting, the two remaining pieces of #149 (epic #140). Builds on
-- the general ledger (migration 20260927100000) and year-end (20260929200000).
--
-- Statement of changes in fund balances:
--   * per fund, for a date range (a fiscal year): the balance at the start,
--     revenue, expenses, transfers and releases, and the balance at the end;
--   * the balance at the end is exactly what ledger_fund_balances reports for
--     the last day, and the funds together add up to the whole ledger's net
--     assets, because every entry balances within each fund;
--   * closing entries (and the reopening entries that undo them) only move
--     revenue and expenses into net assets inside one fund, so they are left
--     out of the middle columns; opening-balance entries count as the balance
--     at the start. Security invoker: row-level security (app.can_read_ledger)
--     decides what is summed.
--
-- Releasing restricted money:
--   * when a restricted fund's conditions are met, an owner or admin who
--     completed MFA releases some or all of its balance to an unrestricted
--     fund. The release is one balanced entry posted through app.ledger_post,
--     with a memo naming the condition met:
--       restricted fund:    debit its net assets (3100 or 3200),
--                           credit 2900 Due to other funds
--       unrestricted fund:  debit 1900 Due from other funds,
--                           credit 3000 Unrestricted net assets
--     so each fund still balances on its own and the money itself (the bank
--     balance) is left where it is;
--   * refused: releasing from an unrestricted fund, into anything but an
--     unrestricted fund, more than the fund's available balance (the lowest
--     balance it has from the release date on, so a back-dated release cannot
--     push a later balance below zero), or into a closed period;
--   * each release is kept with its condition and audited. A mistaken release
--     is corrected like any entry: by reversing it.

-- ---------------------------------------------------------------------------
-- Interfund accounts, for every organization now and later
-- ---------------------------------------------------------------------------
create or replace function app.ledger_seed_interfund(p_organization uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ledger_account (organization_id, code, name, account_type, description)
  values
    (p_organization, '1900', 'Due from other funds', 'asset',
     'What another fund owes this one, such as restricted money released to the general fund.'),
    (p_organization, '2900', 'Due to other funds', 'liability',
     'What this fund owes another one, such as restricted money it has released.')
  on conflict (organization_id, code) do nothing;
end;
$$;
revoke all on function app.ledger_seed_interfund(uuid) from public, anon, authenticated;

create or replace function app.ledger_seed_interfund_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.ledger_seed_interfund(new.id);
  return null;
end;
$$;
revoke all on function app.ledger_seed_interfund_new_organization() from public, anon, authenticated;
-- Named to fire after organization_ledger_seed, which creates the chart.
create trigger organization_ledger_seed_interfund after insert on public.organization
for each row execute function app.ledger_seed_interfund_new_organization();

select app.ledger_seed_interfund(o.id) from public.organization o;

-- ---------------------------------------------------------------------------
-- Statement of changes in fund balances
-- ---------------------------------------------------------------------------
-- Amounts are credit-positive (a fund balance is positive), in cents.
-- closing = opening + revenue - expenses + transfers for every fund.
create or replace function public.ledger_fund_changes(p_organization uuid, p_from date, p_to date)
returns table (
  fund_id uuid,
  code text,
  name text,
  restriction text,
  is_active boolean,
  opening_cents bigint,
  revenue_cents bigint,
  expenses_cents bigint,
  transfers_cents bigint,
  closing_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    select l.fund_id, a.account_type, l.credit_cents - l.debit_cents as amount,
      (e.entry_date < p_from or e.kind = 'opening') as is_opening,
      (e.kind = 'closing' or exists (
        select 1 from public.journal_entry c where c.id = e.reverses_entry_id and c.kind = 'closing'
      )) as is_closing
    from public.journal_line l
    join public.journal_entry e on e.id = l.entry_id
    join public.ledger_account a on a.id = l.account_id
    where l.organization_id = p_organization and e.status = 'posted' and e.entry_date <= p_to
      and a.account_type in ('net_assets', 'revenue', 'expense')
  )
  select f.id, f.code, f.name, f.restriction, f.is_active,
    coalesce(sum(x.amount) filter (where x.is_opening), 0)::bigint,
    coalesce(sum(x.amount) filter (where not x.is_opening and not x.is_closing
                                     and x.account_type = 'revenue'), 0)::bigint,
    coalesce(-sum(x.amount) filter (where not x.is_opening and not x.is_closing
                                      and x.account_type = 'expense'), 0)::bigint,
    coalesce(sum(x.amount) filter (where not x.is_opening and not x.is_closing
                                     and x.account_type = 'net_assets'), 0)::bigint,
    coalesce(sum(x.amount), 0)::bigint
  from public.ledger_fund f
  left join lines x on x.fund_id = f.id
  where f.organization_id = p_organization
  group by f.id, f.code, f.name, f.restriction, f.is_active
  order by f.code;
$$;
revoke all on function public.ledger_fund_changes(uuid, date, date) from public, anon;
grant execute on function public.ledger_fund_changes(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Releases from restriction
-- ---------------------------------------------------------------------------
create table public.ledger_fund_release (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  from_fund_id uuid not null,
  to_fund_id uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 10000000000000),
  release_date date not null,
  condition text not null check (char_length(btrim(condition)) between 1 and 300),
  entry_id uuid not null unique,
  released_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ledger_fund_release_two_funds check (from_fund_id <> to_fund_id),
  foreign key (organization_id, from_fund_id) references public.ledger_fund (organization_id, id),
  foreign key (organization_id, to_fund_id) references public.ledger_fund (organization_id, id),
  foreign key (organization_id, entry_id)
    references public.journal_entry (organization_id, id) on delete cascade
);

create index idx_ledger_fund_release_org on public.ledger_fund_release (organization_id, release_date desc);

comment on table public.ledger_fund_release is
  'Restricted money released to an unrestricted fund once its conditions were met (#149). Written only by ledger_release_restricted.';

alter table public.ledger_fund_release enable row level security;
create policy ledger_fund_release_read on public.ledger_fund_release
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.ledger_fund_release from anon;
revoke insert, update, delete, truncate on public.ledger_fund_release from authenticated;
grant select on public.ledger_fund_release to authenticated;
grant all on public.ledger_fund_release to service_role;

-- What a fund can release on p_as_of: the lowest balance it has from that day
-- on, from posted entries. Never below zero. Security invoker: row-level
-- security applies to the caller (the release function runs it as owner).
create or replace function public.ledger_fund_available_cents(p_fund uuid, p_as_of date)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  with daily as (
    select e.entry_date as d, sum(l.credit_cents - l.debit_cents) as amount
    from public.journal_line l
    join public.journal_entry e on e.id = l.entry_id
    join public.ledger_account a on a.id = l.account_id
    where l.fund_id = p_fund and e.status = 'posted'
      and a.account_type in ('net_assets', 'revenue', 'expense')
    group by e.entry_date
  ),
  running as (
    select d, sum(amount) over (order by d) as balance from daily
  )
  select greatest(0, least(
    coalesce((select r.balance from running r where r.d <= p_as_of order by r.d desc limit 1), 0),
    coalesce((select min(r.balance) from running r where r.d > p_as_of), 9223372036854775807)
  ))::bigint;
$$;
revoke all on function public.ledger_fund_available_cents(uuid, date) from public, anon;
grant execute on function public.ledger_fund_available_cents(uuid, date) to authenticated, service_role;

create or replace function public.ledger_release_restricted(
  p_organization uuid,
  p_from_fund uuid,
  p_to_fund uuid,
  p_amount_cents bigint,
  p_release_date date,
  p_condition text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.ledger_fund;
  v_to public.ledger_fund;
  v_period public.ledger_period;
  v_condition text := btrim(coalesce(p_condition, ''));
  v_available bigint;
  v_restricted_na uuid;
  v_unrestricted_na uuid;
  v_due_from uuid;
  v_due_to uuid;
  v_release uuid := gen_random_uuid();
  v_entry uuid;
  v_number integer;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'The amount to release must be more than zero' using errcode = '22023';
  end if;
  if p_release_date is null then
    raise exception 'Choose the date of the release' using errcode = '22023';
  end if;
  if char_length(v_condition) = 0 or char_length(v_condition) > 300 then
    raise exception 'Name the condition that was met (up to 300 characters)' using errcode = '22023';
  end if;

  -- Serializes releases and posting for this organization, so two releases
  -- cannot both spend the same available balance.
  perform 1 from public.ledger_settings where organization_id = p_organization for update;

  select * into v_from from public.ledger_fund where id = p_from_fund and organization_id = p_organization;
  if not found then
    raise exception 'Fund not found' using errcode = 'P0002';
  end if;
  select * into v_to from public.ledger_fund where id = p_to_fund and organization_id = p_organization;
  if not found then
    raise exception 'Fund not found' using errcode = 'P0002';
  end if;
  if v_from.restriction = 'unrestricted' then
    raise exception 'Fund % is unrestricted; only restricted money is released', v_from.code
      using errcode = '22023';
  end if;
  if v_to.restriction <> 'unrestricted' then
    raise exception 'Released money goes to an unrestricted fund; % is restricted', v_to.code
      using errcode = '22023';
  end if;

  select * into v_period from public.ledger_period p
  where p.organization_id = p_organization and p_release_date between p.starts_on and p.ends_on;
  if not found then
    raise exception 'No fiscal period covers %', p_release_date using errcode = '23514';
  end if;
  if v_period.status = 'closed' then
    raise exception 'Period % is closed; a release cannot be dated in it', v_period.name
      using errcode = '23514';
  end if;

  v_available := public.ledger_fund_available_cents(p_from_fund, p_release_date);
  if p_amount_cents > v_available then
    raise exception 'Fund % has only % available to release on %', v_from.code,
      to_char(v_available / 100.0, 'FM999999999999990.00'), p_release_date
      using errcode = '23514';
  end if;

  select id into v_restricted_na from public.ledger_account
  where organization_id = p_organization and account_type = 'net_assets'
    and code = case v_from.restriction when 'internally_restricted' then '3100' else '3200' end;
  select id into v_unrestricted_na from public.ledger_account
  where organization_id = p_organization and account_type = 'net_assets' and code = '3000';
  select id into v_due_from from public.ledger_account
  where organization_id = p_organization and account_type = 'asset' and code = '1900';
  select id into v_due_to from public.ledger_account
  where organization_id = p_organization and account_type = 'liability' and code = '2900';
  if v_restricted_na is null or v_unrestricted_na is null or v_due_from is null or v_due_to is null then
    raise exception 'Releases need accounts 3000, %, 1900 (asset) and 2900 (liability) in the chart of accounts',
      case v_from.restriction when 'internally_restricted' then '3100' else '3200' end
      using errcode = '23514';
  end if;

  insert into public.journal_entry (organization_id, entry_date, memo, kind, source_type, source_id, created_by)
  values (p_organization, p_release_date,
          left('Release from restricted fund ' || v_from.code || ' to ' || v_to.code
               || '. Condition met: ' || v_condition, 500),
          'standard', 'fund_release', v_release, auth.uid())
  returning id into v_entry;

  insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id, description,
    debit_cents, credit_cents)
  values
    (p_organization, v_entry, 1, v_restricted_na, v_from.id, 'Net assets released from restriction', p_amount_cents, 0),
    (p_organization, v_entry, 2, v_due_to, v_from.id, 'Due to fund ' || v_to.code, 0, p_amount_cents),
    (p_organization, v_entry, 3, v_due_from, v_to.id, 'Due from fund ' || v_from.code, p_amount_cents, 0),
    (p_organization, v_entry, 4, v_unrestricted_na, v_to.id, 'Net assets released from restriction', 0, p_amount_cents);

  v_number := app.ledger_post(v_entry);

  insert into public.ledger_fund_release (id, organization_id, from_fund_id, to_fund_id, amount_cents,
    release_date, condition, entry_id, released_by)
  values (v_release, p_organization, v_from.id, v_to.id, p_amount_cents, p_release_date, v_condition,
    v_entry, auth.uid());

  perform app.record_material_audit(p_organization, 'ledger', 'restricted_released',
    'ledger_fund_release', v_release, jsonb_build_object('from_fund', v_from.code, 'to_fund', v_to.code,
      'amount_cents', p_amount_cents, 'release_date', p_release_date, 'condition', v_condition,
      'entry_id', v_entry, 'entry_number', v_number));
  return v_release;
end;
$$;
revoke all on function public.ledger_release_restricted(uuid, uuid, uuid, bigint, date, text) from public, anon;
grant execute on function public.ledger_release_restricted(uuid, uuid, uuid, bigint, date, text)
  to authenticated, service_role;
