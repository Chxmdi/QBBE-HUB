-- Payroll import (#155 B8; epic #140), built on the general ledger (#148,
-- migration 20260927100000).
--
-- Payroll itself is run by a specialist provider (Nethris, Employeur D, ADP,
-- Ceridian Powerpay or another). The app imports the provider's payroll
-- journal or register export and posts each pay run as ONE balanced journal
-- entry through the ledger's own posting (app.ledger_post), so every ledger
-- rule applies unchanged: balance (overall and within each fund), open
-- period, the accountant's approval of the chart, restricted funds.
--
-- Privacy: only run-level totals and the run's fund/program allocation are
-- stored. The file is read in the browser; employee names, social insurance
-- numbers and per-employee lines are never sent to the server nor stored.
-- There is no column here that could hold them.
--
-- What the database guarantees, whoever the caller is:
--   * a run's totals add up: gross wages less employee deductions equals net
--     pay, to the cent (a check constraint);
--   * the same run cannot be imported twice while it is live: each run has a
--     fingerprint (pay date, period, run number, gross and net) that is
--     unique per organization among runs that are not reversed;
--   * a run's totals never change after import; its allocation changes only
--     while it is a draft; a posted run changes only to become reversed;
--   * posting builds the entry here, from the stored totals, the account
--     mapping and the allocation, so the entry always matches the run.
--
-- Who does what:
--   * ledger readers (app.can_read_ledger: admins with MFA and named ledger
--     readers) see runs, allocations and the account mapping;
--   * only owners and admins with MFA (app.is_org_admin) import, allocate,
--     map accounts, post, reverse and delete drafts;
--   * everyone else sees nothing. Tables accept writes only through the
--     functions below.

-- ---------------------------------------------------------------------------
-- Categories. One place that says which side of the entry each takes and
-- what kind of account it may be mapped to.
-- ---------------------------------------------------------------------------
create or replace function app.payroll_categories()
returns table (
  category text,
  sort_order integer,
  label text,
  debit_types text[],
  credit_types text[]
)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('gross_wages',    1, 'Gross wages',                        array['expense'], null::text[]),
    ('ee_federal_tax', 2, 'Federal income tax (employee)',      null::text[], array['liability']),
    ('ee_quebec_tax',  3, 'Quebec income tax (employee)',       null::text[], array['liability']),
    ('ee_qpp',         4, 'QPP (employee)',                     null::text[], array['liability']),
    ('ee_ei',          5, 'EI (employee)',                      null::text[], array['liability']),
    ('ee_qpip',        6, 'QPIP (employee)',                    null::text[], array['liability']),
    ('ee_other',       7, 'Other employee deductions',          null::text[], array['liability']),
    ('er_qpp',         8, 'QPP (employer)',                     array['expense'], array['liability']),
    ('er_ei',          9, 'EI (employer)',                      array['expense'], array['liability']),
    ('er_qpip',       10, 'QPIP (employer)',                    array['expense'], array['liability']),
    ('er_fss',        11, 'Health Services Fund (FSS)',         array['expense'], array['liability']),
    ('er_cnesst',     12, 'CNESST',                             array['expense'], array['liability']),
    ('er_cnt',        13, 'CNT (labour standards)',             array['expense'], array['liability']),
    ('er_other',      14, 'Other employer contributions',       array['expense'], array['liability']),
    ('net_pay',       15, 'Net pay',                            null::text[], array['liability', 'asset'])
  ) as c(category, sort_order, label, debit_types, credit_types);
$$;
revoke all on function app.payroll_categories() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Account mapping, one row per category and organization
-- ---------------------------------------------------------------------------
create table public.payroll_account_map (
  organization_id uuid not null references public.organization (id) on delete cascade,
  category text not null check (category in (
    'gross_wages', 'ee_federal_tax', 'ee_quebec_tax', 'ee_qpp', 'ee_ei', 'ee_qpip', 'ee_other',
    'er_qpp', 'er_ei', 'er_qpip', 'er_fss', 'er_cnesst', 'er_cnt', 'er_other', 'net_pay')),
  -- The account debited (expenses) and credited (liabilities, or the bank or
  -- a net pay payable for net pay). Unused sides stay null.
  debit_account_id uuid,
  credit_account_id uuid,
  updated_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, category),
  foreign key (organization_id, debit_account_id) references public.ledger_account (organization_id, id),
  foreign key (organization_id, credit_account_id) references public.ledger_account (organization_id, id)
);

comment on table public.payroll_account_map is
  'Which ledger account each payroll category posts to (#155). Set by an admin with MFA.';

