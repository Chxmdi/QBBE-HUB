-- Bank statement import and reconciliation (#151, bookkeeping B4; epic #140).
-- Builds on the general ledger (20260927100000_ledger_core).
--
-- What the database guarantees, whoever the caller is:
--   * a bank account is tied to one active asset account of the ledger (its
--     cash account), and no two bank accounts share one;
--   * importing the same statement line twice stores it once: every line has
--     a stable fingerprint, unique per bank account;
--   * a statement line is matched to at most one posted ledger line, on the
--     bank account's cash account, for exactly the same signed amount; a
--     ledger line is matched at most once;
--   * a reconciliation is marked reconciled only when the statement lines add
--     up to the statement's opening and closing balances, every statement line
--     in its dates is matched, the difference between the statement's closing
--     balance and the cleared ledger balance is zero, the previous
--     reconciliation of the account is reconciled and its closing balance is
--     this one's opening balance. A trigger checks this on every update, the
--     service role included;
--   * once reconciled, the statement lines in its dates and their matches are
--     frozen until the reconciliation is reopened (only the latest one can be).
--
-- Who does what: owners and admins who completed MFA (app.is_org_admin) do
-- every write, through the functions below; ledger readers
-- (app.can_read_ledger) see everything read-only; everyone else sees nothing.
--
-- Amounts are signed integer cents from the bank's point of view of the
-- account holder: a deposit is positive, a withdrawal negative. A deposit
-- matches a debit to the cash account, a withdrawal a credit.
--
-- No bank credentials or live feeds: statements arrive as uploaded CSV or OFX
-- files, parsed in the app, and only the parsed lines reach the database.

-- ---------------------------------------------------------------------------
-- Bank accounts
-- ---------------------------------------------------------------------------
create table public.bank_account (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  institution text not null
    check (institution in ('desjardins', 'national_bank', 'rbc', 'td', 'bmo', 'other')),
  -- Only the last four digits, to tell accounts apart. Never the full number.
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  ledger_account_id uuid not null,
  -- Fund used for entries created from a statement line unless one is chosen.
  default_fund_id uuid not null,
  -- Ledger lines dated before this day built the opening balance and count as
  -- cleared; reconciliation starts here.
  reconcile_from date not null,
  is_active boolean not null default true,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, ledger_account_id),
  foreign key (organization_id, ledger_account_id) references public.ledger_account (organization_id, id),
  foreign key (organization_id, default_fund_id) references public.ledger_fund (organization_id, id)
);

comment on table public.bank_account is
  'Bank accounts reconciled against a ledger cash account (#151). Stores the last four digits only.';

-- ---------------------------------------------------------------------------
-- Imports and statement lines
-- ---------------------------------------------------------------------------
create table public.bank_import (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  bank_account_id uuid not null,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  file_format text not null check (file_format in ('csv', 'ofx')),
  -- Which CSV layout was used (a bank preset or 'custom').
  layout text not null check (layout ~ '^[a-z][a-z_]{1,39}$'),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  lines_in_file integer not null check (lines_in_file between 0 and 5000),
  lines_added integer not null default 0 check (lines_added >= 0),
  lines_skipped integer not null default 0 check (lines_skipped >= 0),
  first_date date,
  last_date date,
  imported_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, bank_account_id)
    references public.bank_account (organization_id, id) on delete cascade
);

create index idx_bank_import_account on public.bank_import (bank_account_id, created_at desc);

create table public.bank_transaction (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  bank_account_id uuid not null,
  import_id uuid not null,
  posted_on date not null,
  amount_cents bigint not null check (amount_cents <> 0 and abs(amount_cents) <= 10000000000000),
  description text not null check (char_length(description) between 1 and 500),
  -- Cheque number or the bank's transaction id, when the file carries one.
  reference text check (reference is null or char_length(reference) <= 100),
  -- Stable hash of the line, computed from what the bank sent. Re-importing
  -- the same line produces the same fingerprint and is skipped.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (bank_account_id, fingerprint),
  foreign key (organization_id, bank_account_id)
    references public.bank_account (organization_id, id) on delete cascade,
  foreign key (organization_id, import_id)
    references public.bank_import (organization_id, id) on delete cascade
);

create index idx_bank_transaction_account_date on public.bank_transaction (bank_account_id, posted_on);
create index idx_bank_transaction_import on public.bank_transaction (import_id);

comment on table public.bank_transaction is
  'Statement lines imported from CSV or OFX (#151). Positive amounts are deposits, negative withdrawals.';

-- ---------------------------------------------------------------------------
-- Matches between statement lines and ledger lines
-- ---------------------------------------------------------------------------
create table public.bank_match (
  bank_transaction_id uuid primary key,
  organization_id uuid not null,
  journal_line_id uuid not null unique references public.journal_line (id),
  method text not null check (method in ('suggested', 'manual', 'created')),
  matched_by uuid references public.user_profile (id) on delete set null,
  matched_at timestamptz not null default now(),
  foreign key (organization_id, bank_transaction_id)
    references public.bank_transaction (organization_id, id) on delete cascade
);

