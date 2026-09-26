-- Double-entry general ledger with a fund dimension (#148 B1, #149 B2; epic
-- #140). QBBE keeps its books in the app from 2026-10-01.
--
-- What the database guarantees, whoever the caller is:
--   * every journal entry balances: total debits equal total credits, and they
--     also balance within each fund, so every fund is a self-balancing set of
--     accounts and fund balances always add up to the whole ledger;
--   * nothing is posted before the accountant's approval of the chart of
--     accounts has been recorded;
--   * an entry dated in a closed period (or in no period at all) cannot be
--     created, changed or posted;
--   * a posted entry, and each of its lines, cannot be updated or deleted by
--     anyone, owners and the service role included. A correction is a new,
--     reversing entry;
--   * an expense charged to a restricted fund must fall inside the fund's
--     dates and, when the fund names programs, carry one of those programs.
--
-- Who does what:
--   * owners and admins who completed MFA (app.is_org_admin) keep the books:
--     accounts, funds, periods, entries, posting and reversing;
--   * staff members an admin has named as ledger readers see everything
--     read-only (finance staff; the accountant's own login arrives with B7);
--   * everyone else sees nothing.
--
-- Journal tables accept writes only through the functions below. Money is
-- integer cents, never floats. The nullable source columns on an entry let
-- receipts (#142) and bank import (#151) post later without a schema change.

-- ---------------------------------------------------------------------------
-- Who may read the books
-- ---------------------------------------------------------------------------
create table public.ledger_reader (
  organization_id uuid not null references public.organization (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  granted_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

comment on table public.ledger_reader is
  'Staff members given read-only access to the general ledger (#148). Admins with MFA read it without a row here.';

create or replace function app.can_read_ledger(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_org_admin(p_organization)
    or (
      app.is_org_staff(p_organization)
      and exists (
        select 1 from public.ledger_reader r
        where r.organization_id = p_organization and r.user_id = auth.uid()
      )
    );
$$;
revoke all on function app.can_read_ledger(uuid) from public, anon;
grant execute on function app.can_read_ledger(uuid) to authenticated, service_role;

alter table public.ledger_reader enable row level security;

create policy ledger_reader_read on public.ledger_reader
for select to authenticated using (
  app.is_org_admin(organization_id)
  or (user_id = (select auth.uid()) and app.is_org_staff(organization_id))
);

create policy ledger_reader_grant on public.ledger_reader
for insert to authenticated with check (app.is_org_admin(organization_id));

create policy ledger_reader_revoke on public.ledger_reader
for delete to authenticated using (app.is_org_admin(organization_id));

revoke all on public.ledger_reader from anon;
revoke update, truncate on public.ledger_reader from authenticated;
grant select, insert, delete on public.ledger_reader to authenticated;
grant all on public.ledger_reader to service_role;

-- Only a staff member of the same organization can be named a reader, and the
-- grantor is recorded here rather than taken from the request.
create or replace function app.protect_ledger_reader()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.organization_membership m
      where m.organization_id = new.organization_id and m.user_id = new.user_id
        and m.status = 'active' and m.role in ('owner', 'admin', 'staff')
    ) then
      raise exception 'Only active staff of this organization can read the ledger'
        using errcode = '23514';
    end if;
    new.granted_by := coalesce(auth.uid(), new.granted_by);
    new.created_at := now();
    perform app.record_material_audit(new.organization_id, 'ledger', 'reader_granted',
      'user_profile', new.user_id, '{}'::jsonb);
    return new;
  end if;
  perform app.record_material_audit(old.organization_id, 'ledger', 'reader_revoked',
    'user_profile', old.user_id, '{}'::jsonb);
  return old;
end;
$$;
revoke all on function app.protect_ledger_reader() from public, anon, authenticated;
create trigger ledger_reader_protect before insert or delete on public.ledger_reader
for each row execute function app.protect_ledger_reader();

-- ---------------------------------------------------------------------------
-- Settings: the accountant's approval of the chart of accounts
-- ---------------------------------------------------------------------------
create table public.ledger_settings (
  organization_id uuid primary key references public.organization (id) on delete cascade,
  chart_approved_on date,
  chart_approved_by_name text
    check (chart_approved_by_name is null or char_length(btrim(chart_approved_by_name)) between 1 and 200),
  chart_approval_recorded_by uuid references public.user_profile (id) on delete set null,
  chart_approval_recorded_at timestamptz,
  -- Serializes entry numbering: posting locks this row.
  last_entry_number integer not null default 0 check (last_entry_number >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_settings_approval_complete check (
    (chart_approved_on is null) = (chart_approved_by_name is null)
    and (chart_approved_on is null) = (chart_approval_recorded_at is null)
  )
);

comment on table public.ledger_settings is
  'Per-organization ledger state. Posting is refused until the accountant approval of the chart of accounts is recorded.';

alter table public.ledger_settings enable row level security;
create policy ledger_settings_read on public.ledger_settings
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.ledger_settings from anon;
revoke insert, update, delete, truncate on public.ledger_settings from authenticated;
grant select on public.ledger_settings to authenticated;
grant all on public.ledger_settings to service_role;

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
create table public.ledger_account (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  code text not null check (code ~ '^[0-9]{3,6}$'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  account_type text not null
    check (account_type in ('asset', 'liability', 'net_assets', 'revenue', 'expense')),
  description text check (description is null or char_length(description) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

comment on table public.ledger_account is
  'Chart of accounts (#148). Assets and expenses normally carry debit balances; liabilities, net assets and revenue credit balances.';

alter table public.ledger_account enable row level security;
create policy ledger_account_read on public.ledger_account
for select to authenticated using (app.can_read_ledger(organization_id));
create policy ledger_account_insert on public.ledger_account
for insert to authenticated with check (app.is_org_admin(organization_id));
create policy ledger_account_update on public.ledger_account
for update to authenticated
using (app.is_org_admin(organization_id))
with check (app.is_org_admin(organization_id));
revoke all on public.ledger_account from anon;
revoke delete, truncate on public.ledger_account from authenticated;
grant select, insert, update on public.ledger_account to authenticated;
grant all on public.ledger_account to service_role;

-- ---------------------------------------------------------------------------
-- Funds (#149)
-- ---------------------------------------------------------------------------
create table public.ledger_fund (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  restriction text not null
    check (restriction in ('unrestricted', 'internally_restricted', 'externally_restricted')),
  funder text check (funder is null or char_length(btrim(funder)) between 1 and 200),
  -- A restricted fund's money may be spent only between these dates.
  starts_on date,
  ends_on date,
  description text check (description is null or char_length(description) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  constraint ledger_fund_dates_ordered check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

comment on table public.ledger_fund is
  'Funds (#149): unrestricted, internally restricted (board designation) or externally restricted (a funder''s conditions).';

-- Programs a restricted fund may be spent on. None listed means any program.
create table public.ledger_fund_program (
  organization_id uuid not null,
  fund_id uuid not null,
  program_id uuid not null references public.program (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (fund_id, program_id),
  foreign key (organization_id, fund_id)
    references public.ledger_fund (organization_id, id) on delete cascade
);

alter table public.ledger_fund enable row level security;
create policy ledger_fund_read on public.ledger_fund
for select to authenticated using (app.can_read_ledger(organization_id));
create policy ledger_fund_insert on public.ledger_fund
for insert to authenticated with check (app.is_org_admin(organization_id));
create policy ledger_fund_update on public.ledger_fund
for update to authenticated
using (app.is_org_admin(organization_id))
with check (app.is_org_admin(organization_id));
revoke all on public.ledger_fund from anon;
revoke delete, truncate on public.ledger_fund from authenticated;
grant select, insert, update on public.ledger_fund to authenticated;
grant all on public.ledger_fund to service_role;

alter table public.ledger_fund_program enable row level security;
create policy ledger_fund_program_read on public.ledger_fund_program
for select to authenticated using (app.can_read_ledger(organization_id));
create policy ledger_fund_program_insert on public.ledger_fund_program
for insert to authenticated with check (app.is_org_admin(organization_id));
create policy ledger_fund_program_delete on public.ledger_fund_program
for delete to authenticated using (app.is_org_admin(organization_id));
revoke all on public.ledger_fund_program from anon;
revoke update, truncate on public.ledger_fund_program from authenticated;
grant select, insert, delete on public.ledger_fund_program to authenticated;
grant all on public.ledger_fund_program to service_role;

-- ---------------------------------------------------------------------------
-- Fiscal periods
-- ---------------------------------------------------------------------------
create table public.ledger_period (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_by uuid references public.user_profile (id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, starts_on),
  constraint ledger_period_dates_ordered check (starts_on <= ends_on),
  constraint ledger_period_close_recorded check ((status = 'closed') = (closed_at is not null))
);

create index idx_ledger_period_org_dates on public.ledger_period (organization_id, starts_on, ends_on);

alter table public.ledger_period enable row level security;
create policy ledger_period_read on public.ledger_period
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.ledger_period from anon;
revoke insert, update, delete, truncate on public.ledger_period from authenticated;
grant select on public.ledger_period to authenticated;
grant all on public.ledger_period to service_role;

create or replace function app.protect_ledger_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.journal_entry e
               where e.organization_id = old.organization_id
                 and e.entry_date between old.starts_on and old.ends_on) then
      raise exception 'A period that holds entries cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' and (new.organization_id, new.starts_on, new.ends_on)
       is distinct from (old.organization_id, old.starts_on, old.ends_on) then
    raise exception 'A period''s dates cannot change' using errcode = '42501';
  end if;
  if exists (select 1 from public.ledger_period p
             where p.organization_id = new.organization_id and p.id <> new.id
               and p.starts_on <= new.ends_on and new.starts_on <= p.ends_on) then
    raise exception 'Fiscal periods cannot overlap' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_ledger_period() from public, anon, authenticated;
create trigger ledger_period_protect before insert or update or delete on public.ledger_period
for each row execute function app.protect_ledger_period();

-- ---------------------------------------------------------------------------
-- Journal entries and lines
-- ---------------------------------------------------------------------------
create table public.journal_entry (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  -- Assigned in order when posted; drafts have none.
  entry_number integer check (entry_number is null or entry_number > 0),
  entry_date date not null,
  memo text not null check (char_length(btrim(memo)) between 1 and 500),
  kind text not null default 'standard' check (kind in ('standard', 'opening', 'reversal')),
  status text not null default 'draft' check (status in ('draft', 'posted')),
  reverses_entry_id uuid references public.journal_entry (id),
  -- Where the entry came from when another module created it (a receipt, a
  -- bank transaction, a pay run). Nullable: manual entries have none.
  source_type text check (source_type is null or source_type ~ '^[a-z][a-z_]{1,39}$'),
  source_id uuid,
  created_by uuid references public.user_profile (id) on delete set null,
  posted_by uuid references public.user_profile (id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, entry_number),
  constraint journal_entry_post_recorded check (
    (status = 'posted') = (posted_at is not null)
    and (status = 'posted') = (entry_number is not null)
  ),
  constraint journal_entry_reversal_shape check ((kind = 'reversal') = (reverses_entry_id is not null)),
  constraint journal_entry_source_pair check ((source_type is null) = (source_id is null))
);

-- An entry is reversed at most once.
create unique index uq_journal_entry_reverses on public.journal_entry (reverses_entry_id)
  where reverses_entry_id is not null;
create index idx_journal_entry_org_date on public.journal_entry (organization_id, entry_date, entry_number);
create index idx_journal_entry_source on public.journal_entry (organization_id, source_type, source_id)
  where source_type is not null;

comment on table public.journal_entry is
  'Journal entries (#148). Must balance; posted entries are immutable and corrected only by a reversing entry.';

create table public.journal_line (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  entry_id uuid not null,
  line_no integer not null check (line_no between 1 and 500),
  account_id uuid not null,
  fund_id uuid not null,
  program_id uuid references public.program (id),
  project_id uuid references public.project (id),
  description text check (description is null or char_length(description) <= 500),
  debit_cents bigint not null default 0 check (debit_cents between 0 and 10000000000000),
  credit_cents bigint not null default 0 check (credit_cents between 0 and 10000000000000),
  created_at timestamptz not null default now(),
  unique (entry_id, line_no),
  -- Exactly one side carries a positive amount.
  constraint journal_line_one_side check ((debit_cents > 0) <> (credit_cents > 0)),
  foreign key (organization_id, entry_id)
    references public.journal_entry (organization_id, id) on delete cascade,
  foreign key (organization_id, account_id) references public.ledger_account (organization_id, id),
  foreign key (organization_id, fund_id) references public.ledger_fund (organization_id, id)
);

create index idx_journal_line_account on public.journal_line (organization_id, account_id);
create index idx_journal_line_fund on public.journal_line (organization_id, fund_id);
create index idx_journal_line_entry on public.journal_line (entry_id);

alter table public.journal_entry enable row level security;
create policy journal_entry_read on public.journal_entry
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.journal_entry from anon;
revoke insert, update, delete, truncate on public.journal_entry from authenticated;
grant select on public.journal_entry to authenticated;
grant all on public.journal_entry to service_role;

alter table public.journal_line enable row level security;
create policy journal_line_read on public.journal_line
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.journal_line from anon;
revoke insert, update, delete, truncate on public.journal_line from authenticated;
grant select on public.journal_line to authenticated;
grant all on public.journal_line to service_role;

-- ---------------------------------------------------------------------------
-- Immutability of posted entries. These run for every role, the table owner
-- and the service role included; nothing in the app turns them off.
-- ---------------------------------------------------------------------------
create or replace function app.protect_journal_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'A posted journal entry cannot be deleted; reverse it instead'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'posted' then
      raise exception 'A posted journal entry cannot be changed; reverse it instead'
        using errcode = '42501';
    end if;
    if new.organization_id is distinct from old.organization_id then
      raise exception 'An entry cannot move between organizations' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function app.protect_journal_entry() from public, anon, authenticated;
create trigger journal_entry_protect before insert or update or delete on public.journal_entry
for each row execute function app.protect_journal_entry();

create or replace function app.protect_journal_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
begin
  if exists (select 1 from public.journal_entry e where e.id = v_entry and e.status = 'posted')
     or (tg_op = 'UPDATE' and exists (
       select 1 from public.journal_entry e where e.id = old.entry_id and e.status = 'posted')) then
    raise exception 'Lines of a posted journal entry cannot change' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app.protect_journal_line() from public, anon, authenticated;
create trigger journal_line_protect before insert or update or delete on public.journal_line
for each row execute function app.protect_journal_line();

-- ---------------------------------------------------------------------------
-- The rules every entry must meet, checked at commit so an entry is judged
-- with all of its lines in place. Deferred constraint triggers on both tables
-- mean no writer (a function, the service role, a migration) can leave an
-- unbalanced entry behind.
-- ---------------------------------------------------------------------------
create or replace function app.ledger_check_entry(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.journal_entry;
  v_period public.ledger_period;
  v_lines integer;
  v_debits bigint;
  v_credits bigint;
  v_bad record;
begin
  select * into e from public.journal_entry where id = p_entry;
  if not found then
    return; -- deleted draft
  end if;

  select count(*), coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0)
    into v_lines, v_debits, v_credits
  from public.journal_line where entry_id = e.id;

  if v_debits <> v_credits then
    raise exception 'Journal entry does not balance: debits % and credits % (cents)', v_debits, v_credits
      using errcode = '23514';
  end if;

  select f.code into v_bad
  from public.journal_line l join public.ledger_fund f on f.id = l.fund_id
  where l.entry_id = e.id
  group by f.code
  having sum(l.debit_cents) <> sum(l.credit_cents)
  limit 1;
  if found then
    raise exception 'Journal entry does not balance within fund %', v_bad.code using errcode = '23514';
  end if;

  select * into v_period from public.ledger_period p
  where p.organization_id = e.organization_id and e.entry_date between p.starts_on and p.ends_on;
  if not found then
    raise exception 'No fiscal period covers %', e.entry_date using errcode = '23514';
  end if;
  if v_period.status = 'closed' then
    raise exception 'Period % is closed', v_period.name using errcode = '23514';
  end if;

  -- Program and project must be this organization's, the project inside the
  -- program when both are given.
  select l.line_no into v_bad from public.journal_line l
  left join public.program pg on pg.id = l.program_id
  left join public.project pj on pj.id = l.project_id
  where l.entry_id = e.id and (
    (l.program_id is not null and pg.organization_id is distinct from e.organization_id)
    or (l.project_id is not null and (pj.organization_id is distinct from e.organization_id
        or (l.program_id is not null and pj.program_id is distinct from l.program_id)))
  )
  limit 1;
  if found then
    raise exception 'Line %: program or project is not in this organization or program', v_bad.line_no
      using errcode = '23514';
  end if;

  if e.status <> 'posted' then
    return;
  end if;

  -- Rules that apply to posting.
  if v_lines < 2 or v_debits = 0 then
    raise exception 'A posted entry needs at least two lines and a non-zero amount' using errcode = '23514';
  end if;

  if not exists (select 1 from public.ledger_settings s
                 where s.organization_id = e.organization_id and s.chart_approved_on is not null) then
    raise exception 'Record the accountant''s approval of the chart of accounts before posting'
      using errcode = '23514';
  end if;

  select l.line_no, a.code into v_bad from public.journal_line l
  join public.ledger_account a on a.id = l.account_id
  where l.entry_id = e.id and not a.is_active and e.kind <> 'reversal'
  limit 1;
  if found then
    raise exception 'Line %: account % is inactive', v_bad.line_no, v_bad.code using errcode = '23514';
  end if;

  select l.line_no, f.code into v_bad from public.journal_line l
  join public.ledger_fund f on f.id = l.fund_id
  where l.entry_id = e.id and not f.is_active and e.kind <> 'reversal'
  limit 1;
  if found then
    raise exception 'Line %: fund % is inactive', v_bad.line_no, v_bad.code using errcode = '23514';
  end if;

  -- Restricted money is spent only inside its dates and allowed programs.
  -- A reversal undoes an entry that already passed these checks.
  if e.kind <> 'reversal' then
    select l.line_no, f.code,
           (f.starts_on is not null and e.entry_date < f.starts_on)
             or (f.ends_on is not null and e.entry_date > f.ends_on) as out_of_dates
      into v_bad
    from public.journal_line l
    join public.ledger_account a on a.id = l.account_id
    join public.ledger_fund f on f.id = l.fund_id
    where l.entry_id = e.id
      and a.account_type = 'expense'
      and f.restriction <> 'unrestricted'
      and (
        (f.starts_on is not null and e.entry_date < f.starts_on)
        or (f.ends_on is not null and e.entry_date > f.ends_on)
        or (exists (select 1 from public.ledger_fund_program fp where fp.fund_id = f.id)
            and not exists (select 1 from public.ledger_fund_program fp
                            where fp.fund_id = f.id and fp.program_id = l.program_id))
      )
    limit 1;
    if found then
      if v_bad.out_of_dates then
        raise exception 'Line %: restricted fund % cannot be spent on %', v_bad.line_no, v_bad.code, e.entry_date
          using errcode = '23514';
      end if;
      raise exception 'Line %: restricted fund % can only be spent on its programs', v_bad.line_no, v_bad.code
        using errcode = '23514';
    end if;
  end if;
end;
$$;
revoke all on function app.ledger_check_entry(uuid) from public, anon, authenticated;

create or replace function app.ledger_check_entry_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'journal_entry' then
    perform app.ledger_check_entry(new.id);
  elsif tg_op = 'DELETE' then
    perform app.ledger_check_entry(old.entry_id);
  else
    perform app.ledger_check_entry(new.entry_id);
    if tg_op = 'UPDATE' and old.entry_id <> new.entry_id then
      perform app.ledger_check_entry(old.entry_id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function app.ledger_check_entry_trigger() from public, anon, authenticated;

create constraint trigger journal_entry_rules
after insert or update on public.journal_entry
deferrable initially deferred
for each row execute function app.ledger_check_entry_trigger();

create constraint trigger journal_line_rules
after insert or update or delete on public.journal_line
deferrable initially deferred
for each row execute function app.ledger_check_entry_trigger();

-- ---------------------------------------------------------------------------
-- Accounts and funds: what an admin may change
-- ---------------------------------------------------------------------------
create or replace function app.protect_ledger_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    perform app.record_material_audit(new.organization_id, 'ledger', 'account_created',
      'ledger_account', new.id, jsonb_build_object('code', new.code, 'name', new.name, 'type', new.account_type));
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id or new.created_at is distinct from old.created_at then
    raise exception 'An account cannot move between organizations' using errcode = '42501';
  end if;
  -- Once an account carries amounts, its code and type are part of the record.
  if (new.code, new.account_type) is distinct from (old.code, old.account_type)
     and exists (select 1 from public.journal_line l where l.account_id = old.id) then
    raise exception 'An account with entries keeps its code and type' using errcode = '42501';
  end if;
  perform app.record_material_audit(new.organization_id, 'ledger', 'account_updated',
    'ledger_account', new.id, jsonb_build_object('code', new.code, 'name', new.name,
      'type', new.account_type, 'active', new.is_active));
  return new;
end;
$$;
revoke all on function app.protect_ledger_account() from public, anon, authenticated;
create trigger ledger_account_protect before insert or update on public.ledger_account
for each row execute function app.protect_ledger_account();

create or replace function app.protect_ledger_fund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    perform app.record_material_audit(new.organization_id, 'ledger', 'fund_created',
      'ledger_fund', new.id, jsonb_build_object('code', new.code, 'restriction', new.restriction));
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id or new.created_at is distinct from old.created_at then
    raise exception 'A fund cannot move between organizations' using errcode = '42501';
  end if;
  if (new.code, new.restriction) is distinct from (old.code, old.restriction)
     and exists (select 1 from public.journal_line l where l.fund_id = old.id) then
    raise exception 'A fund with entries keeps its code and restriction' using errcode = '42501';
  end if;
  perform app.record_material_audit(new.organization_id, 'ledger', 'fund_updated',
    'ledger_fund', new.id, jsonb_build_object('code', new.code, 'restriction', new.restriction,
      'starts_on', new.starts_on, 'ends_on', new.ends_on, 'active', new.is_active));
  return new;
end;
$$;
revoke all on function app.protect_ledger_fund() from public, anon, authenticated;
create trigger ledger_fund_protect before insert or update on public.ledger_fund
for each row execute function app.protect_ledger_fund();

create or replace function app.protect_ledger_fund_program()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.program p
                   where p.id = new.program_id and p.organization_id = new.organization_id) then
      raise exception 'Program is not in this organization' using errcode = '23514';
    end if;
    new.created_at := now();
    return new;
  end if;
  return old;
end;
$$;
revoke all on function app.protect_ledger_fund_program() from public, anon, authenticated;
create trigger ledger_fund_program_protect before insert on public.ledger_fund_program
for each row execute function app.protect_ledger_fund_program();

-- ---------------------------------------------------------------------------
-- Starter chart and default fund
-- ---------------------------------------------------------------------------
-- A starting point for a Quebec nonprofit reporting under Part III of the CPA
-- Canada Handbook (ASNPO). The accountant reviews it before anything is
-- posted; admins can rename, add or deactivate accounts.
create or replace function app.ledger_seed_organization(p_organization uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ledger_settings (organization_id) values (p_organization)
  on conflict (organization_id) do nothing;

  insert into public.ledger_fund (organization_id, code, name, restriction, description)
  values (p_organization, 'GEN', 'General fund', 'unrestricted',
          'Day-to-day operations. Money no funder or board decision has set aside.')
  on conflict (organization_id, code) do nothing;

  insert into public.ledger_account (organization_id, code, name, account_type)
  select p_organization, v.code, v.name, v.account_type
  from (values
    ('1000', 'Bank - chequing', 'asset'),
    ('1010', 'Bank - savings', 'asset'),
    ('1050', 'Petty cash', 'asset'),
    ('1100', 'Accounts receivable', 'asset'),
    ('1150', 'Grants and contributions receivable', 'asset'),
    ('1200', 'GST receivable (input tax credits)', 'asset'),
    ('1210', 'QST receivable (input tax refunds)', 'asset'),
    ('1300', 'Prepaid expenses', 'asset'),
    ('1500', 'Furniture and equipment', 'asset'),
    ('1510', 'Accumulated amortization - furniture and equipment', 'asset'),
    ('1520', 'Computer equipment', 'asset'),
    ('1530', 'Accumulated amortization - computer equipment', 'asset'),
    ('2000', 'Accounts payable', 'liability'),
    ('2100', 'Accrued liabilities', 'liability'),
    ('2200', 'GST payable', 'liability'),
    ('2210', 'QST payable', 'liability'),
    ('2300', 'Source deductions payable', 'liability'),
    ('2310', 'Vacation pay payable', 'liability'),
    ('2400', 'Deferred contributions', 'liability'),
    ('2410', 'Deferred revenue', 'liability'),
    ('2500', 'Deferred contributions related to capital assets', 'liability'),
    ('2600', 'Long-term debt', 'liability'),
    ('3000', 'Unrestricted net assets', 'net_assets'),
    ('3100', 'Internally restricted net assets', 'net_assets'),
    ('3200', 'Externally restricted net assets', 'net_assets'),
    ('3300', 'Invested in capital assets', 'net_assets'),
    ('4000', 'Government grants - federal', 'revenue'),
    ('4010', 'Government grants - Quebec', 'revenue'),
    ('4020', 'Government grants - municipal', 'revenue'),
    ('4100', 'Foundation and corporate grants', 'revenue'),
    ('4200', 'Donations', 'revenue'),
    ('4300', 'Membership fees', 'revenue'),
    ('4400', 'Program and registration fees', 'revenue'),
    ('4500', 'Fundraising events', 'revenue'),
    ('4600', 'Sponsorships', 'revenue'),
    ('4700', 'Interest income', 'revenue'),
    ('4800', 'Amortization of deferred contributions', 'revenue'),
    ('4900', 'Other revenue', 'revenue'),
    ('5000', 'Salaries and wages', 'expense'),
    ('5010', 'Employer contributions (QPP, EI, QPIP, HSF, CNESST)', 'expense'),
    ('5020', 'Employee benefits', 'expense'),
    ('5100', 'Contract and professional fees', 'expense'),
    ('5110', 'Accounting and audit fees', 'expense'),
    ('5120', 'Legal fees', 'expense'),
    ('5200', 'Rent', 'expense'),
    ('5210', 'Utilities', 'expense'),
    ('5220', 'Insurance', 'expense'),
    ('5300', 'Office supplies', 'expense'),
    ('5310', 'Telephone and internet', 'expense'),
    ('5320', 'Software and subscriptions', 'expense'),
    ('5400', 'Program supplies', 'expense'),
    ('5410', 'Participant costs', 'expense'),
    ('5500', 'Travel', 'expense'),
    ('5510', 'Meals and hospitality', 'expense'),
    ('5600', 'Training and professional development', 'expense'),
    ('5700', 'Advertising and promotion', 'expense'),
    ('5800', 'Bank charges', 'expense'),
    ('5810', 'Interest expense', 'expense'),
    ('5900', 'Amortization of capital assets', 'expense'),
    ('5950', 'Non-recoverable GST and QST', 'expense'),
    ('5990', 'Other expenses', 'expense')
  ) as v(code, name, account_type)
  on conflict (organization_id, code) do nothing;
end;
$$;
revoke all on function app.ledger_seed_organization(uuid) from public, anon, authenticated;

create or replace function app.ledger_seed_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.ledger_seed_organization(new.id);
  return null;
end;
$$;
revoke all on function app.ledger_seed_new_organization() from public, anon, authenticated;
create trigger organization_ledger_seed after insert on public.organization
for each row execute function app.ledger_seed_new_organization();

select app.ledger_seed_organization(o.id) from public.organization o;

-- ---------------------------------------------------------------------------
-- Functions the app calls. Each checks the caller itself.
-- ---------------------------------------------------------------------------

-- The accountant's approval of the chart of accounts, recorded by an admin.
create or replace function public.ledger_record_chart_approval(
  p_organization uuid, p_approved_on date, p_approved_by_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if p_approved_on is null or p_approved_on > current_date then
    raise exception 'Approval date is required and cannot be in the future' using errcode = '22023';
  end if;
  if coalesce(btrim(p_approved_by_name), '') = '' then
    raise exception 'Name the accountant who approved the chart' using errcode = '22023';
  end if;
  perform app.ledger_seed_organization(p_organization);
  update public.ledger_settings set
    chart_approved_on = p_approved_on,
    chart_approved_by_name = btrim(p_approved_by_name),
    chart_approval_recorded_by = auth.uid(),
    chart_approval_recorded_at = now(),
    updated_at = now()
  where organization_id = p_organization;
  perform app.record_material_audit(p_organization, 'ledger', 'chart_approved',
    'organization', p_organization,
    jsonb_build_object('approved_on', p_approved_on, 'approved_by', btrim(p_approved_by_name)));
end;
$$;
revoke all on function public.ledger_record_chart_approval(uuid, date, text) from public, anon;
grant execute on function public.ledger_record_chart_approval(uuid, date, text) to authenticated, service_role;

-- Creates the twelve monthly periods of a fiscal year starting on p_starts_on
-- (the first day of a month). Months that already exist are left alone.
create or replace function public.ledger_create_fiscal_year(p_organization uuid, p_starts_on date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer := 0;
  v_month date;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if p_starts_on is null or extract(day from p_starts_on) <> 1 then
    raise exception 'A fiscal year starts on the first day of a month' using errcode = '22023';
  end if;
  for i in 0..11 loop
    v_month := (p_starts_on + make_interval(months => i))::date;
    if not exists (select 1 from public.ledger_period p
                   where p.organization_id = p_organization and p.starts_on = v_month) then
      insert into public.ledger_period (organization_id, name, starts_on, ends_on)
      values (p_organization, to_char(v_month, 'YYYY-MM'), v_month,
              (v_month + interval '1 month' - interval '1 day')::date);
      v_created := v_created + 1;
    end if;
  end loop;
  perform app.record_material_audit(p_organization, 'ledger', 'fiscal_year_created',
    'organization', p_organization, jsonb_build_object('starts_on', p_starts_on, 'created', v_created));
  return v_created;
end;
$$;
revoke all on function public.ledger_create_fiscal_year(uuid, date) from public, anon;
grant execute on function public.ledger_create_fiscal_year(uuid, date) to authenticated, service_role;

create or replace function public.ledger_set_period_status(p_period uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.ledger_period;
begin
  select * into v_period from public.ledger_period where id = p_period for update;
  if not found or not app.is_org_admin(v_period.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if p_status not in ('open', 'closed') then
    raise exception 'Status must be open or closed' using errcode = '22023';
  end if;
  if p_status = v_period.status then
    return;
  end if;
  if p_status = 'closed' and exists (
    select 1 from public.journal_entry e
    where e.organization_id = v_period.organization_id and e.status = 'draft'
      and e.entry_date between v_period.starts_on and v_period.ends_on
  ) then
    raise exception 'Post or delete the drafts in % before closing it', v_period.name using errcode = '23514';
  end if;
  update public.ledger_period set
    status = p_status,
    closed_by = case when p_status = 'closed' then auth.uid() end,
    closed_at = case when p_status = 'closed' then now() end
  where id = p_period;
  perform app.record_material_audit(v_period.organization_id, 'ledger',
    case when p_status = 'closed' then 'period_closed' else 'period_reopened' end,
    'ledger_period', p_period, jsonb_build_object('period', v_period.name));
end;
$$;
revoke all on function public.ledger_set_period_status(uuid, text) from public, anon;
grant execute on function public.ledger_set_period_status(uuid, text) to authenticated, service_role;

-- Saves a draft entry with all of its lines in one step. p_entry null creates
-- one. p_lines is a JSON array of objects: account_id, fund_id, program_id,
-- project_id, description, debit_cents, credit_cents. The balance rules are
-- checked at commit, so an unbalanced draft is refused as a whole.
create or replace function public.ledger_save_draft(
  p_organization uuid,
  p_entry uuid,
  p_entry_date date,
  p_memo text,
  p_kind text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid := p_entry;
  v_existing public.journal_entry;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if coalesce(p_kind, 'standard') not in ('standard', 'opening') then
    raise exception 'Kind must be standard or opening' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 500 then
    raise exception 'Lines must be a list of at most 500' using errcode = '22023';
  end if;

  if v_entry is null then
    insert into public.journal_entry (organization_id, entry_date, memo, kind, created_by)
    values (p_organization, p_entry_date, btrim(p_memo), coalesce(p_kind, 'standard'), auth.uid())
    returning id into v_entry;
  else
    select * into v_existing from public.journal_entry where id = v_entry for update;
    if not found or v_existing.organization_id <> p_organization then
      raise exception 'Entry not found' using errcode = 'P0002';
    end if;
    if v_existing.status <> 'draft' then
      raise exception 'A posted journal entry cannot be changed; reverse it instead' using errcode = '42501';
    end if;
    -- The period the draft sits in now must be open as well as the new one.
    if exists (select 1 from public.ledger_period p
               where p.organization_id = p_organization and p.status = 'closed'
                 and v_existing.entry_date between p.starts_on and p.ends_on) then
      raise exception 'The draft is in a closed period' using errcode = '23514';
    end if;
    update public.journal_entry set entry_date = p_entry_date, memo = btrim(p_memo),
      kind = coalesce(p_kind, 'standard')
    where id = v_entry;
    delete from public.journal_line where entry_id = v_entry;
  end if;

  insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id,
    program_id, project_id, description, debit_cents, credit_cents)
  select p_organization, v_entry, x.ordinality::integer,
    (x.value->>'account_id')::uuid,
    (x.value->>'fund_id')::uuid,
    nullif(x.value->>'program_id', '')::uuid,
    nullif(x.value->>'project_id', '')::uuid,
    nullif(btrim(x.value->>'description'), ''),
    coalesce((x.value->>'debit_cents')::bigint, 0),
    coalesce((x.value->>'credit_cents')::bigint, 0)
  from jsonb_array_elements(p_lines) with ordinality as x(value, ordinality);

  perform app.record_material_audit(p_organization, 'ledger', 'draft_saved',
    'journal_entry', v_entry, jsonb_build_object('lines', jsonb_array_length(p_lines)));
  return v_entry;
end;
$$;
revoke all on function public.ledger_save_draft(uuid, uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.ledger_save_draft(uuid, uuid, date, text, text, jsonb) to authenticated, service_role;

create or replace function public.ledger_delete_draft(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.journal_entry;
begin
  select * into v_existing from public.journal_entry where id = p_entry for update;
  if not found or not app.is_org_admin(v_existing.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  -- The delete trigger refuses a posted entry.
  delete from public.journal_entry where id = p_entry;
  perform app.record_material_audit(v_existing.organization_id, 'ledger', 'draft_deleted',
    'journal_entry', p_entry, jsonb_build_object('memo', v_existing.memo));
end;
$$;
revoke all on function public.ledger_delete_draft(uuid) from public, anon;
grant execute on function public.ledger_delete_draft(uuid) to authenticated, service_role;

-- Numbers and posts an entry. Numbering is serialized on the settings row so
-- posted entries are numbered without gaps in the order they were posted.
create or replace function app.ledger_post(p_entry uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.journal_entry;
  v_number integer;
begin
  select * into v_existing from public.journal_entry where id = p_entry;
  update public.ledger_settings set last_entry_number = last_entry_number + 1, updated_at = now()
  where organization_id = v_existing.organization_id
  returning last_entry_number into v_number;
  if v_number is null then
    raise exception 'Record the accountant''s approval of the chart of accounts before posting'
      using errcode = '23514';
  end if;
  update public.journal_entry set status = 'posted', entry_number = v_number,
    posted_by = auth.uid(), posted_at = now()
  where id = p_entry;
  -- Check now rather than at commit, so the caller gets the reason at once.
  perform app.ledger_check_entry(p_entry);
  return v_number;
end;
$$;
revoke all on function app.ledger_post(uuid) from public, anon, authenticated;

create or replace function public.ledger_post_entry(p_entry uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.journal_entry;
  v_number integer;
begin
  select * into v_existing from public.journal_entry where id = p_entry for update;
  if not found or not app.is_org_admin(v_existing.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if v_existing.status <> 'draft' then
    raise exception 'This entry is already posted' using errcode = '42501';
  end if;
  v_number := app.ledger_post(p_entry);
  perform app.record_material_audit(v_existing.organization_id, 'ledger', 'entry_posted',
    'journal_entry', p_entry, jsonb_build_object('entry_number', v_number,
      'entry_date', v_existing.entry_date, 'kind', v_existing.kind));
  return v_number;
end;
$$;
revoke all on function public.ledger_post_entry(uuid) from public, anon;
grant execute on function public.ledger_post_entry(uuid) to authenticated, service_role;

-- Corrects a posted entry by posting its mirror image on p_entry_date. The
-- original stays exactly as it was.
create or replace function public.ledger_reverse_entry(p_entry uuid, p_entry_date date, p_memo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.journal_entry;
  v_reversal uuid;
  v_number integer;
begin
  select * into v_original from public.journal_entry where id = p_entry for share;
  if not found or not app.is_org_admin(v_original.organization_id) then
    raise exception 'Only an administrator with MFA keeps the books' using errcode = '42501';
  end if;
  if v_original.status <> 'posted' then
    raise exception 'Only a posted entry can be reversed; delete a draft instead' using errcode = '22023';
  end if;
  if v_original.kind = 'reversal' then
    raise exception 'A reversing entry cannot itself be reversed; post a new entry' using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entry e where e.reverses_entry_id = p_entry) then
    raise exception 'This entry has already been reversed' using errcode = '23505';
  end if;
  if p_entry_date is null or p_entry_date < v_original.entry_date then
    raise exception 'A reversal is dated on or after the entry it reverses' using errcode = '22023';
  end if;

  insert into public.journal_entry (organization_id, entry_date, memo, kind, reverses_entry_id, created_by)
  values (v_original.organization_id, p_entry_date,
          coalesce(nullif(btrim(p_memo), ''), left('Reversal of entry ' || v_original.entry_number || ': ' || v_original.memo, 500)),
          'reversal', p_entry, auth.uid())
  returning id into v_reversal;

  insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id,
    program_id, project_id, description, debit_cents, credit_cents)
  select organization_id, v_reversal, line_no, account_id, fund_id, program_id, project_id,
    description, credit_cents, debit_cents
  from public.journal_line where entry_id = p_entry;

  v_number := app.ledger_post(v_reversal);
  perform app.record_material_audit(v_original.organization_id, 'ledger', 'entry_reversed',
    'journal_entry', p_entry, jsonb_build_object('reversal_id', v_reversal,
      'reversal_number', v_number, 'entry_date', p_entry_date));
  return v_reversal;
end;
$$;
revoke all on function public.ledger_reverse_entry(uuid, date, text) from public, anon;
grant execute on function public.ledger_reverse_entry(uuid, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reports. Security invoker: row-level security decides what is summed.
-- ---------------------------------------------------------------------------

-- Balance of every account as at p_as_of (posted entries only), optionally
-- for one fund. Balance is debits minus credits: positive is a debit balance.
create or replace function public.ledger_trial_balance(p_organization uuid, p_as_of date, p_fund uuid default null)
returns table (
  account_id uuid,
  code text,
  name text,
  account_type text,
  debit_cents bigint,
  credit_cents bigint,
  balance_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.code, a.name, a.account_type,
    coalesce(sum(l.debit_cents), 0)::bigint,
    coalesce(sum(l.credit_cents), 0)::bigint,
    (coalesce(sum(l.debit_cents), 0) - coalesce(sum(l.credit_cents), 0))::bigint
  from public.ledger_account a
  join public.journal_line l on l.account_id = a.id
  join public.journal_entry e on e.id = l.entry_id
  where a.organization_id = p_organization
    and e.status = 'posted'
    and e.entry_date <= p_as_of
    and (p_fund is null or l.fund_id = p_fund)
  group by a.id, a.code, a.name, a.account_type
  order by a.code;
$$;
revoke all on function public.ledger_trial_balance(uuid, date, uuid) from public, anon;
grant execute on function public.ledger_trial_balance(uuid, date, uuid) to authenticated, service_role;

-- Every posted line between two dates with the running balance of its
-- account, starting from the balance brought forward on p_from.
create or replace function public.ledger_general_ledger(
  p_organization uuid, p_from date, p_to date, p_account uuid default null, p_fund uuid default null
)
returns table (
  account_id uuid,
  account_code text,
  account_name text,
  opening_cents bigint,
  line_id uuid,
  entry_id uuid,
  entry_number integer,
  entry_date date,
  memo text,
  line_description text,
  fund_code text,
  debit_cents bigint,
  credit_cents bigint,
  running_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select l.*, e.entry_number, e.entry_date, e.memo
    from public.journal_line l
    join public.journal_entry e on e.id = l.entry_id
    where l.organization_id = p_organization
      and e.status = 'posted'
      and e.entry_date <= p_to
      and (p_account is null or l.account_id = p_account)
      and (p_fund is null or l.fund_id = p_fund)
  ),
  opening as (
    select s.account_id, sum(s.debit_cents - s.credit_cents)::bigint as cents
    from scoped s where s.entry_date < p_from group by s.account_id
  )
  select a.id, a.code, a.name, coalesce(o.cents, 0)::bigint,
    s.id, s.entry_id, s.entry_number, s.entry_date, s.memo, s.description, f.code,
    s.debit_cents, s.credit_cents,
    (coalesce(o.cents, 0) + sum(s.debit_cents - s.credit_cents)
      over (partition by s.account_id order by s.entry_date, s.entry_number, s.line_no))::bigint
  from scoped s
  join public.ledger_account a on a.id = s.account_id
  join public.ledger_fund f on f.id = s.fund_id
  left join opening o on o.account_id = s.account_id
  where s.entry_date >= p_from
  order by a.code, s.entry_date, s.entry_number, s.line_no;
$$;
revoke all on function public.ledger_general_ledger(uuid, date, date, uuid, uuid) from public, anon;
grant execute on function public.ledger_general_ledger(uuid, date, date, uuid, uuid) to authenticated, service_role;

-- Balance of each fund as at p_as_of: net assets plus revenue less expenses
-- (credit minus debit on those accounts), which equals the fund's assets less
-- its liabilities because every entry balances within each fund.
create or replace function public.ledger_fund_balances(p_organization uuid, p_as_of date)
returns table (
  fund_id uuid,
  code text,
  name text,
  restriction text,
  assets_cents bigint,
  liabilities_cents bigint,
  fund_balance_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.id, f.code, f.name, f.restriction,
    coalesce(sum(l.debit_cents - l.credit_cents) filter (where a.account_type = 'asset'), 0)::bigint,
    coalesce(sum(l.credit_cents - l.debit_cents) filter (where a.account_type = 'liability'), 0)::bigint,
    coalesce(sum(l.credit_cents - l.debit_cents)
      filter (where a.account_type in ('net_assets', 'revenue', 'expense')), 0)::bigint
  from public.ledger_fund f
  left join public.journal_line l on l.fund_id = f.id
    and exists (select 1 from public.journal_entry e
                where e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_as_of)
  left join public.ledger_account a on a.id = l.account_id
  where f.organization_id = p_organization
  group by f.id, f.code, f.name, f.restriction
  order by f.code;
$$;
revoke all on function public.ledger_fund_balances(uuid, date) from public, anon;
grant execute on function public.ledger_fund_balances(uuid, date) to authenticated, service_role;