-- ---------------------------------------------------------------------------
-- Pay runs: totals only
-- ---------------------------------------------------------------------------
create table public.payroll_run (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  provider text not null
    check (provider in ('nethris', 'employeur_d', 'adp_wfn', 'ceridian_powerpay', 'other')),
  file_name text check (file_name is null or char_length(file_name) between 1 and 200),
  file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  -- The provider's own run number, when the export carries one.
  run_reference text check (run_reference is null or char_length(btrim(run_reference)) between 1 and 60),
  pay_date date not null,
  period_start date not null,
  period_end date not null,
  gross_wages_cents bigint not null default 0,
  ee_federal_tax_cents bigint not null default 0,
  ee_quebec_tax_cents bigint not null default 0,
  ee_qpp_cents bigint not null default 0,
  ee_ei_cents bigint not null default 0,
  ee_qpip_cents bigint not null default 0,
  ee_other_cents bigint not null default 0,
  er_qpp_cents bigint not null default 0,
  er_ei_cents bigint not null default 0,
  er_qpip_cents bigint not null default 0,
  er_fss_cents bigint not null default 0,
  er_cnesst_cents bigint not null default 0,
  er_cnt_cents bigint not null default 0,
  er_other_cents bigint not null default 0,
  net_pay_cents bigint not null default 0,
  -- Set by the insert trigger from the values above; unique while live.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'draft' check (status in ('draft', 'posted', 'reversed')),
  journal_entry_id uuid,
  reversal_entry_id uuid,
  created_by uuid references public.user_profile (id) on delete set null,
  posted_by uuid references public.user_profile (id) on delete set null,
  posted_at timestamptz,
  reversed_by uuid references public.user_profile (id) on delete set null,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, journal_entry_id) references public.journal_entry (organization_id, id),
  foreign key (organization_id, reversal_entry_id) references public.journal_entry (organization_id, id),
  constraint payroll_run_period_ordered check (period_start <= period_end),
  constraint payroll_run_amounts_in_range check (
    least(gross_wages_cents, ee_federal_tax_cents, ee_quebec_tax_cents, ee_qpp_cents, ee_ei_cents,
          ee_qpip_cents, ee_other_cents, er_qpp_cents, er_ei_cents, er_qpip_cents, er_fss_cents,
          er_cnesst_cents, er_cnt_cents, er_other_cents, net_pay_cents) >= 0
    and greatest(gross_wages_cents, ee_federal_tax_cents, ee_quebec_tax_cents, ee_qpp_cents, ee_ei_cents,
          ee_qpip_cents, ee_other_cents, er_qpp_cents, er_ei_cents, er_qpip_cents, er_fss_cents,
          er_cnesst_cents, er_cnt_cents, er_other_cents, net_pay_cents) <= 10000000000000
  ),
  constraint payroll_run_gross_positive check (gross_wages_cents > 0),
  -- The register adds up: gross less the employee's deductions is net pay.
  constraint payroll_run_totals_add_up check (
    gross_wages_cents - ee_federal_tax_cents - ee_quebec_tax_cents - ee_qpp_cents - ee_ei_cents
      - ee_qpip_cents - ee_other_cents = net_pay_cents
  ),
  constraint payroll_run_post_recorded check (
    (status = 'draft') = (journal_entry_id is null)
    and (status = 'draft') = (posted_at is null)
    and (status = 'reversed') = (reversal_entry_id is not null)
    and (status = 'reversed') = (reversed_at is not null)
  )
);

create unique index uq_payroll_run_fingerprint on public.payroll_run (organization_id, fingerprint)
  where status <> 'reversed';
create unique index uq_payroll_run_entry on public.payroll_run (journal_entry_id)
  where journal_entry_id is not null;
create index idx_payroll_run_org_date on public.payroll_run (organization_id, pay_date desc);

comment on table public.payroll_run is
  'Imported pay runs (#155): run-level totals only, never employee names, SINs or per-employee lines.';

-- How a run is shared across funds and programs: all percentages (basis
-- points, summing to 100%) or all amounts of gross wages (summing to the
-- run's gross). Every figure of the run is split in the same proportions.
create table public.payroll_run_allocation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  share_no integer not null check (share_no between 1 and 20),
  fund_id uuid not null,
  program_id uuid,
  share_basis_points integer check (share_basis_points between 1 and 10000),
  share_cents bigint check (share_cents between 1 and 10000000000000),
  created_at timestamptz not null default now(),
  unique (run_id, share_no),
  constraint payroll_run_allocation_one_kind check ((share_basis_points is null) <> (share_cents is null)),
  foreign key (organization_id, run_id) references public.payroll_run (organization_id, id) on delete cascade,
  foreign key (organization_id, fund_id) references public.ledger_fund (organization_id, id),
  foreign key (program_id, organization_id) references public.program (id, organization_id)
);

create unique index uq_payroll_run_allocation_key on public.payroll_run_allocation
  (run_id, fund_id, program_id) nulls not distinct;

comment on table public.payroll_run_allocation is
  'Split of a pay run across funds and programs (#155), by percentage or by amount of gross wages.';

-- ---------------------------------------------------------------------------
-- Row-level security: read with the ledger, write through functions only
-- ---------------------------------------------------------------------------
alter table public.payroll_account_map enable row level security;
create policy payroll_account_map_read on public.payroll_account_map
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.payroll_account_map from anon;
revoke insert, update, delete, truncate on public.payroll_account_map from authenticated;
grant select on public.payroll_account_map to authenticated;
grant all on public.payroll_account_map to service_role;

alter table public.payroll_run enable row level security;
create policy payroll_run_read on public.payroll_run
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.payroll_run from anon;
revoke insert, update, delete, truncate on public.payroll_run from authenticated;
grant select on public.payroll_run to authenticated;
grant all on public.payroll_run to service_role;

