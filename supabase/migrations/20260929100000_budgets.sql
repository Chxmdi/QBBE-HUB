-- Budgets against actuals (#153 B6; epic #140).
--
-- One budget per organization and fiscal year, kept in versions: an admin
-- with MFA drafts it, approves it (which locks it), and revises it by opening
-- a new draft version copied from the approved one. Approving the new version
-- supersedes the old; every version stays for the record.
--
-- A budget line is an amount for a revenue or expense account, optionally for
-- one fund, program and project, phased across the twelve months of the
-- fiscal year. Amounts are integer cents in the account's natural direction:
-- revenue expected to come in, expense expected to go out.
--
-- Actuals come only from posted journal lines. The report compares them with
-- the budget for a month and for the year to date.
--
-- Who sees what:
--   * ledger readers (app.can_read_ledger: admins with MFA and named ledger
--     readers) see every budget and the full report;
--   * a program's leads and managers (app.can_manage_program) see a summary
--     of that program only: totals per account, never journal entries.
--
-- Budget tables accept writes only through the functions below, and the
-- locking triggers apply to every role, the service role included.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.budget (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  -- First day of the fiscal year's first month; the year is twelve months.
  fiscal_year_start date not null check (extract(day from fiscal_year_start) = 1),
  version integer not null check (version between 1 and 1000),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  created_by uuid references public.user_profile (id) on delete set null,
  approved_by uuid references public.user_profile (id) on delete set null,
  approved_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, fiscal_year_start, version),
  constraint budget_approval_recorded check ((status = 'draft') = (approved_at is null)),
  constraint budget_superseded_recorded check ((status = 'superseded') = (superseded_at is not null))
);

-- At most one approved version and one draft per fiscal year.
create unique index uq_budget_approved on public.budget (organization_id, fiscal_year_start)
  where status = 'approved';
create unique index uq_budget_draft on public.budget (organization_id, fiscal_year_start)
  where status = 'draft';

comment on table public.budget is
  'Annual budgets (#153), one per fiscal year, in versions. Approved versions are locked; a revision is a new version.';

create table public.budget_line (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  budget_id uuid not null,
  account_id uuid not null,
  fund_id uuid,
  program_id uuid,
  project_id uuid,
  -- The twelve months of the fiscal year, in order, in cents.
  month_cents bigint[] not null,
  annual_cents bigint not null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_line_twelve_months check (
    cardinality(month_cents) = 12
    and array_lower(month_cents, 1) = 1
    and array_position(month_cents, null) is null
    and 0 <= all (month_cents)
    and 10000000000000 >= all (month_cents)
  ),
  constraint budget_line_annual_is_sum check (
    annual_cents = month_cents[1] + month_cents[2] + month_cents[3] + month_cents[4]
      + month_cents[5] + month_cents[6] + month_cents[7] + month_cents[8]
      + month_cents[9] + month_cents[10] + month_cents[11] + month_cents[12]
  ),
  foreign key (organization_id, budget_id)
    references public.budget (organization_id, id) on delete cascade,
  foreign key (organization_id, account_id) references public.ledger_account (organization_id, id),
  foreign key (organization_id, fund_id) references public.ledger_fund (organization_id, id),
  foreign key (program_id, organization_id) references public.program (id, organization_id),
  foreign key (project_id, organization_id) references public.project (id, organization_id)
);

-- One line per account, fund, program and project in a budget.
create unique index uq_budget_line_key on public.budget_line
  (budget_id, account_id, fund_id, program_id, project_id) nulls not distinct;
create index idx_budget_line_budget on public.budget_line (budget_id);
create index idx_budget_line_program on public.budget_line (program_id) where program_id is not null;

comment on table public.budget_line is
  'Budget amounts (#153) per revenue or expense account, optionally per fund, program and project, phased by month.';

alter table public.budget enable row level security;
create policy budget_read on public.budget
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.budget from anon;
revoke insert, update, delete, truncate on public.budget from authenticated;
grant select on public.budget to authenticated;
grant all on public.budget to service_role;

alter table public.budget_line enable row level security;
create policy budget_line_read on public.budget_line
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.budget_line from anon;
revoke insert, update, delete, truncate on public.budget_line from authenticated;
grant select on public.budget_line to authenticated;
grant all on public.budget_line to service_role;

