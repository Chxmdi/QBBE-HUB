-- GST/QST tracking and the period return worksheet (#152 B5; epic #140),
-- built on the general ledger (#148, migration 20260927100000).
--
-- QBBE is a Quebec non-profit organization, not a registered charity. Whether
-- it is registered for GST and QST, how often it files, and whether it
-- qualifies for the public service body rebate are the accountant's calls;
-- this migration only stores the answers. Nothing here files anything with
-- the CRA or Revenu Québec.
--
-- What is stored:
--   * sales_tax_rate: GST and QST rates with the dates they apply, as exact
--     decimals (never floats). Rates are law, so they are shared by every
--     organization and changed only by a migration;
--   * sales_tax_settings: per organization, registered or not, registration
--     numbers (plain text), filing frequency, and the share of input tax
--     credits it may claim;
--   * sales_tax_period: the reporting periods, closed once the return is done;
--   * sales_tax_line: one row per taxable transaction, a sale (tax collected)
--     or a purchase (tax paid, and the part claimed back as an input tax
--     credit, ITC, for GST or input tax refund, ITR, for QST). Receipts
--     (#142) are brought in by sales_tax_import_receipts; bills and invoices
--     (#150) write rows with their own source_type and source_id.
--
-- What the database guarantees, whoever the caller is:
--   * a line dated in a closed tax period cannot be added, changed or removed;
--   * only standard-rated lines carry tax, and no more can be claimed back
--     than was paid;
--   * closing a period posts its net tax to the ledger in one balanced entry,
--     and reopening it reverses that entry.
--
-- How the figures map to the lines of the returns, and the rebate
-- percentages, live in one TypeScript module for the accountant to review:
-- src/features/sales-tax/return-lines.ts. The closing entry uses only total
-- tax collected (return line 105 / 205) and total claimed back (108 / 208).
--
-- Who does what: the same people as the ledger. Owners and admins who
-- completed MFA (app.is_org_admin) keep the tax records; ledger readers
-- (app.can_read_ledger) see them read-only; everyone else sees nothing.

-- ---------------------------------------------------------------------------
-- Rates
-- ---------------------------------------------------------------------------
create table public.sales_tax_rate (
  id uuid primary key default gen_random_uuid(),
  tax text not null check (tax in ('gst', 'qst')),
  -- Percent as an exact decimal: 5.00000 is 5 %, 9.97500 is 9.975 %.
  rate_percent numeric(8, 5) not null check (rate_percent >= 0 and rate_percent < 100),
  effective_from date not null,
  effective_to date,
  note text,
  unique (tax, effective_from),
  constraint sales_tax_rate_dates_ordered check (effective_to is null or effective_from <= effective_to)
);

comment on table public.sales_tax_rate is
  'GST and QST rates by date (#152). Shared by all organizations; changed only by a migration.';

insert into public.sales_tax_rate (tax, rate_percent, effective_from, note) values
  ('gst', 5.00000, '2008-01-01', 'Federal GST, Excise Tax Act'),
  -- Since 2013 QST is calculated on the price before GST.
  ('qst', 9.97500, '2013-01-01', 'Quebec QST, Act respecting the Québec sales tax');

alter table public.sales_tax_rate enable row level security;
-- Public law, not organization data: any signed-in user may read it.
create policy sales_tax_rate_read on public.sales_tax_rate
for select to authenticated using (auth.uid() is not null);
revoke all on public.sales_tax_rate from anon;
revoke insert, update, delete, truncate on public.sales_tax_rate from authenticated;
grant select on public.sales_tax_rate to authenticated;
grant all on public.sales_tax_rate to service_role;

create or replace function app.sales_tax_rate_on(p_tax text, p_date date)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
begin
  select r.rate_percent into v_rate from public.sales_tax_rate r
  where r.tax = p_tax and r.effective_from <= p_date
    and (r.effective_to is null or p_date <= r.effective_to)
  order by r.effective_from desc
  limit 1;
  if v_rate is null then
    raise exception 'No % rate applies on %', upper(p_tax), p_date using errcode = '22023';
  end if;
  return v_rate;
end;
$$;
revoke all on function app.sales_tax_rate_on(text, date) from public, anon, authenticated;

-- Tax on an amount in cents at a percent rate. Rounding rule: to the nearest
-- cent, half a cent rounds up (away from zero). Postgres rounds a numeric
-- exactly this way; the TypeScript preview in return-lines.ts does the same.
create or replace function app.sales_tax_amount(p_amount_cents bigint, p_rate_percent numeric)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select round(p_amount_cents::numeric * p_rate_percent / 100)::bigint;
$$;
revoke all on function app.sales_tax_amount(bigint, numeric) from public, anon;
grant execute on function app.sales_tax_amount(bigint, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.sales_tax_settings (
  organization_id uuid primary key references public.organization (id) on delete cascade,
  gst_registered boolean not null default false,
  gst_number text check (gst_number is null or char_length(btrim(gst_number)) between 1 and 40),
  qst_registered boolean not null default false,
  qst_number text check (qst_number is null or char_length(btrim(qst_number)) between 1 and 40),
  filing_frequency text not null default 'annual'
    check (filing_frequency in ('monthly', 'quarterly', 'annual')),
  -- Share of the tax paid on purchases that may be claimed back, in basis
  -- points (10000 = all of it). An organization making exempt supplies
  -- usually claims less; the accountant sets the figure.
  itc_claim_bp integer not null default 10000 check (itc_claim_bp between 0 and 10000),
  -- Shows the public service body rebate worksheet. Off until the accountant
  -- confirms QBBE qualifies.
  show_psb_rebate boolean not null default false,
  updated_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sales_tax_settings is
  'GST/QST registration and filing settings per organization (#152). Registration numbers are plain text.';

alter table public.sales_tax_settings enable row level security;
create policy sales_tax_settings_read on public.sales_tax_settings
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.sales_tax_settings from anon;
revoke insert, update, delete, truncate on public.sales_tax_settings from authenticated;
grant select on public.sales_tax_settings to authenticated;
grant all on public.sales_tax_settings to service_role;

-- ---------------------------------------------------------------------------
-- Reporting periods
-- ---------------------------------------------------------------------------
create table public.sales_tax_period (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  -- Figures posted to the ledger when the period was closed.
  gst_collected_cents bigint,
  gst_claimed_cents bigint,
  qst_collected_cents bigint,
  qst_claimed_cents bigint,
  closing_entry_id uuid references public.journal_entry (id),
  closed_by uuid references public.user_profile (id) on delete set null,
  closed_at timestamptz,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, starts_on),
  constraint sales_tax_period_dates_ordered check (starts_on <= ends_on),
  constraint sales_tax_period_close_recorded check (
    (status = 'closed') = (closed_at is not null)
    and (status = 'closed') = (gst_collected_cents is not null)
  )
);

create index idx_sales_tax_period_org_dates on public.sales_tax_period (organization_id, starts_on, ends_on);

alter table public.sales_tax_period enable row level security;
create policy sales_tax_period_read on public.sales_tax_period
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.sales_tax_period from anon;
revoke insert, update, delete, truncate on public.sales_tax_period from authenticated;
grant select on public.sales_tax_period to authenticated;
grant all on public.sales_tax_period to service_role;

create or replace function app.protect_sales_tax_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'closed' then
      raise exception 'A closed tax period cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' and (new.organization_id, new.starts_on, new.ends_on)
       is distinct from (old.organization_id, old.starts_on, old.ends_on) then
    raise exception 'A tax period''s dates cannot change' using errcode = '42501';
  end if;
  if exists (select 1 from public.sales_tax_period p
             where p.organization_id = new.organization_id and p.id <> new.id
               and p.starts_on <= new.ends_on and new.starts_on <= p.ends_on) then
    raise exception 'Tax periods cannot overlap' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_sales_tax_period() from public, anon, authenticated;
create trigger sales_tax_period_protect before insert or update or delete on public.sales_tax_period
for each row execute function app.protect_sales_tax_period();

-- ---------------------------------------------------------------------------
-- Tax lines
-- ---------------------------------------------------------------------------
create table public.sales_tax_line (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  direction text not null check (direction in ('sale', 'purchase')),
  -- standard: taxable at the GST and QST rates; zero_rated: taxable at 0 %
  -- (counts as a taxable supply); exempt: no tax, and no credit for tax paid
  -- to make it; out_of_scope: not a supply at all (a grant, a donation).
  tax_code text not null check (tax_code in ('standard', 'zero_rated', 'exempt', 'out_of_scope')),
  transaction_date date not null,
  counterparty text not null check (char_length(btrim(counterparty)) between 1 and 200),
  reference text check (reference is null or char_length(reference) <= 100),
  description text check (description is null or char_length(description) <= 500),
  -- Amount before tax, then tax, all in integer cents.
  amount_cents bigint not null check (amount_cents between 0 and 10000000000000),
  gst_cents bigint not null default 0 check (gst_cents between 0 and 10000000000000),
  qst_cents bigint not null default 0 check (qst_cents between 0 and 10000000000000),
  -- Purchases only: the part of the tax paid claimed back.
  itc_cents bigint not null default 0 check (itc_cents >= 0),
  itr_cents bigint not null default 0 check (itr_cents >= 0),
  source_type text check (source_type is null or source_type ~ '^[a-z][a-z_]{1,39}$'),
  source_id uuid,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_tax_line_claim_within_paid check (itc_cents <= gst_cents and itr_cents <= qst_cents),
  constraint sales_tax_line_sales_claim_nothing check (direction = 'purchase' or (itc_cents = 0 and itr_cents = 0)),
  constraint sales_tax_line_only_standard_taxed check (tax_code = 'standard' or (gst_cents = 0 and qst_cents = 0)),
  constraint sales_tax_line_source_pair check ((source_type is null) = (source_id is null))
);

create index idx_sales_tax_line_org_date on public.sales_tax_line (organization_id, transaction_date);
-- A receipt, bill or invoice is recorded once.
create unique index uq_sales_tax_line_source on public.sales_tax_line (organization_id, source_type, source_id)
  where source_type is not null;

comment on table public.sales_tax_line is
  'One taxable transaction (#152): a sale (tax collected) or purchase (tax paid, ITC/ITR claimed). Frozen once its tax period is closed.';

alter table public.sales_tax_line enable row level security;
create policy sales_tax_line_read on public.sales_tax_line
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.sales_tax_line from anon;
revoke insert, update, delete, truncate on public.sales_tax_line from authenticated;
grant select on public.sales_tax_line to authenticated;
grant all on public.sales_tax_line to service_role;

-- Runs for every writer, the service role included.
create or replace function app.protect_sales_tax_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select p.starts_on || ' to ' || p.ends_on into v_closed from public.sales_tax_period p
    where p.organization_id = old.organization_id and p.status = 'closed'
      and old.transaction_date between p.starts_on and p.ends_on;
    if found then
      raise exception 'The tax period % is closed; reopen it to change its lines', v_closed
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'A tax line cannot move between organizations' using errcode = '42501';
  end if;
  select p.starts_on || ' to ' || p.ends_on into v_closed from public.sales_tax_period p
  where p.organization_id = new.organization_id and p.status = 'closed'
    and new.transaction_date between p.starts_on and p.ends_on;
  if found then
    raise exception 'The tax period % is closed; reopen it to change its lines', v_closed
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function app.protect_sales_tax_line() from public, anon, authenticated;
create trigger sales_tax_line_protect before insert or update or delete on public.sales_tax_line
for each row execute function app.protect_sales_tax_line();

-- ---------------------------------------------------------------------------
-- Seeding: settings row and the two accounts the closing entry credits.
-- 1200/1210 (receivable) and 2200/2210 (payable) come with the ledger chart.
-- ---------------------------------------------------------------------------
create or replace function app.sales_tax_seed_organization(p_organization uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sales_tax_settings (organization_id) values (p_organization)
  on conflict (organization_id) do nothing;
  insert into public.ledger_account (organization_id, code, name, account_type, description)
  select p_organization, v.code, v.name, 'liability', v.description
  from (values
    ('2220', 'GST net tax owing (returns)',
     'Net GST of closed tax periods: collected less input tax credits. A debit balance is a refund due.'),
    ('2230', 'QST net tax owing (returns)',
     'Net QST of closed tax periods: collected less input tax refunds. A debit balance is a refund due.')
  ) as v(code, name, description)
  on conflict (organization_id, code) do nothing;
end;
$$;
revoke all on function app.sales_tax_seed_organization(uuid) from public, anon, authenticated;

create or replace function app.sales_tax_seed_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.sales_tax_seed_organization(new.id);
  return null;
end;
$$;
revoke all on function app.sales_tax_seed_new_organization() from public, anon, authenticated;
-- Named to fire after organization_ledger_seed (triggers fire in name order).
create trigger organization_sales_tax_seed after insert on public.organization
for each row execute function app.sales_tax_seed_new_organization();

select app.sales_tax_seed_organization(o.id) from public.organization o;

-- ---------------------------------------------------------------------------
-- Functions the app calls. Each checks the caller itself.
-- ---------------------------------------------------------------------------
create or replace function public.sales_tax_save_settings(
  p_organization uuid,
  p_gst_registered boolean,
  p_gst_number text,
  p_qst_registered boolean,
  p_qst_number text,
  p_filing_frequency text,
  p_itc_claim_bp integer,
  p_show_psb_rebate boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA keeps the tax records' using errcode = '42501';
  end if;
  if p_filing_frequency not in ('monthly', 'quarterly', 'annual') then
    raise exception 'Filing frequency must be monthly, quarterly or annual' using errcode = '22023';
  end if;
  if p_itc_claim_bp is null or p_itc_claim_bp not between 0 and 10000 then
    raise exception 'The claimable share must be between 0 %% and 100 %%' using errcode = '22023';
  end if;
  perform app.sales_tax_seed_organization(p_organization);
  update public.sales_tax_settings set
    gst_registered = coalesce(p_gst_registered, false),
    gst_number = nullif(btrim(p_gst_number), ''),
    qst_registered = coalesce(p_qst_registered, false),
    qst_number = nullif(btrim(p_qst_number), ''),
    filing_frequency = p_filing_frequency,
    itc_claim_bp = p_itc_claim_bp,
    show_psb_rebate = coalesce(p_show_psb_rebate, false),
    updated_by = auth.uid(),
    updated_at = now()
  where organization_id = p_organization;
  perform app.record_material_audit(p_organization, 'sales_tax', 'settings_saved',
    'organization', p_organization, jsonb_build_object(
      'gst_registered', coalesce(p_gst_registered, false),
      'qst_registered', coalesce(p_qst_registered, false),
      'filing_frequency', p_filing_frequency,
      'itc_claim_bp', p_itc_claim_bp,
      'show_psb_rebate', coalesce(p_show_psb_rebate, false)));
end;
$$;
revoke all on function public.sales_tax_save_settings(uuid, boolean, text, boolean, text, text, integer, boolean) from public, anon;
grant execute on function public.sales_tax_save_settings(uuid, boolean, text, boolean, text, text, integer, boolean) to authenticated, service_role;

create or replace function public.sales_tax_create_period(p_organization uuid, p_starts_on date, p_ends_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA keeps the tax records' using errcode = '42501';
  end if;
  if p_starts_on is null or p_ends_on is null or p_starts_on > p_ends_on then
    raise exception 'A tax period needs a start date on or before its end date' using errcode = '22023';
  end if;
  if p_ends_on - p_starts_on > 366 then
    raise exception 'A tax period is at most one year' using errcode = '22023';
  end if;
  insert into public.sales_tax_period (organization_id, starts_on, ends_on, created_by)
  values (p_organization, p_starts_on, p_ends_on, auth.uid())
  returning id into v_id;
  perform app.record_material_audit(p_organization, 'sales_tax', 'period_created',
    'sales_tax_period', v_id, jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on));
  return v_id;
end;
$$;
revoke all on function public.sales_tax_create_period(uuid, date, date) from public, anon;
grant execute on function public.sales_tax_create_period(uuid, date, date) to authenticated, service_role;

-- Saves one tax line; p_line null creates it. Tax on a sale left null is
-- calculated from the rates in force on its date (nothing when the
-- organization is not registered for that tax). A claim on a purchase left
-- null is the tax paid times the organization's claimable share (nothing when
-- not registered), rounded half up.
create or replace function public.sales_tax_save_line(
  p_organization uuid,
  p_line uuid,
  p_direction text,
  p_tax_code text,
  p_transaction_date date,
  p_counterparty text,
  p_reference text,
  p_description text,
  p_amount_cents bigint,
  p_gst_cents bigint default null,
  p_qst_cents bigint default null,
  p_itc_cents bigint default null,
  p_itr_cents bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.sales_tax_settings;
  v_line uuid := p_line;
  v_gst bigint;
  v_qst bigint;
  v_itc bigint;
  v_itr bigint;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA keeps the tax records' using errcode = '42501';
  end if;
  if p_direction not in ('sale', 'purchase') then
    raise exception 'A tax line is a sale or a purchase' using errcode = '22023';
  end if;
  if p_tax_code not in ('standard', 'zero_rated', 'exempt', 'out_of_scope') then
    raise exception 'Choose a tax code' using errcode = '22023';
  end if;
  if p_transaction_date is null or p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'A tax line needs a date and an amount of zero or more' using errcode = '22023';
  end if;
  perform app.sales_tax_seed_organization(p_organization);
  select * into v_settings from public.sales_tax_settings where organization_id = p_organization;

  if p_tax_code <> 'standard' then
    if coalesce(p_gst_cents, 0) <> 0 or coalesce(p_qst_cents, 0) <> 0 then
      raise exception 'Only a standard-rated line carries GST or QST' using errcode = '22023';
    end if;
    v_gst := 0;
    v_qst := 0;
  elsif p_direction = 'sale' then
    v_gst := coalesce(p_gst_cents, case when v_settings.gst_registered
      then app.sales_tax_amount(p_amount_cents, app.sales_tax_rate_on('gst', p_transaction_date)) else 0 end);
    v_qst := coalesce(p_qst_cents, case when v_settings.qst_registered
      then app.sales_tax_amount(p_amount_cents, app.sales_tax_rate_on('qst', p_transaction_date)) else 0 end);
    if (v_gst > 0 and not v_settings.gst_registered) or (v_qst > 0 and not v_settings.qst_registered) then
      raise exception 'The organization is not registered to collect that tax' using errcode = '22023';
    end if;
  else
    v_gst := coalesce(p_gst_cents, 0);
    v_qst := coalesce(p_qst_cents, 0);
  end if;

  if p_direction = 'purchase' then
    v_itc := coalesce(p_itc_cents, case when v_settings.gst_registered
      then round(v_gst::numeric * v_settings.itc_claim_bp / 10000)::bigint else 0 end);
    v_itr := coalesce(p_itr_cents, case when v_settings.qst_registered
      then round(v_qst::numeric * v_settings.itc_claim_bp / 10000)::bigint else 0 end);
    if (v_itc > 0 and not v_settings.gst_registered) or (v_itr > 0 and not v_settings.qst_registered) then
      raise exception 'Only a registrant can claim tax back' using errcode = '22023';
    end if;
    if v_itc > v_gst or v_itr > v_qst then
      raise exception 'The amount claimed back cannot exceed the tax paid' using errcode = '22023';
    end if;
  else
    if coalesce(p_itc_cents, 0) <> 0 or coalesce(p_itr_cents, 0) <> 0 then
      raise exception 'Only a purchase has tax to claim back' using errcode = '22023';
    end if;
    v_itc := 0;
    v_itr := 0;
  end if;

  if v_line is null then
    insert into public.sales_tax_line (organization_id, direction, tax_code, transaction_date,
      counterparty, reference, description, amount_cents, gst_cents, qst_cents, itc_cents, itr_cents, created_by)
    values (p_organization, p_direction, p_tax_code, p_transaction_date, btrim(p_counterparty),
      nullif(btrim(p_reference), ''), nullif(btrim(p_description), ''), p_amount_cents,
      v_gst, v_qst, v_itc, v_itr, auth.uid())
    returning id into v_line;
  else
    update public.sales_tax_line set
      direction = p_direction, tax_code = p_tax_code, transaction_date = p_transaction_date,
      counterparty = btrim(p_counterparty), reference = nullif(btrim(p_reference), ''),
      description = nullif(btrim(p_description), ''), amount_cents = p_amount_cents,
      gst_cents = v_gst, qst_cents = v_qst, itc_cents = v_itc, itr_cents = v_itr
    where id = v_line and organization_id = p_organization;
    if not found then
      raise exception 'Tax line not found' using errcode = 'P0002';
    end if;
  end if;
  perform app.record_material_audit(p_organization, 'sales_tax',
    case when p_line is null then 'line_created' else 'line_updated' end,
    'sales_tax_line', v_line, jsonb_build_object('direction', p_direction, 'tax_code', p_tax_code,
      'date', p_transaction_date, 'amount_cents', p_amount_cents, 'gst_cents', v_gst, 'qst_cents', v_qst,
      'itc_cents', v_itc, 'itr_cents', v_itr));
  return v_line;
end;
$$;
revoke all on function public.sales_tax_save_line(uuid, uuid, text, text, date, text, text, text, bigint, bigint, bigint, bigint, bigint) from public, anon;
grant execute on function public.sales_tax_save_line(uuid, uuid, text, text, date, text, text, text, bigint, bigint, bigint, bigint, bigint) to authenticated, service_role;

create or replace function public.sales_tax_delete_line(p_line uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.sales_tax_line;
begin
  select * into v_line from public.sales_tax_line where id = p_line for update;
  if not found or not app.is_org_admin(v_line.organization_id) then
    raise exception 'Only an administrator with MFA keeps the tax records' using errcode = '42501';
  end if;
  -- The line trigger refuses a closed period.
  delete from public.sales_tax_line where id = p_line;
  perform app.record_material_audit(v_line.organization_id, 'sales_tax', 'line_deleted',
    'sales_tax_line', p_line, jsonb_build_object('direction', v_line.direction,
      'date', v_line.transaction_date, 'gst_cents', v_line.gst_cents, 'qst_cents', v_line.qst_cents,
      'source_type', v_line.source_type, 'source_id', v_line.source_id));
end;
$$;
revoke all on function public.sales_tax_delete_line(uuid) from public, anon;
grant execute on function public.sales_tax_delete_line(uuid) to authenticated, service_role;

-- Brings reviewed receipts (#142) dated p_from..p_to that show GST or QST in
-- as standard-rated purchases, once each. Receipts with no tax change no line
-- of the return and are skipped. The amount before tax is the total less both
-- taxes; the claim is the organization's claimable share. An admin can then
-- adjust any line before the period is closed.
create or replace function public.sales_tax_import_receipts(p_organization uuid, p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.sales_tax_settings;
  v_count integer;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA keeps the tax records' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a date range' using errcode = '22023';
  end if;
  perform app.sales_tax_seed_organization(p_organization);
  select * into v_settings from public.sales_tax_settings where organization_id = p_organization;

  insert into public.sales_tax_line (organization_id, direction, tax_code, transaction_date,
    counterparty, description, amount_cents, gst_cents, qst_cents, itc_cents, itr_cents,
    source_type, source_id, created_by)
  select r.organization_id, 'purchase', 'standard', r.document_date, r.vendor,
    left(r.note, 500), r.total_cents - r.gst_cents - r.qst_cents, r.gst_cents, r.qst_cents,
    case when v_settings.gst_registered then round(r.gst_cents::numeric * v_settings.itc_claim_bp / 10000)::bigint else 0 end,
    case when v_settings.qst_registered then round(r.qst_cents::numeric * v_settings.itc_claim_bp / 10000)::bigint else 0 end,
    'finance_receipt', r.id, auth.uid()
  from public.finance_receipt r
  where r.organization_id = p_organization
    and r.status = 'reviewed'
    and r.document_date between p_from and p_to
    and (r.gst_cents > 0 or r.qst_cents > 0)
    -- Receipts in a closed tax period stay out; the line trigger would refuse them.
    and not exists (select 1 from public.sales_tax_period p
                    where p.organization_id = p_organization and p.status = 'closed'
                      and r.document_date between p.starts_on and p.ends_on)
  on conflict (organization_id, source_type, source_id) where source_type is not null do nothing;
  get diagnostics v_count = row_count;

  perform app.record_material_audit(p_organization, 'sales_tax', 'receipts_imported',
    'organization', p_organization, jsonb_build_object('from', p_from, 'to', p_to, 'imported', v_count));
  return v_count;
end;
$$;
revoke all on function public.sales_tax_import_receipts(uuid, date, date) from public, anon;
grant execute on function public.sales_tax_import_receipts(uuid, date, date) to authenticated, service_role;

-- Totals by direction and tax code between two dates. The worksheet maps
-- these to return lines (src/features/sales-tax/return-lines.ts).
-- Security invoker: row-level security decides what is summed.
create or replace function public.sales_tax_totals(p_organization uuid, p_from date, p_to date)
returns table (
  direction text,
  tax_code text,
  line_count integer,
  amount_cents bigint,
  gst_cents bigint,
  qst_cents bigint,
  itc_cents bigint,
  itr_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.direction, l.tax_code, count(*)::integer,
    sum(l.amount_cents)::bigint, sum(l.gst_cents)::bigint, sum(l.qst_cents)::bigint,
    sum(l.itc_cents)::bigint, sum(l.itr_cents)::bigint
  from public.sales_tax_line l
  where l.organization_id = p_organization
    and l.transaction_date between p_from and p_to
  group by l.direction, l.tax_code
  order by l.direction, l.tax_code;
$$;
revoke all on function public.sales_tax_totals(uuid, date, date) from public, anon;
grant execute on function public.sales_tax_totals(uuid, date, date) to authenticated, service_role;

-- Closes a tax period: freezes its lines and posts its net tax to the ledger
-- in one entry dated the last day of the period, in p_fund (the general fund
-- when null). For each tax, the entry clears what was collected from the
-- payable account (2200 GST / 2210 QST) and what was claimed back from the
-- receivable account (1200 / 1210), and puts the difference in the net tax
-- account (2220 / 2230): a credit when tax is owing, a debit when a refund is
-- due. A period with no tax closes without an entry.
create or replace function public.sales_tax_close_period(p_period uuid, p_fund uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.sales_tax_period;
  v_org uuid;
  v_fund uuid;
  v_gst_collected bigint;
  v_gst_claimed bigint;
  v_qst_collected bigint;
  v_qst_claimed bigint;
  v_entry uuid;
  v_number integer;
  v_lines jsonb := '[]'::jsonb;
  v_account uuid;
  v_rec record;
begin
  select * into v_period from public.sales_tax_period where id = p_period for update;
  if not found or not app.is_org_admin(v_period.organization_id) then
    raise exception 'Only an administrator with MFA keeps the tax records' using errcode = '42501';
  end if;
  v_org := v_period.organization_id;
  if v_period.status = 'closed' then
    raise exception 'This tax period is already closed' using errcode = '23514';
  end if;

  if p_fund is null then
    select f.id into v_fund from public.ledger_fund f where f.organization_id = v_org and f.code = 'GEN';
  else
    select f.id into v_fund from public.ledger_fund f where f.organization_id = v_org and f.id = p_fund;
  end if;
  if v_fund is null then
    raise exception 'Choose the fund the closing entry is recorded in' using errcode = '22023';
  end if;

  -- Serialize with anyone writing lines into this period.
  perform 1 from public.sales_tax_line l
  where l.organization_id = v_org and l.transaction_date between v_period.starts_on and v_period.ends_on
  for update;

  select coalesce(sum(l.gst_cents) filter (where l.direction = 'sale'), 0),
         coalesce(sum(l.itc_cents) filter (where l.direction = 'purchase'), 0),
         coalesce(sum(l.qst_cents) filter (where l.direction = 'sale'), 0),
         coalesce(sum(l.itr_cents) filter (where l.direction = 'purchase'), 0)
    into v_gst_collected, v_gst_claimed, v_qst_collected, v_qst_claimed
  from public.sales_tax_line l
  where l.organization_id = v_org and l.transaction_date between v_period.starts_on and v_period.ends_on;

  -- (account code, debit, credit) for each non-zero amount.
  for v_rec in
    select * from (values
      (1, '2200', v_gst_collected, 0::bigint, 'GST collected'),
      (2, '1200', 0::bigint, v_gst_claimed, 'GST input tax credits claimed'),
      (3, '2220', greatest(v_gst_claimed - v_gst_collected, 0), greatest(v_gst_collected - v_gst_claimed, 0), 'GST net tax for the period'),
      (4, '2210', v_qst_collected, 0::bigint, 'QST collected'),
      (5, '1210', 0::bigint, v_qst_claimed, 'QST input tax refunds claimed'),
      (6, '2230', greatest(v_qst_claimed - v_qst_collected, 0), greatest(v_qst_collected - v_qst_claimed, 0), 'QST net tax for the period')
    ) as t(ord, code, debit, credit, label)
    where debit > 0 or credit > 0
    order by ord
  loop
    select a.id into v_account from public.ledger_account a
    where a.organization_id = v_org and a.code = v_rec.code;
    if v_account is null then
      raise exception 'Account % is missing from the chart of accounts', v_rec.code using errcode = '23514';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_account, 'debit_cents', v_rec.debit, 'credit_cents', v_rec.credit,
      'description', v_rec.label));
  end loop;

  if jsonb_array_length(v_lines) > 0 then
    insert into public.journal_entry (organization_id, entry_date, memo, kind, source_type, source_id, created_by)
    values (v_org, v_period.ends_on,
      format('GST/QST return %s to %s: net tax', v_period.starts_on, v_period.ends_on),
      'standard', 'sales_tax_period', v_period.id, auth.uid())
    returning id into v_entry;

    insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id,
      description, debit_cents, credit_cents)
    select v_org, v_entry, x.ordinality::integer, (x.value->>'account_id')::uuid, v_fund,
      x.value->>'description', (x.value->>'debit_cents')::bigint, (x.value->>'credit_cents')::bigint
    from jsonb_array_elements(v_lines) with ordinality as x(value, ordinality);

    -- Numbers, posts and checks it: balance, open ledger period, approved
    -- chart, active accounts.
    v_number := app.ledger_post(v_entry);
  end if;

  update public.sales_tax_period set
    status = 'closed',
    gst_collected_cents = v_gst_collected,
    gst_claimed_cents = v_gst_claimed,
    qst_collected_cents = v_qst_collected,
    qst_claimed_cents = v_qst_claimed,
    closing_entry_id = v_entry,
    closed_by = auth.uid(),
    closed_at = now()
  where id = p_period;

  perform app.record_material_audit(v_org, 'sales_tax', 'period_closed',
    'sales_tax_period', p_period, jsonb_build_object(
      'starts_on', v_period.starts_on, 'ends_on', v_period.ends_on,
      'gst_collected_cents', v_gst_collected, 'gst_claimed_cents', v_gst_claimed,
      'qst_collected_cents', v_qst_collected, 'qst_claimed_cents', v_qst_claimed,
      'journal_entry_id', v_entry, 'entry_number', v_number));
  return v_entry;
end;
$$;
revoke all on function public.sales_tax_close_period(uuid, uuid) from public, anon;
grant execute on function public.sales_tax_close_period(uuid, uuid) to authenticated, service_role;

-- Reopens a closed tax period to correct it. Its closing entry, if any, is
-- reversed on p_reversal_date (in an open ledger period); the original stays
-- in the ledger as posted.
create or replace function public.sales_tax_reopen_period(p_period uuid, p_reversal_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.sales_tax_period;
  v_reversal uuid;
begin
  select * into v_period from public.sales_tax_period where id = p_period for update;
  if not found or not app.is_org_admin(v_period.organization_id) then
    raise exception 'Only an administrator with MFA keeps the tax records' using errcode = '42501';
  end if;
  if v_period.status <> 'closed' then
    raise exception 'This tax period is already open' using errcode = '23514';
  end if;
  if v_period.closing_entry_id is not null then
    v_reversal := public.ledger_reverse_entry(v_period.closing_entry_id, p_reversal_date,
      format('Reopened GST/QST return %s to %s: reversal of the net tax entry',
        v_period.starts_on, v_period.ends_on));
  end if;
  update public.sales_tax_period set
    status = 'open', gst_collected_cents = null, gst_claimed_cents = null,
    qst_collected_cents = null, qst_claimed_cents = null, closing_entry_id = null,
    closed_by = null, closed_at = null
  where id = p_period;
  perform app.record_material_audit(v_period.organization_id, 'sales_tax', 'period_reopened',
    'sales_tax_period', p_period, jsonb_build_object('starts_on', v_period.starts_on,
      'ends_on', v_period.ends_on, 'reversed_entry_id', v_period.closing_entry_id,
      'reversal_id', v_reversal));
end;
$$;
revoke all on function public.sales_tax_reopen_period(uuid, date) from public, anon;
grant execute on function public.sales_tax_reopen_period(uuid, date) to authenticated, service_role;