alter table public.payroll_run_allocation enable row level security;
create policy payroll_run_allocation_read on public.payroll_run_allocation
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.payroll_run_allocation from anon;
revoke insert, update, delete, truncate on public.payroll_run_allocation from authenticated;
grant select on public.payroll_run_allocation to authenticated;
grant all on public.payroll_run_allocation to service_role;

-- ---------------------------------------------------------------------------
-- Integrity triggers. They run for every role, the service role included.
-- ---------------------------------------------------------------------------
create or replace function app.payroll_run_fingerprint(r public.payroll_run)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    to_char(r.pay_date, 'YYYY-MM-DD'), to_char(r.period_start, 'YYYY-MM-DD'),
    to_char(r.period_end, 'YYYY-MM-DD'), lower(coalesce(btrim(r.run_reference), '')),
    r.gross_wages_cents::text, r.net_pay_cents::text), 'UTF8')), 'hex');
$$;
revoke all on function app.payroll_run_fingerprint(public.payroll_run) from public, anon, authenticated;

create or replace function app.protect_payroll_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'A posted pay run cannot be deleted; reverse it instead' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'A pay run is imported as a draft' using errcode = '42501';
    end if;
    new.fingerprint := app.payroll_run_fingerprint(new);
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  -- What was imported is the record: totals, dates and origin never change.
  if (new.organization_id, new.provider, new.file_name, new.file_sha256, new.run_reference,
      new.pay_date, new.period_start, new.period_end, new.gross_wages_cents,
      new.ee_federal_tax_cents, new.ee_quebec_tax_cents, new.ee_qpp_cents, new.ee_ei_cents,
      new.ee_qpip_cents, new.ee_other_cents, new.er_qpp_cents, new.er_ei_cents, new.er_qpip_cents,
      new.er_fss_cents, new.er_cnesst_cents, new.er_cnt_cents, new.er_other_cents, new.net_pay_cents,
      new.fingerprint, new.created_by, new.created_at)
     is distinct from
     (old.organization_id, old.provider, old.file_name, old.file_sha256, old.run_reference,
      old.pay_date, old.period_start, old.period_end, old.gross_wages_cents,
      old.ee_federal_tax_cents, old.ee_quebec_tax_cents, old.ee_qpp_cents, old.ee_ei_cents,
      old.ee_qpip_cents, old.ee_other_cents, old.er_qpp_cents, old.er_ei_cents, old.er_qpip_cents,
      old.er_fss_cents, old.er_cnesst_cents, old.er_cnt_cents, old.er_other_cents, old.net_pay_cents,
      old.fingerprint, old.created_by, old.created_at) then
    raise exception 'An imported pay run keeps its figures; delete the draft and import again'
      using errcode = '42501';
  end if;
  if old.status = 'reversed' then
    raise exception 'A reversed pay run cannot change' using errcode = '42501';
  end if;
  if old.status = 'posted' and not (
    new.status = 'reversed'
    and (new.journal_entry_id, new.posted_by, new.posted_at)
      is not distinct from (old.journal_entry_id, old.posted_by, old.posted_at)
  ) then
    raise exception 'A posted pay run is locked; reverse it to correct it' using errcode = '42501';
  end if;
  if old.status = 'draft' and new.status = 'reversed' then
    raise exception 'Only a posted pay run can be reversed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function app.protect_payroll_run() from public, anon, authenticated;
create trigger payroll_run_protect before insert or update or delete on public.payroll_run
for each row execute function app.protect_payroll_run();

create or replace function app.protect_payroll_run_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lines of a deleted draft go with it: the run row is already gone.
  if exists (
    select 1 from public.payroll_run r
    where r.status <> 'draft'
      and (r.id = case when tg_op = 'DELETE' then old.run_id else new.run_id end
           or (tg_op = 'UPDATE' and r.id = old.run_id))
  ) then
    raise exception 'A posted pay run''s allocation cannot change' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.run_id, new.organization_id) is distinct from (old.run_id, old.organization_id) then
    raise exception 'An allocation cannot move between pay runs' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app.protect_payroll_run_allocation() from public, anon, authenticated;
create trigger payroll_run_allocation_protect before insert or update or delete on public.payroll_run_allocation
for each row execute function app.protect_payroll_run_allocation();

-- A mapped account must be of a kind its category can post to.
create or replace function app.protect_payroll_account_map()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_type text;
begin
  if tg_op = 'UPDATE' and (new.organization_id, new.category) is distinct from (old.organization_id, old.category) then
    raise exception 'A mapping keeps its organization and category' using errcode = '42501';
  end if;
  select * into c from app.payroll_categories() pc where pc.category = new.category;
  if new.debit_account_id is not null then
    if c.debit_types is null then
      raise exception '% is never debited; leave its debit account empty', c.label using errcode = '22023';
    end if;
    select a.account_type into v_type from public.ledger_account a where a.id = new.debit_account_id;
    if not (v_type = any (c.debit_types)) then
      raise exception '%: debit an expense account', c.label
        using errcode = '22023';
    end if;
  end if;
  if new.credit_account_id is not null then
    if c.credit_types is null then
      raise exception '% is never credited; leave its credit account empty', c.label using errcode = '22023';
    end if;
    select a.account_type into v_type from public.ledger_account a where a.id = new.credit_account_id;
    if not (v_type = any (c.credit_types)) then
      raise exception '%: credit a % account', c.label, array_to_string(c.credit_types, ' or ')
        using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app.protect_payroll_account_map() from public, anon, authenticated;