-- ---------------------------------------------------------------------------
-- Locking. An approved version changes only to become superseded; a
-- superseded one never changes; neither can be deleted, nor can their lines.
-- ---------------------------------------------------------------------------
create or replace function app.protect_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'An approved budget cannot be deleted; revise it instead' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if (new.organization_id, new.fiscal_year_start, new.version, new.created_at)
     is distinct from (old.organization_id, old.fiscal_year_start, old.version, old.created_at) then
    raise exception 'A budget keeps its organization, fiscal year and version' using errcode = '42501';
  end if;
  if old.status = 'superseded' then
    raise exception 'A superseded budget cannot change' using errcode = '42501';
  end if;
  if old.status = 'approved' and not (
    new.status = 'superseded'
    and (new.name, new.notes, new.created_by, new.approved_by, new.approved_at)
      is not distinct from (old.name, old.notes, old.created_by, old.approved_by, old.approved_at)
  ) then
    raise exception 'An approved budget is locked; revise it to make changes' using errcode = '42501';
  end if;
  if old.status = 'draft' and new.status = 'superseded' then
    raise exception 'Only an approved budget can be superseded' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function app.protect_budget() from public, anon, authenticated;
create trigger budget_protect before insert or update or delete on public.budget
for each row execute function app.protect_budget();

create or replace function app.protect_budget_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A line of a deleted draft goes with it: the budget row is already gone.
  if exists (
    select 1 from public.budget b
    where b.status <> 'draft'
      and (b.id = case when tg_op = 'DELETE' then old.budget_id else new.budget_id end
           or (tg_op = 'UPDATE' and b.id = old.budget_id))
  ) then
    raise exception 'An approved budget is locked; revise it to make changes' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.budget_id, new.organization_id) is distinct from (old.budget_id, old.organization_id) then
    raise exception 'A budget line cannot move between budgets' using errcode = '42501';
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app.protect_budget_line() from public, anon, authenticated;
create trigger budget_line_protect before insert or update or delete on public.budget_line
for each row execute function app.protect_budget_line();