create index idx_bank_match_org on public.bank_match (organization_id);

-- ---------------------------------------------------------------------------
-- Reconciliations: one per account per statement
-- ---------------------------------------------------------------------------
create table public.bank_reconciliation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  bank_account_id uuid not null,
  statement_start date not null,
  statement_end date not null,
  opening_balance_cents bigint not null check (abs(opening_balance_cents) <= 10000000000000),
  closing_balance_cents bigint not null check (abs(closing_balance_cents) <= 10000000000000),
  status text not null default 'open' check (status in ('open', 'reconciled')),
  reconciled_by uuid references public.user_profile (id) on delete set null,
  reconciled_at timestamptz,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (bank_account_id, statement_end),
  constraint bank_reconciliation_dates_ordered check (statement_start <= statement_end),
  constraint bank_reconciliation_close_recorded check ((status = 'reconciled') = (reconciled_at is not null)),
  foreign key (organization_id, bank_account_id)
    references public.bank_account (organization_id, id) on delete cascade
);

create index idx_bank_reconciliation_account on public.bank_reconciliation (bank_account_id, statement_start);

comment on table public.bank_reconciliation is
  'A statement reconciled against the ledger (#151). Reconciled only at a zero difference, enforced by trigger.';

-- ---------------------------------------------------------------------------
-- Row-level security: ledger readers read, nobody writes directly
-- ---------------------------------------------------------------------------
alter table public.bank_account enable row level security;
alter table public.bank_import enable row level security;
alter table public.bank_transaction enable row level security;
alter table public.bank_match enable row level security;
alter table public.bank_reconciliation enable row level security;

create policy bank_account_read on public.bank_account
for select to authenticated using (app.can_read_ledger(organization_id));
create policy bank_import_read on public.bank_import
for select to authenticated using (app.can_read_ledger(organization_id));
create policy bank_transaction_read on public.bank_transaction
for select to authenticated using (app.can_read_ledger(organization_id));
create policy bank_match_read on public.bank_match
for select to authenticated using (app.can_read_ledger(organization_id));
create policy bank_reconciliation_read on public.bank_reconciliation
for select to authenticated using (app.can_read_ledger(organization_id));

revoke all on public.bank_account, public.bank_import, public.bank_transaction,
  public.bank_match, public.bank_reconciliation from anon;
revoke insert, update, delete, truncate on public.bank_account, public.bank_import,
  public.bank_transaction, public.bank_match, public.bank_reconciliation from authenticated;
grant select on public.bank_account, public.bank_import, public.bank_transaction,
  public.bank_match, public.bank_reconciliation to authenticated;
grant all on public.bank_account, public.bank_import, public.bank_transaction,
  public.bank_match, public.bank_reconciliation to service_role;

-- ---------------------------------------------------------------------------
-- Integrity triggers (run for every role)
-- ---------------------------------------------------------------------------

-- True when p_day is inside a reconciled statement of the account.
create or replace function app.bank_day_locked(p_bank_account uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bank_reconciliation r
    where r.bank_account_id = p_bank_account and r.status = 'reconciled'
      and p_day between r.statement_start and r.statement_end
  );
$$;
revoke all on function app.bank_day_locked(uuid, date) from public, anon, authenticated;

create or replace function app.protect_bank_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.ledger_account a
                 where a.id = new.ledger_account_id and a.account_type = 'asset'
                   and (a.is_active or tg_op = 'UPDATE')) then
    raise exception 'A bank account is tied to an active asset account of the ledger'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'A bank account cannot move between organizations' using errcode = '42501';
    end if;
    if (new.ledger_account_id, new.reconcile_from) is distinct from (old.ledger_account_id, old.reconcile_from)
       and exists (select 1 from public.bank_reconciliation r where r.bank_account_id = old.id) then
      raise exception 'The cash account and start date cannot change once a reconciliation exists'
        using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function app.protect_bank_account() from public, anon, authenticated;
create trigger bank_account_protect before insert or update on public.bank_account
for each row execute function app.protect_bank_account();

create or replace function app.protect_bank_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Statement lines are kept as the bank sent them' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    -- Cascades from a deleted bank account are allowed.
    if exists (select 1 from public.bank_account b where b.id = old.bank_account_id)
       and app.bank_day_locked(old.bank_account_id, old.posted_on) then
      raise exception 'Line dated % is in a reconciled statement', old.posted_on using errcode = '42501';
    end if;
    return old;
  end if;
  if app.bank_day_locked(new.bank_account_id, new.posted_on) then
    raise exception 'Line dated % is in a reconciled statement', new.posted_on using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_bank_transaction() from public, anon, authenticated;
create trigger bank_transaction_protect before insert or update or delete on public.bank_transaction
for each row execute function app.protect_bank_transaction();