create trigger payroll_account_map_protect before insert or update on public.payroll_account_map
for each row execute function app.protect_payroll_account_map();

-- ---------------------------------------------------------------------------
-- Default mapping from the starter chart, where those accounts exist:
-- wages 5000, employer contributions 5010 against source deductions payable
-- 2300, employee deductions to 2300, net pay from the chequing account 1000.
-- Categories already mapped are left alone.
-- ---------------------------------------------------------------------------
create or replace function app.payroll_seed_map(p_organization uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wages uuid;
  v_employer uuid;
  v_payable uuid;
  v_bank uuid;
begin
  select id into v_wages from public.ledger_account
  where organization_id = p_organization and code = '5000' and account_type = 'expense';
  select id into v_employer from public.ledger_account
  where organization_id = p_organization and code = '5010' and account_type = 'expense';
  select id into v_payable from public.ledger_account
  where organization_id = p_organization and code = '2300' and account_type = 'liability';
  select id into v_bank from public.ledger_account
  where organization_id = p_organization and code = '1000' and account_type = 'asset';

  insert into public.payroll_account_map (organization_id, category, debit_account_id, credit_account_id)
  select p_organization, c.category,
    case when c.category = 'gross_wages' then v_wages
         when c.category like 'er\_%' then v_employer end,
    case when c.category = 'net_pay' then v_bank
         when c.category <> 'gross_wages' then v_payable end
  from app.payroll_categories() c
  on conflict (organization_id, category) do nothing;
end;
$$;
revoke all on function app.payroll_seed_map(uuid) from public, anon, authenticated;

create or replace function app.payroll_seed_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.payroll_seed_map(new.id);
  return null;
end;
$$;
revoke all on function app.payroll_seed_new_organization() from public, anon, authenticated;
-- Named to fire after organization_ledger_seed (triggers fire in name
-- order), so the starter chart exists when the mapping is seeded.
create trigger organization_payroll_seed after insert on public.organization
for each row execute function app.payroll_seed_new_organization();

select app.payroll_seed_map(o.id) from public.organization o;

-- ---------------------------------------------------------------------------
-- The entry a run posts. No caller check: only the functions below call it.
--
-- Each category amount is split across the allocation in its proportions,
-- largest remainder first so every split adds back to the exact cents. Net
-- pay is then set per share as that share's debits less its other credits,
-- so each share, and therefore each fund, balances exactly; the net pay
-- shares still add up to the run's net pay because every other figure was
-- split exactly. Expense lines carry the share's program.
-- ---------------------------------------------------------------------------
create or replace function app.payroll_build_lines(p_run uuid)
returns table (
  line_no integer,
  category text,
  account_id uuid,
  fund_id uuid,
  program_id uuid,
  description text,
  debit_cents bigint,
  credit_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r public.payroll_run;
  v_amounts jsonb;
  v_missing text;
  v_gen uuid;
  v_shares integer;
  v_bad integer;
begin
  select * into r from public.payroll_run where id = p_run;
  if not found then
    raise exception 'Pay run not found' using errcode = 'P0002';
  end if;
  v_amounts := jsonb_build_object(
    'gross_wages', r.gross_wages_cents, 'ee_federal_tax', r.ee_federal_tax_cents,
    'ee_quebec_tax', r.ee_quebec_tax_cents, 'ee_qpp', r.ee_qpp_cents, 'ee_ei', r.ee_ei_cents,
    'ee_qpip', r.ee_qpip_cents, 'ee_other', r.ee_other_cents, 'er_qpp', r.er_qpp_cents,
    'er_ei', r.er_ei_cents, 'er_qpip', r.er_qpip_cents, 'er_fss', r.er_fss_cents,
    'er_cnesst', r.er_cnesst_cents, 'er_cnt', r.er_cnt_cents, 'er_other', r.er_other_cents,
    'net_pay', r.net_pay_cents);

  -- Every category with an amount needs its accounts.
  select c.label into v_missing
  from app.payroll_categories() c
  left join public.payroll_account_map m
    on m.organization_id = r.organization_id and m.category = c.category
  where (v_amounts->>c.category)::bigint > 0
    and ((c.debit_types is not null and m.debit_account_id is null)
      or (c.credit_types is not null and m.credit_account_id is null))
  order by c.sort_order
  limit 1;
  if found then
    raise exception 'Map % to an account before posting', v_missing using errcode = '22023';
  end if;

  select count(*) into v_shares from public.payroll_run_allocation a where a.run_id = p_run;
  if v_shares = 0 then
    select f.id into v_gen from public.ledger_fund f
    where f.organization_id = r.organization_id and f.code = 'GEN';
    if v_gen is null then
      raise exception 'Allocate the run to at least one fund' using errcode = '22023';
    end if;
  end if;

  -- A share too small to carry its part of every figure could leave its net
  -- pay below zero; refuse it rather than post an odd entry.
  with shares as (
    select a.share_no, a.fund_id, a.program_id,
      coalesce(a.share_basis_points::bigint, a.share_cents) as weight
    from public.payroll_run_allocation a where a.run_id = p_run
    union all
    select 1, v_gen, null::uuid, 1::bigint where v_shares = 0
  ),
  parts as (
    select c.category, c.sort_order as cpos, c.debit_types is not null as has_debit,
      c.credit_types is not null as has_credit, (v_amounts->>c.category)::bigint as amount
    from app.payroll_categories() c
    where c.category <> 'net_pay' and (v_amounts->>c.category)::bigint > 0
  ),
  raw as (
    select p.*, s.share_no as spos, s.fund_id, s.program_id,
      div(p.amount::numeric * s.weight, sum(s.weight) over (partition by p.category)) as base,
      mod(p.amount::numeric * s.weight, sum(s.weight) over (partition by p.category)) as remainder
    from parts p cross join shares s
  ),
  ranked as (
    select raw.*, sum(raw.base) over (partition by raw.category) as base_total,
      row_number() over (partition by raw.category order by raw.remainder desc, raw.spos) as rank
    from raw
  ),
  split as (
    select ranked.*, base + case when rank <= amount - base_total then 1 else 0 end as cents
    from ranked
  ),
  share_net as (
    select s.share_no,
      coalesce(sum(x.cents) filter (where x.has_debit), 0)
        - coalesce(sum(x.cents) filter (where x.has_credit), 0) as net
    from shares s left join split x on x.spos = s.share_no
    group by s.share_no
  )
  select min(share_no) into v_bad from share_net where net < 0;
  if v_bad is not null then
    raise exception 'Allocation share % is too small to split this run; merge it with another share', v_bad
      using errcode = '22023';
  end if;

  return query
  with shares as (
    select a.share_no, a.fund_id, a.program_id,
      coalesce(a.share_basis_points::bigint, a.share_cents) as weight
    from public.payroll_run_allocation a where a.run_id = p_run
    union all
    select 1, v_gen, null::uuid, 1::bigint where v_shares = 0
  ),
  parts as (
    select c.category, c.sort_order as cpos, c.label, (v_amounts->>c.category)::bigint as amount
    from app.payroll_categories() c
    where c.category <> 'net_pay' and (v_amounts->>c.category)::bigint > 0
  ),
  raw as (
    select p.*, s.share_no as spos, s.fund_id, s.program_id,
      div(p.amount::numeric * s.weight, sum(s.weight) over (partition by p.category)) as base,
      mod(p.amount::numeric * s.weight, sum(s.weight) over (partition by p.category)) as remainder
    from parts p cross join shares s
  ),
  ranked as (
    select raw.*, sum(raw.base) over (partition by raw.category) as base_total,
      row_number() over (partition by raw.category order by raw.remainder desc, raw.spos) as rank
    from raw
  ),
  split as (
    select ranked.*, (base + case when rank <= amount - base_total then 1 else 0 end)::bigint as cents
    from ranked
  ),
  legs as (
    -- Debits: wages and employer contributions, to expense, with the program.
    select x.spos, x.cpos, 1 as leg, x.category, m.debit_account_id as account, x.fund_id,
      x.program_id, x.label, x.cents as debit, 0::bigint as credit
    from split x
    join public.payroll_account_map m on m.organization_id = r.organization_id and m.category = x.category
    where x.cents > 0 and (x.category = 'gross_wages' or x.category like 'er\_%')
    union all
    -- Credits: employee deductions and employer contributions payable.
    select x.spos, x.cpos, 2, x.category, m.credit_account_id, x.fund_id, null::uuid,
      x.label || case when x.category like 'er\_%' then ' payable' else '' end, 0::bigint, x.cents
    from split x
    join public.payroll_account_map m on m.organization_id = r.organization_id and m.category = x.category
    where x.cents > 0 and x.category <> 'gross_wages'
  ),
  net as (
    select s.share_no as spos, 99 as cpos, 3 as leg, 'net_pay'::text as category,
      m.credit_account_id as account, s.fund_id, null::uuid as program_id, 'Net pay'::text as label,
      0::bigint as debit,
      (coalesce((select sum(l.debit) - sum(l.credit) from legs l where l.spos = s.share_no), 0))::bigint as credit
    from shares s
    join public.payroll_account_map m on m.organization_id = r.organization_id and m.category = 'net_pay'
  ),
  all_legs as (
    select * from legs
    union all
    select * from net where net.credit > 0
  )
  select (row_number() over (order by l.spos, l.leg, l.cpos))::integer,
    l.category, l.account, l.fund_id, l.program_id,
    left(l.label || ' · pay ' || to_char(r.pay_date, 'YYYY-MM-DD'), 500),
    l.debit, l.credit
  from all_legs l
  order by l.spos, l.leg, l.cpos;
end;
$$;
revoke all on function app.payroll_build_lines(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Functions the app calls. Each checks the caller itself.
-- ---------------------------------------------------------------------------

-- Imports the runs read from one file. p_runs is a JSON array of objects with
-- run_reference, pay_date, period_start, period_end and the fifteen *_cents
-- figures. Runs already imported (same fingerprint, not reversed) are
-- skipped, never duplicated. Returns {added, skipped, ids}.
create or replace function public.payroll_import_runs(
  p_organization uuid,
  p_provider text,
  p_file_name text,
  p_file_sha256 text,
  p_runs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run jsonb;
  v_new public.payroll_run;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_skipped integer := 0;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA imports payroll' using errcode = '42501';
  end if;
  if coalesce(p_provider, '') not in ('nethris', 'employeur_d', 'adp_wfn', 'ceridian_powerpay', 'other') then
    raise exception 'Choose the payroll provider' using errcode = '22023';
  end if;
  if jsonb_typeof(p_runs) is distinct from 'array' or jsonb_array_length(p_runs) = 0
     or jsonb_array_length(p_runs) > 100 then
    raise exception 'A file holds between 1 and 100 pay runs' using errcode = '22023';
  end if;
  perform app.payroll_seed_map(p_organization);

  for v_run in select value from jsonb_array_elements(p_runs) loop
    v_new := null;
    v_new.organization_id := p_organization;
    v_new.run_reference := nullif(btrim(v_run->>'run_reference'), '');
    v_new.pay_date := (v_run->>'pay_date')::date;
    v_new.period_start := (v_run->>'period_start')::date;
    v_new.period_end := (v_run->>'period_end')::date;
    v_new.gross_wages_cents := coalesce((v_run->>'gross_wages_cents')::bigint, 0);
    v_new.net_pay_cents := coalesce((v_run->>'net_pay_cents')::bigint, 0);
    if v_new.pay_date is null or v_new.period_start is null or v_new.period_end is null then
      raise exception 'Each pay run needs a pay date and a period' using errcode = '22023';
    end if;
    if v_new.period_start > v_new.period_end then
      raise exception 'The pay run of %: the period ends before it starts', v_new.pay_date using errcode = '22023';
    end if;
    if exists (select 1 from public.payroll_run x
               where x.organization_id = p_organization and x.status <> 'reversed'
                 and x.fingerprint = app.payroll_run_fingerprint(v_new)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      insert into public.payroll_run (organization_id, provider, file_name, file_sha256, run_reference,
        pay_date, period_start, period_end, gross_wages_cents, ee_federal_tax_cents, ee_quebec_tax_cents,
        ee_qpp_cents, ee_ei_cents, ee_qpip_cents, ee_other_cents, er_qpp_cents, er_ei_cents, er_qpip_cents,
        er_fss_cents, er_cnesst_cents, er_cnt_cents, er_other_cents, net_pay_cents, fingerprint, created_by)
      values (p_organization, p_provider, nullif(left(btrim(p_file_name), 200), ''),
        nullif(lower(btrim(p_file_sha256)), ''), v_new.run_reference,
        v_new.pay_date, v_new.period_start, v_new.period_end, v_new.gross_wages_cents,
        coalesce((v_run->>'ee_federal_tax_cents')::bigint, 0), coalesce((v_run->>'ee_quebec_tax_cents')::bigint, 0),
        coalesce((v_run->>'ee_qpp_cents')::bigint, 0), coalesce((v_run->>'ee_ei_cents')::bigint, 0),
        coalesce((v_run->>'ee_qpip_cents')::bigint, 0), coalesce((v_run->>'ee_other_cents')::bigint, 0),
        coalesce((v_run->>'er_qpp_cents')::bigint, 0), coalesce((v_run->>'er_ei_cents')::bigint, 0),
        coalesce((v_run->>'er_qpip_cents')::bigint, 0), coalesce((v_run->>'er_fss_cents')::bigint, 0),
        coalesce((v_run->>'er_cnesst_cents')::bigint, 0), coalesce((v_run->>'er_cnt_cents')::bigint, 0),
        coalesce((v_run->>'er_other_cents')::bigint, 0), v_new.net_pay_cents,
        repeat('0', 64), auth.uid())
      returning id into v_id;
    exception
      when unique_violation then
        -- The same run twice in one file: keep the first.
        v_skipped := v_skipped + 1;
        continue;
      when check_violation then
        raise exception 'The pay run of % does not add up: gross wages less employee deductions must equal net pay, and no amount may be negative',
          v_new.pay_date using errcode = '22023';
    end;
    v_ids := v_ids || v_id;
  end loop;

  perform app.record_material_audit(p_organization, 'payroll', 'runs_imported', 'organization', p_organization,
    jsonb_build_object('provider', p_provider, 'file_name', left(btrim(p_file_name), 200),
      'file_sha256', p_file_sha256, 'added', cardinality(v_ids), 'skipped', v_skipped, 'run_ids', to_jsonb(v_ids)));
  return jsonb_build_object('added', cardinality(v_ids), 'skipped', v_skipped, 'ids', to_jsonb(v_ids));
end;
$$;
revoke all on function public.payroll_import_runs(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.payroll_import_runs(uuid, text, text, text, jsonb) to authenticated, service_role;

-- Replaces the account mapping. p_map is a JSON array of objects: category,
-- debit_account_id, credit_account_id. Categories left out keep their accounts.
create or replace function public.payroll_save_account_map(p_organization uuid, p_map jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA maps payroll accounts' using errcode = '42501';
  end if;
  if jsonb_typeof(p_map) is distinct from 'array' or jsonb_array_length(p_map) > 15 then
    raise exception 'The mapping is a list of at most 15 categories' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_map) x
             where not exists (select 1 from app.payroll_categories() c where c.category = x.value->>'category')) then
    raise exception 'Unknown payroll category' using errcode = '22023';
  end if;
  perform app.payroll_seed_map(p_organization);
  update public.payroll_account_map m set
    debit_account_id = nullif(x.value->>'debit_account_id', '')::uuid,
    credit_account_id = nullif(x.value->>'credit_account_id', '')::uuid,
    updated_by = auth.uid()
  from jsonb_array_elements(p_map) x
  where m.organization_id = p_organization and m.category = x.value->>'category';
  perform app.record_material_audit(p_organization, 'payroll', 'account_map_saved', 'organization', p_organization,
    jsonb_build_object('map', p_map));
exception when foreign_key_violation then
  raise exception 'An account is not in this organization' using errcode = '22023';
end;
$$;
revoke all on function public.payroll_save_account_map(uuid, jsonb) from public, anon;
grant execute on function public.payroll_save_account_map(uuid, jsonb) to authenticated, service_role;

-- Replaces a draft run's allocation. p_allocation is a JSON array of objects:
-- fund_id, program_id, and share_percent (like "62.5") or share_cents. An
-- empty array means the whole run goes to the general fund.
create or replace function public.payroll_save_allocation(p_run uuid, p_allocation jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payroll_run;
  v_count integer;
  v_percent integer;
  v_amount integer;
  v_total numeric;
begin
  select * into r from public.payroll_run where id = p_run for update;
  if not found or not app.is_org_admin(r.organization_id) then
    raise exception 'Only an administrator with MFA allocates payroll' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'A posted pay run''s allocation cannot change' using errcode = '42501';
  end if;
  if jsonb_typeof(p_allocation) is distinct from 'array' or jsonb_array_length(p_allocation) > 20 then
    raise exception 'Split a run into at most 20 shares' using errcode = '22023';
  end if;
  select count(*),
    count(*) filter (where x.value ? 'share_percent' and not x.value ? 'share_cents'),
    count(*) filter (where x.value ? 'share_cents' and not x.value ? 'share_percent')
    into v_count, v_percent, v_amount
  from jsonb_array_elements(p_allocation) x;
  if v_count > 0 and v_percent <> v_count and v_amount <> v_count then
    raise exception 'Give every share as a percentage, or every share as an amount' using errcode = '22023';
  end if;
  if v_count > 0 and v_percent = v_count then
    if exists (select 1 from jsonb_array_elements(p_allocation) x
               where (x.value->>'share_percent') !~ '^\d{1,3}(\.\d{1,2})?$'
                  or (x.value->>'share_percent')::numeric <= 0) then
      raise exception 'A percentage has at most two decimals and is above zero' using errcode = '22023';
    end if;
    select sum((x.value->>'share_percent')::numeric) into v_total from jsonb_array_elements(p_allocation) x;
    if v_total <> 100 then
      raise exception '%', format('The shares add up to %s%%, not 100%%', v_total) using errcode = '22023';
    end if;
  elsif v_count > 0 then
    if exists (select 1 from jsonb_array_elements(p_allocation) x
               where jsonb_typeof(x.value->'share_cents') <> 'number'
                  or (x.value->>'share_cents') !~ '^\d+$' or (x.value->>'share_cents')::bigint <= 0) then
      raise exception 'An amount share is a whole number of cents above zero' using errcode = '22023';
    end if;
    select sum((x.value->>'share_cents')::bigint) into v_total from jsonb_array_elements(p_allocation) x;
    if v_total <> r.gross_wages_cents then
      raise exception 'The shares add up to % cents; they must add up to the run''s gross wages, % cents',
        v_total, r.gross_wages_cents using errcode = '22023';
    end if;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_allocation) x
    left join public.ledger_fund f on f.id = nullif(x.value->>'fund_id', '')::uuid
      and f.organization_id = r.organization_id
    where f.id is null
  ) then
    raise exception 'Choose a fund of this organization for every share' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_allocation) x
    where nullif(x.value->>'program_id', '') is not null
      and not exists (select 1 from public.program p
                      where p.id = (x.value->>'program_id')::uuid and p.organization_id = r.organization_id)
  ) then
    raise exception 'The program is not in this organization' using errcode = '22023';
  end if;

  delete from public.payroll_run_allocation where run_id = p_run;
  insert into public.payroll_run_allocation (organization_id, run_id, share_no, fund_id, program_id,
    share_basis_points, share_cents)
  select r.organization_id, p_run, x.ordinality::integer, (x.value->>'fund_id')::uuid,
    nullif(x.value->>'program_id', '')::uuid,
    ((x.value->>'share_percent')::numeric * 100)::integer,
    (x.value->>'share_cents')::bigint
  from jsonb_array_elements(p_allocation) with ordinality as x(value, ordinality);

  perform app.record_material_audit(r.organization_id, 'payroll', 'allocation_saved', 'payroll_run', p_run,
    jsonb_build_object('shares', v_count));
exception when unique_violation then
  raise exception 'Each fund and program appears once in a run''s allocation' using errcode = '23505';
end;
$$;
revoke all on function public.payroll_save_allocation(uuid, jsonb) from public, anon;
grant execute on function public.payroll_save_allocation(uuid, jsonb) to authenticated, service_role;

-- The lines posting would create, for review before posting.
create or replace function public.payroll_run_lines(p_run uuid)
returns table (
  line_no integer,
  category text,
  account_id uuid,
  fund_id uuid,
  program_id uuid,
  description text,
  debit_cents bigint,
  credit_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_organization uuid;
begin
  select r.organization_id into v_organization from public.payroll_run r where r.id = p_run;
  if v_organization is null or not app.can_read_ledger(v_organization) then
    raise exception 'You do not have access to payroll' using errcode = '42501';
  end if;
  return query select * from app.payroll_build_lines(p_run);
end;
$$;
revoke all on function public.payroll_run_lines(uuid) from public, anon;
grant execute on function public.payroll_run_lines(uuid) to authenticated, service_role;

-- Posts a draft run as one journal entry dated on its pay date.
create or replace function public.payroll_post_run(p_run uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payroll_run;
  v_entry uuid;
  v_number integer;
begin
  select * into r from public.payroll_run where id = p_run for update;
  if not found or not app.is_org_admin(r.organization_id) then
    raise exception 'Only an administrator with MFA posts payroll' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'This pay run is already posted' using errcode = '42501';
  end if;

  insert into public.journal_entry (organization_id, entry_date, memo, source_type, source_id, created_by)
  values (r.organization_id, r.pay_date,
    left(format('Payroll paid %s for %s to %s%s', to_char(r.pay_date, 'YYYY-MM-DD'),
      to_char(r.period_start, 'YYYY-MM-DD'), to_char(r.period_end, 'YYYY-MM-DD'),
      coalesce(' (run ' || r.run_reference || ')', '')), 500),
    'payroll_run', r.id, auth.uid())
  returning id into v_entry;

  insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id, program_id,
    description, debit_cents, credit_cents)
  select r.organization_id, v_entry, l.line_no, l.account_id, l.fund_id, l.program_id, l.description,
    l.debit_cents, l.credit_cents
  from app.payroll_build_lines(p_run) l;

  -- The ledger's own posting: balance, fund balance, open period, chart
  -- approval, active accounts and funds, restricted funds.
  v_number := app.ledger_post(v_entry);

  update public.payroll_run set status = 'posted', journal_entry_id = v_entry,
    posted_by = auth.uid(), posted_at = now()
  where id = p_run;
  perform app.record_material_audit(r.organization_id, 'payroll', 'run_posted', 'payroll_run', p_run,
    jsonb_build_object('journal_entry_id', v_entry, 'entry_number', v_number, 'pay_date', r.pay_date,
      'gross_wages_cents', r.gross_wages_cents));
  return v_number;
end;
$$;
revoke all on function public.payroll_post_run(uuid) from public, anon;
grant execute on function public.payroll_post_run(uuid) to authenticated, service_role;

-- Reverses a posted run's entry (or records a reversal already made in the
-- ledger). The run can then be imported again, corrected.
create or replace function public.payroll_reverse_run(p_run uuid, p_entry_date date, p_memo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payroll_run;
  v_reversal uuid;
begin
  select * into r from public.payroll_run where id = p_run for update;
  if not found or not app.is_org_admin(r.organization_id) then
    raise exception 'Only an administrator with MFA reverses payroll' using errcode = '42501';
  end if;
  if r.status <> 'posted' then
    raise exception 'Only a posted pay run can be reversed; delete a draft instead' using errcode = '22023';
  end if;
  select e.id into v_reversal from public.journal_entry e where e.reverses_entry_id = r.journal_entry_id;
  if v_reversal is null then
    v_reversal := public.ledger_reverse_entry(r.journal_entry_id, coalesce(p_entry_date, r.pay_date),
      coalesce(nullif(btrim(p_memo), ''), format('Reversal of payroll paid %s', to_char(r.pay_date, 'YYYY-MM-DD'))));
  end if;
  update public.payroll_run set status = 'reversed', reversal_entry_id = v_reversal,
    reversed_by = auth.uid(), reversed_at = now()
  where id = p_run;
  perform app.record_material_audit(r.organization_id, 'payroll', 'run_reversed', 'payroll_run', p_run,
    jsonb_build_object('reversal_entry_id', v_reversal, 'entry_date', p_entry_date));
  return v_reversal;
end;
$$;
revoke all on function public.payroll_reverse_run(uuid, date, text) from public, anon;
grant execute on function public.payroll_reverse_run(uuid, date, text) to authenticated, service_role;

create or replace function public.payroll_delete_draft(p_run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payroll_run;
begin
  select * into r from public.payroll_run where id = p_run for update;
  if not found or not app.is_org_admin(r.organization_id) then
    raise exception 'Only an administrator with MFA deletes payroll drafts' using errcode = '42501';
  end if;
  -- The run trigger refuses a posted or reversed run.
  delete from public.payroll_run where id = p_run;
  perform app.record_material_audit(r.organization_id, 'payroll', 'draft_deleted', 'organization', r.organization_id,
    jsonb_build_object('run_id', p_run, 'pay_date', r.pay_date, 'gross_wages_cents', r.gross_wages_cents));
end;
$$;
revoke all on function public.payroll_delete_draft(uuid) from public, anon;
grant execute on function public.payroll_delete_draft(uuid) to authenticated, service_role;