-- ---------------------------------------------------------------------------
-- Functions the app calls to change budgets. Each checks the caller itself.
-- ---------------------------------------------------------------------------
create or replace function public.budget_create(
  p_organization uuid, p_fiscal_year_start date, p_name text, p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget uuid;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA manages budgets' using errcode = '42501';
  end if;
  if p_fiscal_year_start is null or extract(day from p_fiscal_year_start) <> 1 then
    raise exception 'A fiscal year starts on the first day of a month' using errcode = '22023';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Name the budget' using errcode = '22023';
  end if;
  if exists (select 1 from public.budget b
             where b.organization_id = p_organization and b.fiscal_year_start = p_fiscal_year_start) then
    raise exception 'This fiscal year already has a budget; open it and revise it instead'
      using errcode = '23505';
  end if;
  insert into public.budget (organization_id, fiscal_year_start, version, name, notes, created_by)
  values (p_organization, p_fiscal_year_start, 1, btrim(p_name), nullif(btrim(p_notes), ''), auth.uid())
  returning id into v_budget;
  perform app.record_material_audit(p_organization, 'budget', 'budget_created', 'budget', v_budget,
    jsonb_build_object('fiscal_year_start', p_fiscal_year_start, 'version', 1));
  return v_budget;
end;
$$;
revoke all on function public.budget_create(uuid, date, text, text) from public, anon;
grant execute on function public.budget_create(uuid, date, text, text) to authenticated, service_role;

-- Adds a line to a draft (p_line null) or changes one. p_month_cents holds the
-- twelve monthly amounts in fiscal-year order.
create or replace function public.budget_save_line(
  p_budget uuid,
  p_line uuid,
  p_account uuid,
  p_fund uuid,
  p_program uuid,
  p_project uuid,
  p_month_cents bigint[],
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget public.budget;
  v_line uuid := p_line;
  v_annual bigint;
begin
  select * into v_budget from public.budget where id = p_budget for update;
  if not found or not app.is_org_admin(v_budget.organization_id) then
    raise exception 'Only an administrator with MFA manages budgets' using errcode = '42501';
  end if;
  if v_budget.status <> 'draft' then
    raise exception 'An approved budget is locked; revise it to make changes' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ledger_account a
                 where a.id = p_account and a.organization_id = v_budget.organization_id
                   and a.account_type in ('revenue', 'expense')) then
    raise exception 'Budget a revenue or expense account of this organization' using errcode = '22023';
  end if;
  if p_fund is not null and not exists (
    select 1 from public.ledger_fund f where f.id = p_fund and f.organization_id = v_budget.organization_id) then
    raise exception 'The fund is not in this organization' using errcode = '22023';
  end if;
  if p_program is not null and not exists (
    select 1 from public.program pg where pg.id = p_program and pg.organization_id = v_budget.organization_id) then
    raise exception 'The program is not in this organization' using errcode = '22023';
  end if;
  if p_project is not null and not exists (
    select 1 from public.project pj where pj.id = p_project and pj.organization_id = v_budget.organization_id
      and (p_program is null or pj.program_id is not distinct from p_program)) then
    raise exception 'The project is not in this organization or program' using errcode = '22023';
  end if;
  if p_month_cents is null or cardinality(p_month_cents) <> 12 or array_position(p_month_cents, null) is not null then
    raise exception 'Give an amount for each of the twelve months' using errcode = '22023';
  end if;
  if not (0 <= all (p_month_cents)) then
    raise exception 'Budget amounts cannot be negative' using errcode = '22023';
  end if;
  select sum(x)::bigint into v_annual from unnest(p_month_cents) x;

  if v_line is null then
    insert into public.budget_line (organization_id, budget_id, account_id, fund_id, program_id, project_id,
      month_cents, annual_cents, note)
    values (v_budget.organization_id, p_budget, p_account, p_fund, p_program, p_project,
      p_month_cents, v_annual, nullif(btrim(p_note), ''))
    returning id into v_line;
  else
    update public.budget_line set account_id = p_account, fund_id = p_fund, program_id = p_program,
      project_id = p_project, month_cents = p_month_cents, annual_cents = v_annual,
      note = nullif(btrim(p_note), '')
    where id = v_line and budget_id = p_budget;
    if not found then
      raise exception 'Budget line not found' using errcode = 'P0002';
    end if;
  end if;
  perform app.record_material_audit(v_budget.organization_id, 'budget', 'line_saved', 'budget', p_budget,
    jsonb_build_object('line_id', v_line, 'account_id', p_account, 'annual_cents', v_annual));
  return v_line;
exception when unique_violation then
  raise exception 'This budget already has a line for that account, fund, program and project'
    using errcode = '23505';
end;
$$;
revoke all on function public.budget_save_line(uuid, uuid, uuid, uuid, uuid, uuid, bigint[], text) from public, anon;
grant execute on function public.budget_save_line(uuid, uuid, uuid, uuid, uuid, uuid, bigint[], text)
  to authenticated, service_role;

create or replace function public.budget_delete_line(p_line uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.budget_line;
begin
  select * into v_line from public.budget_line where id = p_line;
  if not found or not app.is_org_admin(v_line.organization_id) then
    raise exception 'Only an administrator with MFA manages budgets' using errcode = '42501';
  end if;
  -- The line trigger refuses a line of an approved budget.
  delete from public.budget_line where id = p_line;
  perform app.record_material_audit(v_line.organization_id, 'budget', 'line_deleted', 'budget', v_line.budget_id,
    jsonb_build_object('line_id', p_line, 'account_id', v_line.account_id, 'annual_cents', v_line.annual_cents));
end;
$$;
revoke all on function public.budget_delete_line(uuid) from public, anon;
grant execute on function public.budget_delete_line(uuid) to authenticated, service_role;

-- Approves a draft. The version it replaces, if any, is superseded.
create or replace function public.budget_approve(p_budget uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget public.budget;
  v_previous uuid;
begin
  select * into v_budget from public.budget where id = p_budget for update;
  if not found or not app.is_org_admin(v_budget.organization_id) then
    raise exception 'Only an administrator with MFA manages budgets' using errcode = '42501';
  end if;
  if v_budget.status <> 'draft' then
    raise exception 'Only a draft budget can be approved' using errcode = '22023';
  end if;
  if not exists (select 1 from public.budget_line l where l.budget_id = p_budget) then
    raise exception 'Add at least one line before approving the budget' using errcode = '22023';
  end if;
  update public.budget set status = 'superseded', superseded_at = now()
  where organization_id = v_budget.organization_id and fiscal_year_start = v_budget.fiscal_year_start
    and status = 'approved'
  returning id into v_previous;
  update public.budget set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_budget;
  perform app.record_material_audit(v_budget.organization_id, 'budget', 'budget_approved', 'budget', p_budget,
    jsonb_build_object('fiscal_year_start', v_budget.fiscal_year_start, 'version', v_budget.version,
      'supersedes', v_previous));
end;
$$;
revoke all on function public.budget_approve(uuid) from public, anon;
grant execute on function public.budget_approve(uuid) to authenticated, service_role;

-- Opens a new draft version copied from the approved one.
create or replace function public.budget_revise(p_budget uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget public.budget;
  v_new uuid;
  v_version integer;
begin
  select * into v_budget from public.budget where id = p_budget for update;
  if not found or not app.is_org_admin(v_budget.organization_id) then
    raise exception 'Only an administrator with MFA manages budgets' using errcode = '42501';
  end if;
  if v_budget.status <> 'approved' then
    raise exception 'Only the approved budget can be revised' using errcode = '22023';
  end if;
  if exists (select 1 from public.budget b where b.organization_id = v_budget.organization_id
             and b.fiscal_year_start = v_budget.fiscal_year_start and b.status = 'draft') then
    raise exception 'A revision of this budget is already in progress' using errcode = '23505';
  end if;
  select max(version) + 1 into v_version from public.budget
  where organization_id = v_budget.organization_id and fiscal_year_start = v_budget.fiscal_year_start;

  insert into public.budget (organization_id, fiscal_year_start, version, name, notes, created_by)
  values (v_budget.organization_id, v_budget.fiscal_year_start, v_version, v_budget.name, v_budget.notes, auth.uid())
  returning id into v_new;
  insert into public.budget_line (organization_id, budget_id, account_id, fund_id, program_id, project_id,
    month_cents, annual_cents, note)
  select organization_id, v_new, account_id, fund_id, program_id, project_id, month_cents, annual_cents, note
  from public.budget_line where budget_id = p_budget;
  perform app.record_material_audit(v_budget.organization_id, 'budget', 'budget_revision_started', 'budget', v_new,
    jsonb_build_object('from_budget', p_budget, 'version', v_version));
  return v_new;
end;
$$;
revoke all on function public.budget_revise(uuid) from public, anon;
grant execute on function public.budget_revise(uuid) to authenticated, service_role;

create or replace function public.budget_delete_draft(p_budget uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget public.budget;
begin
  select * into v_budget from public.budget where id = p_budget for update;
  if not found or not app.is_org_admin(v_budget.organization_id) then
    raise exception 'Only an administrator with MFA manages budgets' using errcode = '42501';
  end if;
  -- The budget trigger refuses an approved or superseded version.
  delete from public.budget where id = p_budget;
  perform app.record_material_audit(v_budget.organization_id, 'budget', 'draft_deleted', 'organization',
    v_budget.organization_id,
    jsonb_build_object('budget_id', p_budget, 'fiscal_year_start', v_budget.fiscal_year_start,
      'version', v_budget.version));
end;
$$;
revoke all on function public.budget_delete_draft(uuid) from public, anon;
grant execute on function public.budget_delete_draft(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Budget against actual
-- ---------------------------------------------------------------------------

-- Per account: the budget and the posted actuals for one month of the budget's
-- fiscal year and for the year to the end of that month. Amounts are in the
-- account's natural direction (revenue credits less debits, expense debits
-- less credits). The filters apply to budget lines and journal lines alike:
-- a program filter keeps only lines carrying that program. No caller check:
-- only the functions below call it.
create or replace function app.budget_rows(
  p_budget uuid, p_month date, p_program uuid, p_project uuid, p_fund uuid
)
returns table (
  account_id uuid,
  code text,
  name text,
  account_type text,
  annual_budget_cents bigint,
  month_budget_cents bigint,
  ytd_budget_cents bigint,
  month_actual_cents bigint,
  ytd_actual_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_budget public.budget;
  v_month date := date_trunc('month', p_month)::date;
  v_index integer;
begin
  select * into v_budget from public.budget where id = p_budget;
  if not found then
    return;
  end if;
  v_index := ((extract(year from v_month) - extract(year from v_budget.fiscal_year_start)) * 12
    + extract(month from v_month) - extract(month from v_budget.fiscal_year_start))::integer + 1;
  if v_index not between 1 and 12 then
    raise exception 'Choose a month inside the budget''s fiscal year' using errcode = '22023';
  end if;

  return query
  with planned as (
    select l.account_id,
      sum(l.annual_cents)::bigint as annual,
      sum(l.month_cents[v_index])::bigint as month_amount,
      sum((select sum(x) from unnest(l.month_cents[1:v_index]) x))::bigint as ytd
    from public.budget_line l
    where l.budget_id = p_budget
      and (p_program is null or l.program_id = p_program)
      and (p_project is null or l.project_id = p_project)
      and (p_fund is null or l.fund_id = p_fund)
    group by l.account_id
  ),
  actual as (
    select jl.account_id,
      coalesce(sum(case when a.account_type = 'revenue' then jl.credit_cents - jl.debit_cents
                        else jl.debit_cents - jl.credit_cents end)
        filter (where e.entry_date >= v_month), 0)::bigint as month_amount,
      sum(case when a.account_type = 'revenue' then jl.credit_cents - jl.debit_cents
               else jl.debit_cents - jl.credit_cents end)::bigint as ytd
    from public.journal_line jl
    join public.journal_entry e on e.id = jl.entry_id
    join public.ledger_account a on a.id = jl.account_id
    where jl.organization_id = v_budget.organization_id
      and e.status = 'posted'
      and e.entry_date >= v_budget.fiscal_year_start
      and e.entry_date < (v_month + interval '1 month')::date
      and a.account_type in ('revenue', 'expense')
      and (p_program is null or jl.program_id = p_program)
      and (p_project is null or jl.project_id = p_project)
      and (p_fund is null or jl.fund_id = p_fund)
    group by jl.account_id
  )
  select a.id, a.code, a.name, a.account_type,
    coalesce(p.annual, 0)::bigint, coalesce(p.month_amount, 0)::bigint, coalesce(p.ytd, 0)::bigint,
    coalesce(x.month_amount, 0)::bigint, coalesce(x.ytd, 0)::bigint
  from public.ledger_account a
  left join planned p on p.account_id = a.id
  left join actual x on x.account_id = a.id
  where a.organization_id = v_budget.organization_id
    and (p.account_id is not null or x.account_id is not null)
  order by case a.account_type when 'revenue' then 0 else 1 end, a.code;
end;
$$;
revoke all on function app.budget_rows(uuid, date, uuid, uuid, uuid) from public, anon, authenticated;

-- The full report, for those who read the ledger.
create or replace function public.budget_vs_actual(
  p_budget uuid, p_month date, p_program uuid default null, p_project uuid default null, p_fund uuid default null
)
returns table (
  account_id uuid,
  code text,
  name text,
  account_type text,
  annual_budget_cents bigint,
  month_budget_cents bigint,
  ytd_budget_cents bigint,
  month_actual_cents bigint,
  ytd_actual_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization uuid;
begin
  select b.organization_id into v_organization from public.budget b where b.id = p_budget;
  if v_organization is null or not app.can_read_ledger(v_organization) then
    raise exception 'You do not have access to budgets' using errcode = '42501';
  end if;
  return query select * from app.budget_rows(p_budget, p_month, p_program, p_project, p_fund);
end;
$$;
revoke all on function public.budget_vs_actual(uuid, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.budget_vs_actual(uuid, date, uuid, uuid, uuid) to authenticated, service_role;

-- Programs whose budget the caller may follow: the ones they lead or manage.
create or replace function public.budget_managed_programs(p_organization uuid)
returns table (program_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name
  from public.program p
  where p.organization_id = p_organization
    and app.can_manage_program(p.id)
  order by p.name;
$$;
revoke all on function public.budget_managed_programs(uuid) from public, anon;
grant execute on function public.budget_managed_programs(uuid) to authenticated, service_role;

-- One program's spending against the approved budget of the fiscal year that
-- holds p_month: totals per account only, for the program's leads and
-- managers (and ledger readers). Empty when no approved budget covers the
-- month.
create or replace function public.budget_program_summary(p_program uuid, p_month date)
returns table (
  budget_id uuid,
  budget_name text,
  budget_version integer,
  fiscal_year_start date,
  account_id uuid,
  code text,
  name text,
  account_type text,
  annual_budget_cents bigint,
  month_budget_cents bigint,
  ytd_budget_cents bigint,
  month_actual_cents bigint,
  ytd_actual_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization uuid;
  v_budget public.budget;
begin
  select pg.organization_id into v_organization from public.program pg where pg.id = p_program;
  if v_organization is null
     or not (app.can_manage_program(p_program) or app.can_read_ledger(v_organization)) then
    raise exception 'You do not manage this program' using errcode = '42501';
  end if;
  if p_month is null then
    raise exception 'Choose a month' using errcode = '22023';
  end if;
  select * into v_budget from public.budget b
  where b.organization_id = v_organization and b.status = 'approved'
    and p_month >= b.fiscal_year_start
    and p_month < (b.fiscal_year_start + interval '12 months')::date;
  if not found then
    return;
  end if;
  return query
  select v_budget.id, v_budget.name, v_budget.version, v_budget.fiscal_year_start, r.*
  from app.budget_rows(v_budget.id, p_month, p_program, null, null) r;
end;
$$;
revoke all on function public.budget_program_summary(uuid, date) from public, anon;
grant execute on function public.budget_program_summary(uuid, date) to authenticated, service_role;