create or replace function app.protect_bank_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.bank_transaction;
  v_ok boolean;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Unmatch and match again instead' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    select * into t from public.bank_transaction where id = old.bank_transaction_id;
    if found and app.bank_day_locked(t.bank_account_id, t.posted_on) then
      raise exception 'Line dated % is in a reconciled statement', t.posted_on using errcode = '42501';
    end if;
    return old;
  end if;

  select * into t from public.bank_transaction where id = new.bank_transaction_id;
  if t.organization_id <> new.organization_id then
    raise exception 'Statement line not found' using errcode = 'P0002';
  end if;
  if app.bank_day_locked(t.bank_account_id, t.posted_on) then
    raise exception 'Line dated % is in a reconciled statement', t.posted_on using errcode = '23514';
  end if;
  select true into v_ok
  from public.journal_line l
  join public.journal_entry e on e.id = l.entry_id
  join public.bank_account b on b.id = t.bank_account_id
  where l.id = new.journal_line_id
    and l.organization_id = t.organization_id
    and l.account_id = b.ledger_account_id
    and e.status = 'posted'
    and l.debit_cents - l.credit_cents = t.amount_cents;
  if v_ok is null then
    raise exception 'A statement line matches a posted ledger line on the same cash account for the same amount'
      using errcode = '23514';
  end if;
  new.matched_at := now();
  return new;
end;
$$;
revoke all on function app.protect_bank_match() from public, anon, authenticated;
create trigger bank_match_protect before insert or update or delete on public.bank_match
for each row execute function app.protect_bank_match();

-- ---------------------------------------------------------------------------
-- Reconciliation figures. One definition, used by the screen, the report and
-- the close check, so what is shown is what is enforced.
--
--   statement_lines_cents  sum of statement lines dated inside the statement
--   ledger_balance_cents   balance of the cash account at statement_end
--                          (posted entries, all funds; debits minus credits)
--   cleared_balance_cents  the part of that balance the bank has seen: lines
--                          matched to a statement line dated on or before
--                          statement_end, opening-balance entries, and lines
--                          dated before the account's reconcile_from
--   outstanding_cents      ledger_balance - cleared_balance (cheques and
--                          deposits the bank has not processed yet)
--   difference_cents       closing_balance - cleared_balance
--   statement_gap_cents    closing - opening - statement_lines; not zero means
--                          a statement line is missing or extra
-- ---------------------------------------------------------------------------
create or replace function app.bank_reconciliation_figures(p_reconciliation uuid)
returns table (
  statement_lines_cents bigint,
  statement_gap_cents bigint,
  ledger_balance_cents bigint,
  cleared_balance_cents bigint,
  outstanding_cents bigint,
  outstanding_count integer,
  unmatched_count integer,
  unmatched_cents bigint,
  difference_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.bank_reconciliation;
  b public.bank_account;
  v_lines bigint;
  v_ledger bigint;
  v_cleared bigint;
  v_out_count integer;
  v_unmatched integer;
  v_unmatched_cents bigint;
begin
  select * into r from public.bank_reconciliation where id = p_reconciliation;
  if not found then
    return;
  end if;
  select * into b from public.bank_account where id = r.bank_account_id;

  select coalesce(sum(t.amount_cents), 0),
         count(*) filter (where m.bank_transaction_id is null),
         coalesce(sum(t.amount_cents) filter (where m.bank_transaction_id is null), 0)
    into v_lines, v_unmatched, v_unmatched_cents
  from public.bank_transaction t
  left join public.bank_match m on m.bank_transaction_id = t.id
  where t.bank_account_id = b.id and t.posted_on between r.statement_start and r.statement_end;

  select coalesce(sum(l.debit_cents - l.credit_cents), 0),
         coalesce(sum(l.debit_cents - l.credit_cents) filter (where
           e.kind = 'opening' or e.entry_date < b.reconcile_from or t.id is not null), 0),
         count(*) filter (where not (e.kind = 'opening' or e.entry_date < b.reconcile_from or t.id is not null))
    into v_ledger, v_cleared, v_out_count
  from public.journal_line l
  join public.journal_entry e on e.id = l.entry_id
  left join public.bank_match m on m.journal_line_id = l.id
  left join public.bank_transaction t on t.id = m.bank_transaction_id and t.posted_on <= r.statement_end
  where l.organization_id = b.organization_id
    and l.account_id = b.ledger_account_id
    and e.status = 'posted'
    and e.entry_date <= r.statement_end;

  return query select
    v_lines,
    r.closing_balance_cents - r.opening_balance_cents - v_lines,
    v_ledger,
    v_cleared,
    v_ledger - v_cleared,
    v_out_count,
    v_unmatched,
    v_unmatched_cents,
    r.closing_balance_cents - v_cleared;
end;
$$;
revoke all on function app.bank_reconciliation_figures(uuid) from public, anon, authenticated;

-- The screen's view of the figures: ledger readers only.
create or replace function public.bank_reconciliation_summary(p_reconciliation uuid)
returns table (
  statement_lines_cents bigint,
  statement_gap_cents bigint,
  ledger_balance_cents bigint,
  cleared_balance_cents bigint,
  outstanding_cents bigint,
  outstanding_count integer,
  unmatched_count integer,
  unmatched_cents bigint,
  difference_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.bank_reconciliation where id = p_reconciliation;
  if v_org is null or not app.can_read_ledger(v_org) then
    raise exception 'Reconciliation not found' using errcode = 'P0002';
  end if;
  return query select * from app.bank_reconciliation_figures(p_reconciliation);
end;
$$;
revoke all on function public.bank_reconciliation_summary(uuid) from public, anon;
grant execute on function public.bank_reconciliation_summary(uuid) to authenticated, service_role;

-- The close rule, checked on every change of a reconciliation.
create or replace function app.protect_bank_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
  v_prev public.bank_reconciliation;
begin
  if tg_op = 'DELETE' then
    if old.status = 'reconciled'
       and exists (select 1 from public.bank_account b where b.id = old.bank_account_id) then
      raise exception 'A reconciled statement cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  new.updated_at := now();

  if tg_op = 'UPDATE' then
    if (new.organization_id, new.bank_account_id, new.statement_start, new.statement_end)
       is distinct from (old.organization_id, old.bank_account_id, old.statement_start, old.statement_end) then
      raise exception 'A statement''s account and dates cannot change; delete it and start again'
        using errcode = '42501';
    end if;
    if old.status = 'reconciled' then
      -- The only change to a reconciled statement is reopening it, and only
      -- the latest one of the account, so later statements stay consistent.
      if new.status <> 'open'
         or (new.opening_balance_cents, new.closing_balance_cents)
            is distinct from (old.opening_balance_cents, old.closing_balance_cents) then
        raise exception 'A reconciled statement cannot be changed; reopen it first' using errcode = '42501';
      end if;
      if exists (select 1 from public.bank_reconciliation r
                 where r.bank_account_id = old.bank_account_id and r.status = 'reconciled'
                   and r.statement_start > old.statement_start) then
        raise exception 'Reopen the later reconciled statements first' using errcode = '23514';
      end if;
      new.reconciled_at := null;
      new.reconciled_by := null;
      return new;
    end if;
  end if;

  if exists (select 1 from public.bank_reconciliation r
             where r.bank_account_id = new.bank_account_id and r.id <> new.id
               and r.statement_start <= new.statement_end and new.statement_start <= r.statement_end) then
    raise exception 'Statements of one account cannot overlap' using errcode = '23514';
  end if;
  if new.statement_start < (select b.reconcile_from from public.bank_account b where b.id = new.bank_account_id) then
    raise exception 'The statement starts before the account''s reconciliation start date' using errcode = '23514';
  end if;

  if new.status = 'reconciled' then
    if tg_op = 'INSERT' then
      raise exception 'A reconciliation starts open' using errcode = '23514';
    end if;
    select * into v_prev from public.bank_reconciliation r
    where r.bank_account_id = new.bank_account_id and r.statement_start < new.statement_start
    order by r.statement_start desc limit 1;
    if found then
      if v_prev.status <> 'reconciled' then
        raise exception 'Reconcile the statement ending % first', v_prev.statement_end using errcode = '23514';
      end if;
      if v_prev.closing_balance_cents <> new.opening_balance_cents then
        raise exception 'The opening balance must equal the previous statement''s closing balance'
          using errcode = '23514';
      end if;
    end if;
    -- The figures read the stored row, whose dates equal new's (they cannot
    -- change); the balances are taken from new.
    select * into f from app.bank_reconciliation_figures(new.id);
    if f.unmatched_count > 0 then
      raise exception '% statement line(s) are not matched to the ledger', f.unmatched_count
        using errcode = '23514';
    end if;
    if new.closing_balance_cents - new.opening_balance_cents - f.statement_lines_cents <> 0 then
      raise exception 'The statement lines do not add up to the opening and closing balances'
        using errcode = '23514';
    end if;
    if new.closing_balance_cents - f.cleared_balance_cents <> 0 then
      raise exception 'The difference is not zero (% cents)', new.closing_balance_cents - f.cleared_balance_cents
        using errcode = '23514';
    end if;
    if new.reconciled_at is null then
      new.reconciled_at := now();
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.protect_bank_reconciliation() from public, anon, authenticated;
create trigger bank_reconciliation_protect before insert or update or delete on public.bank_reconciliation
for each row execute function app.protect_bank_reconciliation();

-- ---------------------------------------------------------------------------
-- Functions the app calls. Each checks the caller itself.
-- ---------------------------------------------------------------------------

-- Creates (p_id null) or updates a bank account.
create or replace function public.bank_save_account(
  p_organization uuid,
  p_id uuid,
  p_name text,
  p_institution text,
  p_account_last4 text,
  p_ledger_account uuid,
  p_default_fund uuid,
  p_reconcile_from date,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if p_reconcile_from is null then
    raise exception 'Choose the first day to reconcile' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.bank_account (organization_id, name, institution, account_last4,
      ledger_account_id, default_fund_id, reconcile_from, is_active, created_by)
    values (p_organization, btrim(p_name), p_institution, nullif(btrim(p_account_last4), ''),
      p_ledger_account, p_default_fund, p_reconcile_from, coalesce(p_is_active, true), auth.uid())
    returning id into v_id;
    perform app.record_material_audit(p_organization, 'bank', 'account_created',
      'bank_account', v_id, jsonb_build_object('name', btrim(p_name)));
  else
    update public.bank_account set name = btrim(p_name), institution = p_institution,
      account_last4 = nullif(btrim(p_account_last4), ''), ledger_account_id = p_ledger_account,
      default_fund_id = p_default_fund, reconcile_from = p_reconcile_from,
      is_active = coalesce(p_is_active, true)
    where id = v_id and organization_id = p_organization;
    if not found then
      raise exception 'Bank account not found' using errcode = 'P0002';
    end if;
    perform app.record_material_audit(p_organization, 'bank', 'account_updated',
      'bank_account', v_id, jsonb_build_object('name', btrim(p_name)));
  end if;
  return v_id;
end;
$$;
revoke all on function public.bank_save_account(uuid, uuid, text, text, text, uuid, uuid, date, boolean) from public, anon;
grant execute on function public.bank_save_account(uuid, uuid, text, text, text, uuid, uuid, date, boolean)
  to authenticated, service_role;

-- Stores the parsed lines of one statement file. p_lines is a JSON array of
-- objects: posted_on, amount_cents, description, reference, fingerprint.
-- Lines whose fingerprint the account already has are skipped, not errors.
create or replace function public.bank_import_statement(
  p_bank_account uuid,
  p_file_name text,
  p_file_format text,
  p_layout text,
  p_file_sha256 text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bank_account;
  v_import uuid;
  v_total integer;
  v_added integer;
begin
  select * into b from public.bank_account where id = p_bank_account;
  if not found or not app.is_org_admin(b.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if not b.is_active then
    raise exception 'This bank account is inactive' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then
    raise exception 'A statement file holds at most 5000 lines' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_lines);
  -- Serialize with closing a statement of the same account.
  perform 1 from public.bank_account where id = b.id for share;

  insert into public.bank_import (organization_id, bank_account_id, file_name, file_format, layout,
    file_sha256, lines_in_file, imported_by)
  values (b.organization_id, b.id, left(btrim(p_file_name), 200), p_file_format, p_layout,
    lower(p_file_sha256), v_total, auth.uid())
  returning id into v_import;

  with incoming as (
    select distinct on (x.value->>'fingerprint')
      (x.value->>'posted_on')::date as posted_on,
      (x.value->>'amount_cents')::bigint as amount_cents,
      left(btrim(x.value->>'description'), 500) as description,
      nullif(left(btrim(x.value->>'reference'), 100), '') as reference,
      lower(x.value->>'fingerprint') as fingerprint
    from jsonb_array_elements(p_lines) as x(value)
    order by x.value->>'fingerprint'
  ), inserted as (
    insert into public.bank_transaction (organization_id, bank_account_id, import_id, posted_on,
      amount_cents, description, reference, fingerprint)
    select b.organization_id, b.id, v_import, i.posted_on, i.amount_cents,
      coalesce(nullif(i.description, ''), '(no description)'), i.reference, i.fingerprint
    from incoming i
    where not exists (select 1 from public.bank_transaction t
                      where t.bank_account_id = b.id and t.fingerprint = i.fingerprint)
    on conflict (bank_account_id, fingerprint) do nothing
    returning posted_on
  )
  select count(*) into v_added from inserted;

  update public.bank_import set lines_added = v_added, lines_skipped = v_total - v_added,
    first_date = (select min(posted_on) from public.bank_transaction where import_id = v_import),
    last_date = (select max(posted_on) from public.bank_transaction where import_id = v_import)
  where id = v_import;

  perform app.record_material_audit(b.organization_id, 'bank', 'statement_imported',
    'bank_import', v_import, jsonb_build_object('bank_account_id', b.id, 'file_sha256', lower(p_file_sha256),
      'lines', v_total, 'added', v_added));
  return jsonb_build_object('import_id', v_import, 'added', v_added, 'skipped', v_total - v_added);
end;
$$;
revoke all on function public.bank_import_statement(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.bank_import_statement(uuid, text, text, text, text, jsonb)
  to authenticated, service_role;

-- Undoes an import: its lines go, unless one is matched or reconciled.
create or replace function public.bank_delete_import(p_import uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.bank_import;
begin
  select * into i from public.bank_import where id = p_import for update;
  if not found or not app.is_org_admin(i.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if exists (select 1 from public.bank_transaction t join public.bank_match m on m.bank_transaction_id = t.id
             where t.import_id = p_import) then
    raise exception 'Unmatch this import''s lines before deleting it' using errcode = '23514';
  end if;
  -- Serialize with closing a statement of the same account.
  perform 1 from public.bank_account where id = i.bank_account_id for share;
  -- The transaction trigger refuses lines in a reconciled statement.
  delete from public.bank_import where id = p_import;
  perform app.record_material_audit(i.organization_id, 'bank', 'import_deleted',
    'bank_import', p_import, jsonb_build_object('file_name', i.file_name, 'lines', i.lines_added));
end;
$$;
revoke all on function public.bank_delete_import(uuid) from public, anon;
grant execute on function public.bank_delete_import(uuid) to authenticated, service_role;

-- Candidate ledger lines for unmatched statement lines of an account: same
-- signed amount, posted, unmatched, dated within p_window_days. Ranked by the
-- gap in days; the app picks one per line.
create or replace function public.bank_match_candidates(
  p_bank_account uuid, p_from date, p_to date, p_window_days integer default 7
)
returns table (
  bank_transaction_id uuid,
  journal_line_id uuid,
  entry_id uuid,
  entry_number integer,
  entry_date date,
  memo text,
  day_gap integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bank_account;
begin
  select * into b from public.bank_account where id = p_bank_account;
  if not found or not app.can_read_ledger(b.organization_id) then
    raise exception 'Bank account not found' using errcode = 'P0002';
  end if;
  return query
  select t.id, l.id, e.id, e.entry_number, e.entry_date, e.memo,
    abs(e.entry_date - t.posted_on)::integer
  from public.bank_transaction t
  join public.journal_line l
    on l.organization_id = b.organization_id and l.account_id = b.ledger_account_id
   and l.debit_cents - l.credit_cents = t.amount_cents
  join public.journal_entry e on e.id = l.entry_id and e.status = 'posted'
  where t.bank_account_id = b.id
    and t.posted_on between p_from and p_to
    and abs(e.entry_date - t.posted_on) <= least(greatest(coalesce(p_window_days, 7), 0), 60)
    and not exists (select 1 from public.bank_match m where m.bank_transaction_id = t.id)
    and not exists (select 1 from public.bank_match m where m.journal_line_id = l.id)
  order by t.posted_on, t.id, abs(e.entry_date - t.posted_on), e.entry_number;
end;
$$;
revoke all on function public.bank_match_candidates(uuid, date, date, integer) from public, anon;
grant execute on function public.bank_match_candidates(uuid, date, date, integer) to authenticated, service_role;

create or replace function public.bank_match_line(p_transaction uuid, p_journal_line uuid, p_method text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.bank_transaction;
begin
  select * into t from public.bank_transaction where id = p_transaction;
  if not found or not app.is_org_admin(t.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  -- Serialize with closing a statement of the same account.
  perform 1 from public.bank_account where id = t.bank_account_id for share;
  if coalesce(p_method, '') not in ('suggested', 'manual') then
    raise exception 'Method must be suggested or manual' using errcode = '22023';
  end if;
  if exists (select 1 from public.bank_match m where m.bank_transaction_id = p_transaction) then
    raise exception 'This statement line is already matched' using errcode = '23505';
  end if;
  if exists (select 1 from public.bank_match m where m.journal_line_id = p_journal_line) then
    raise exception 'That ledger line is already matched to another statement line' using errcode = '23505';
  end if;
  insert into public.bank_match (bank_transaction_id, organization_id, journal_line_id, method, matched_by)
  values (p_transaction, t.organization_id, p_journal_line, p_method, auth.uid());
  perform app.record_material_audit(t.organization_id, 'bank', 'line_matched',
    'bank_transaction', p_transaction, jsonb_build_object('journal_line_id', p_journal_line, 'method', p_method));
end;
$$;
revoke all on function public.bank_match_line(uuid, uuid, text) from public, anon;
grant execute on function public.bank_match_line(uuid, uuid, text) to authenticated, service_role;

create or replace function public.bank_unmatch_line(p_transaction uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.bank_transaction;
  v_line uuid;
begin
  select * into t from public.bank_transaction where id = p_transaction;
  if not found or not app.is_org_admin(t.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  -- Serialize with closing a statement of the same account.
  perform 1 from public.bank_account where id = t.bank_account_id for share;
  -- The match trigger refuses a line in a reconciled statement.
  delete from public.bank_match where bank_transaction_id = p_transaction returning journal_line_id into v_line;
  if v_line is null then
    raise exception 'This statement line is not matched' using errcode = 'P0002';
  end if;
  perform app.record_material_audit(t.organization_id, 'bank', 'line_unmatched',
    'bank_transaction', p_transaction, jsonb_build_object('journal_line_id', v_line));
end;
$$;
revoke all on function public.bank_unmatch_line(uuid) from public, anon;
grant execute on function public.bank_unmatch_line(uuid) to authenticated, service_role;

-- Posts a two-line entry for a statement line the ledger does not have yet
-- (bank charges, interest, a deposit nobody entered) and matches it. The
-- entry goes through the ledger's own posting and every rule it checks:
-- balance, open period, chart approval, restricted funds.
create or replace function public.bank_create_entry(
  p_transaction uuid,
  p_contra_account uuid,
  p_fund uuid,
  p_program uuid,
  p_memo text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.bank_transaction;
  b public.bank_account;
  v_entry uuid;
  v_cash_line uuid;
  v_amount bigint;
  v_number integer;
  v_fund uuid;
begin
  select * into t from public.bank_transaction where id = p_transaction for update;
  if not found or not app.is_org_admin(t.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  select * into b from public.bank_account where id = t.bank_account_id for share;
  if exists (select 1 from public.bank_match m where m.bank_transaction_id = p_transaction) then
    raise exception 'This statement line is already matched' using errcode = '23505';
  end if;
  if p_contra_account = b.ledger_account_id then
    raise exception 'Choose an account other than the bank''s own cash account' using errcode = '22023';
  end if;
  v_fund := coalesce(p_fund, b.default_fund_id);
  v_amount := abs(t.amount_cents);

  insert into public.journal_entry (organization_id, entry_date, memo, kind, source_type, source_id, created_by)
  values (t.organization_id, t.posted_on,
    coalesce(nullif(left(btrim(p_memo), 500), ''), left(t.description, 500)),
    'standard', 'bank_transaction', t.id, auth.uid())
  returning id into v_entry;

  -- Deposit: debit cash, credit the other account. Withdrawal: the reverse.
  insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id, program_id,
    description, debit_cents, credit_cents)
  values (t.organization_id, v_entry, 1, b.ledger_account_id, v_fund, p_program, left(t.description, 500),
    case when t.amount_cents > 0 then v_amount else 0 end,
    case when t.amount_cents < 0 then v_amount else 0 end)
  returning id into v_cash_line;
  insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id, program_id,
    description, debit_cents, credit_cents)
  values (t.organization_id, v_entry, 2, p_contra_account, v_fund, p_program, left(t.description, 500),
    case when t.amount_cents < 0 then v_amount else 0 end,
    case when t.amount_cents > 0 then v_amount else 0 end);

  v_number := app.ledger_post(v_entry);

  insert into public.bank_match (bank_transaction_id, organization_id, journal_line_id, method, matched_by)
  values (t.id, t.organization_id, v_cash_line, 'created', auth.uid());

  perform app.record_material_audit(t.organization_id, 'ledger', 'entry_posted',
    'journal_entry', v_entry, jsonb_build_object('entry_number', v_number, 'entry_date', t.posted_on,
      'kind', 'standard', 'source_type', 'bank_transaction', 'source_id', t.id));
  perform app.record_material_audit(t.organization_id, 'bank', 'entry_created',
    'bank_transaction', t.id, jsonb_build_object('entry_id', v_entry, 'entry_number', v_number));
  return v_entry;
end;
$$;
revoke all on function public.bank_create_entry(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.bank_create_entry(uuid, uuid, uuid, uuid, text) to authenticated, service_role;

create or replace function public.bank_start_reconciliation(
  p_bank_account uuid, p_statement_start date, p_statement_end date,
  p_opening_balance_cents bigint, p_closing_balance_cents bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bank_account;
  v_id uuid;
begin
  select * into b from public.bank_account where id = p_bank_account;
  if not found or not app.is_org_admin(b.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if p_statement_start is null or p_statement_end is null or p_statement_start > p_statement_end then
    raise exception 'The statement ends on or after the day it starts' using errcode = '22023';
  end if;
  if p_opening_balance_cents is null or p_closing_balance_cents is null then
    raise exception 'Enter the statement''s opening and closing balances' using errcode = '22023';
  end if;
  insert into public.bank_reconciliation (organization_id, bank_account_id, statement_start, statement_end,
    opening_balance_cents, closing_balance_cents, created_by)
  values (b.organization_id, b.id, p_statement_start, p_statement_end,
    p_opening_balance_cents, p_closing_balance_cents, auth.uid())
  returning id into v_id;
  perform app.record_material_audit(b.organization_id, 'bank', 'reconciliation_started',
    'bank_reconciliation', v_id, jsonb_build_object('bank_account_id', b.id,
      'statement_start', p_statement_start, 'statement_end', p_statement_end));
  return v_id;
end;
$$;
revoke all on function public.bank_start_reconciliation(uuid, date, date, bigint, bigint) from public, anon;
grant execute on function public.bank_start_reconciliation(uuid, date, date, bigint, bigint)
  to authenticated, service_role;

-- Corrects the balances typed from the statement while it is still open.
create or replace function public.bank_update_reconciliation(
  p_reconciliation uuid, p_opening_balance_cents bigint, p_closing_balance_cents bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bank_reconciliation;
begin
  select * into r from public.bank_reconciliation where id = p_reconciliation for update;
  if not found or not app.is_org_admin(r.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if p_opening_balance_cents is null or p_closing_balance_cents is null then
    raise exception 'Enter the statement''s opening and closing balances' using errcode = '22023';
  end if;
  -- The trigger refuses a change to a reconciled statement.
  update public.bank_reconciliation set opening_balance_cents = p_opening_balance_cents,
    closing_balance_cents = p_closing_balance_cents
  where id = p_reconciliation;
  perform app.record_material_audit(r.organization_id, 'bank', 'reconciliation_updated',
    'bank_reconciliation', p_reconciliation, jsonb_build_object('opening', p_opening_balance_cents,
      'closing', p_closing_balance_cents));
end;
$$;
revoke all on function public.bank_update_reconciliation(uuid, bigint, bigint) from public, anon;
grant execute on function public.bank_update_reconciliation(uuid, bigint, bigint) to authenticated, service_role;

create or replace function public.bank_delete_reconciliation(p_reconciliation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bank_reconciliation;
begin
  select * into r from public.bank_reconciliation where id = p_reconciliation for update;
  if not found or not app.is_org_admin(r.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  delete from public.bank_reconciliation where id = p_reconciliation;
  perform app.record_material_audit(r.organization_id, 'bank', 'reconciliation_deleted',
    'bank_reconciliation', p_reconciliation, jsonb_build_object('statement_end', r.statement_end));
end;
$$;
revoke all on function public.bank_delete_reconciliation(uuid) from public, anon;
grant execute on function public.bank_delete_reconciliation(uuid) to authenticated, service_role;

-- Marks a statement reconciled, or reopens the latest one. The trigger on the
-- table enforces the zero difference and the order; this checks the caller.
create or replace function public.bank_set_reconciliation_status(p_reconciliation uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bank_reconciliation;
begin
  select * into r from public.bank_reconciliation where id = p_reconciliation for update;
  if not found or not app.is_org_admin(r.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if p_status not in ('open', 'reconciled') then
    raise exception 'Status must be open or reconciled' using errcode = '22023';
  end if;
  if p_status = r.status then
    return;
  end if;
  -- Serialize with imports and matches on the same account.
  perform 1 from public.bank_account where id = r.bank_account_id for update;
  update public.bank_reconciliation set status = p_status,
    reconciled_by = case when p_status = 'reconciled' then auth.uid() end,
    reconciled_at = case when p_status = 'reconciled' then now() end
  where id = p_reconciliation;
  perform app.record_material_audit(r.organization_id, 'bank',
    case when p_status = 'reconciled' then 'reconciliation_closed' else 'reconciliation_reopened' end,
    'bank_reconciliation', p_reconciliation, jsonb_build_object('statement_end', r.statement_end,
      'closing_balance_cents', r.closing_balance_cents));
end;
$$;
revoke all on function public.bank_set_reconciliation_status(uuid, text) from public, anon;
grant execute on function public.bank_set_reconciliation_status(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read helpers for the screens and the report: ledger readers only.
-- ---------------------------------------------------------------------------

-- Statement lines of an account between two dates, with what each is matched to.
create or replace function public.bank_statement_lines(p_bank_account uuid, p_from date, p_to date)
returns table (
  id uuid,
  posted_on date,
  amount_cents bigint,
  description text,
  reference text,
  import_id uuid,
  journal_line_id uuid,
  match_method text,
  entry_id uuid,
  entry_number integer,
  entry_date date,
  entry_memo text,
  locked boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bank_account;
begin
  select * into b from public.bank_account ba where ba.id = p_bank_account;
  if not found or not app.can_read_ledger(b.organization_id) then
    raise exception 'Bank account not found' using errcode = 'P0002';
  end if;
  return query
  select t.id, t.posted_on, t.amount_cents, t.description, t.reference, t.import_id,
    m.journal_line_id, m.method, e.id, e.entry_number, e.entry_date, e.memo,
    app.bank_day_locked(b.id, t.posted_on)
  from public.bank_transaction t
  left join public.bank_match m on m.bank_transaction_id = t.id
  left join public.journal_line l on l.id = m.journal_line_id
  left join public.journal_entry e on e.id = l.entry_id
  where t.bank_account_id = b.id and t.posted_on between p_from and p_to
  order by t.posted_on, t.created_at, t.id;
end;
$$;
revoke all on function public.bank_statement_lines(uuid, date, date) from public, anon;
grant execute on function public.bank_statement_lines(uuid, date, date) to authenticated, service_role;

-- Ledger lines on the cash account, dated on or before the statement's end,
-- that the bank has not cleared by then: the outstanding items.
create or replace function public.bank_reconciliation_outstanding(p_reconciliation uuid)
returns table (
  journal_line_id uuid,
  entry_id uuid,
  entry_number integer,
  entry_date date,
  memo text,
  amount_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.bank_reconciliation;
  b public.bank_account;
begin
  select * into r from public.bank_reconciliation where id = p_reconciliation;
  if not found or not app.can_read_ledger(r.organization_id) then
    raise exception 'Reconciliation not found' using errcode = 'P0002';
  end if;
  select * into b from public.bank_account where id = r.bank_account_id;
  return query
  select l.id, e.id, e.entry_number, e.entry_date, e.memo, l.debit_cents - l.credit_cents
  from public.journal_line l
  join public.journal_entry e on e.id = l.entry_id
  left join public.bank_match m on m.journal_line_id = l.id
  left join public.bank_transaction t on t.id = m.bank_transaction_id and t.posted_on <= r.statement_end
  where l.organization_id = b.organization_id
    and l.account_id = b.ledger_account_id
    and e.status = 'posted'
    and e.entry_date <= r.statement_end
    and not (e.kind = 'opening' or e.entry_date < b.reconcile_from or t.id is not null)
  order by e.entry_date, e.entry_number;
end;
$$;
revoke all on function public.bank_reconciliation_outstanding(uuid) from public, anon;
grant execute on function public.bank_reconciliation_outstanding(uuid) to authenticated, service_role;
