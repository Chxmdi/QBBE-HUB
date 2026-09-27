-- Year-end, returns support and the external accountant's read-only login
-- (#154 B7, epic #140). Builds on the general ledger (#148, migration
-- 20260927100000).
--
-- External accountant:
--   * the accountant is invited with the existing invitation flow as a Guest,
--     the most limited organization role: no CRM, no finance, no HR-type data
--     through the ordinary policies;
--   * an owner or admin who completed MFA then grants a time-limited,
--     revocable ledger grant (at most 366 days). While it is current, and only
--     in a session that completed MFA (aal2 and a verified TOTP factor), the
--     accountant reads the whole ledger, its reports, and the figures and
--     clean files of receipts. Nothing is writable: every ledger write still
--     requires app.is_org_admin;
--   * each accountant session that opens the books is recorded once in the
--     audit log, as is every grant, revocation and export.
--
-- Year-end:
--   * closing a fiscal year posts one closing entry (kind 'closing') that
--     moves every revenue and expense balance, fund by fund, into the fund's
--     net assets account (3000 unrestricted, 3100 internally restricted, 3200
--     externally restricted), then closes all periods of the year;
--   * a closed year can only be undone by reopening it, which posts an
--     explicit reopening entry (the reversal of the closing entry) and reopens
--     the periods. Neither a plain reversal of the closing entry nor reopening
--     one of the year's periods is accepted outside that function;
--   * both steps are for admins with MFA and are audited.
--
-- Reports: statement totals by account and fund, and a flat journal export,
-- both readable exactly when app.can_read_ledger holds.

-- ---------------------------------------------------------------------------
-- External accountant grants
-- ---------------------------------------------------------------------------
create table public.ledger_accountant_grant (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  note text check (note is null or char_length(note) <= 500),
  granted_by uuid references public.user_profile (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ledger_accountant_grant_window check (expires_at > starts_at)
);

-- At most one unrevoked grant per person; a new grant replaces the old one.
create unique index uq_ledger_accountant_grant_live
  on public.ledger_accountant_grant (organization_id, user_id) where revoked_at is null;

comment on table public.ledger_accountant_grant is
  'Time-limited, revocable read-only ledger access for the external accountant (#154). Written only through ledger_grant_accountant / ledger_revoke_accountant.';

alter table public.ledger_accountant_grant enable row level security;
-- Admins see every grant; the accountant sees their own, so the app can tell
-- them to complete MFA before the books open.
create policy ledger_accountant_grant_read on public.ledger_accountant_grant
for select to authenticated using (
  app.is_org_admin(organization_id)
  or (user_id = (select auth.uid()) and app.is_org_member(organization_id))
);
revoke all on public.ledger_accountant_grant from anon;
revoke insert, update, delete, truncate on public.ledger_accountant_grant from authenticated;
grant select on public.ledger_accountant_grant to authenticated;
grant all on public.ledger_accountant_grant to service_role;

-- A current grant, an active membership and a session that completed MFA.
create or replace function app.is_ledger_accountant(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    and exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.factor_type = 'totp' and f.status = 'verified'
    )
    and exists (
      select 1 from public.organization_membership m
      where m.organization_id = p_organization and m.user_id = auth.uid() and m.status = 'active'
    )
    and exists (
      select 1 from public.ledger_accountant_grant g
      where g.organization_id = p_organization and g.user_id = auth.uid()
        and g.revoked_at is null and g.starts_at <= now() and now() < g.expires_at
    );
$$;
revoke all on function app.is_ledger_accountant(uuid) from public, anon;
grant execute on function app.is_ledger_accountant(uuid) to authenticated, service_role;

-- Everything the ledger's read policies use now includes the accountant.
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
    )
    or app.is_ledger_accountant(p_organization);
$$;
revoke all on function app.can_read_ledger(uuid) from public, anon;
grant execute on function app.can_read_ledger(uuid) to authenticated, service_role;

create or replace function public.ledger_grant_accountant(
  p_organization uuid, p_user uuid, p_expires_on date, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone text;
  v_expires timestamptz;
  v_grant uuid;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA grants accountant access' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = p_organization and m.user_id = p_user
      and m.status = 'active' and m.role = 'guest'
  ) then
    raise exception 'Invite the accountant as a Guest first; only an active Guest can be given accountant access'
      using errcode = '23514';
  end if;
  select coalesce(o.timezone, 'America/Toronto') into v_zone
  from public.organization o where o.id = p_organization;
  if p_expires_on is null or p_expires_on < (now() at time zone v_zone)::date
     or p_expires_on > (now() at time zone v_zone)::date + 366 then
    raise exception 'Access ends on a date between today and one year from today' using errcode = '22023';
  end if;
  -- Access runs to the end of the chosen day in the organization's zone.
  v_expires := ((p_expires_on + 1)::timestamp) at time zone v_zone;

  update public.ledger_accountant_grant set revoked_at = now(), revoked_by = auth.uid()
  where organization_id = p_organization and user_id = p_user and revoked_at is null;

  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, note, granted_by)
  values (p_organization, p_user, v_expires, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_grant;

  perform app.record_material_audit(p_organization, 'ledger', 'accountant_granted',
    'user_profile', p_user, jsonb_build_object('grant_id', v_grant, 'expires_on', p_expires_on));
  return v_grant;
end;
$$;
revoke all on function public.ledger_grant_accountant(uuid, uuid, date, text) from public, anon;
grant execute on function public.ledger_grant_accountant(uuid, uuid, date, text) to authenticated, service_role;

create or replace function public.ledger_revoke_accountant(p_grant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.ledger_accountant_grant;
begin
  select * into v_grant from public.ledger_accountant_grant where id = p_grant for update;
  if not found or not app.is_org_admin(v_grant.organization_id) then
    raise exception 'Only an administrator with MFA revokes accountant access' using errcode = '42501';
  end if;
  if v_grant.revoked_at is not null then
    return;
  end if;
  update public.ledger_accountant_grant set revoked_at = now(), revoked_by = auth.uid() where id = p_grant;
  perform app.record_material_audit(v_grant.organization_id, 'ledger', 'accountant_revoked',
    'user_profile', v_grant.user_id, jsonb_build_object('grant_id', p_grant));
end;
$$;
revoke all on function public.ledger_revoke_accountant(uuid) from public, anon;
grant execute on function public.ledger_revoke_accountant(uuid) to authenticated, service_role;

-- One audit record per accountant session that opens the books. The session
-- is the auth session id in the token, so a new sign-in is a new record.
create table public.ledger_accountant_session (
  organization_id uuid not null references public.organization (id) on delete cascade,
  session_id text not null check (char_length(session_id) between 1 and 100),
  user_id uuid not null references public.user_profile (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key (organization_id, session_id)
);
alter table public.ledger_accountant_session enable row level security;
create policy ledger_accountant_session_read on public.ledger_accountant_session
for select to authenticated using (app.is_org_admin(organization_id));
revoke all on public.ledger_accountant_session from anon;
revoke insert, update, delete, truncate on public.ledger_accountant_session from authenticated;
grant select on public.ledger_accountant_session to authenticated;
grant all on public.ledger_accountant_session to service_role;

create or replace function public.ledger_note_accountant_session(p_organization uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session text := coalesce(auth.jwt()->>'session_id', '');
  v_rows integer;
begin
  if not app.is_ledger_accountant(p_organization) or v_session = '' then
    return false;
  end if;
  insert into public.ledger_accountant_session (organization_id, session_id, user_id)
  values (p_organization, left(v_session, 100), auth.uid())
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform app.record_material_audit(p_organization, 'ledger', 'accountant_signed_in',
      'user_profile', auth.uid(), jsonb_build_object('aal', auth.jwt()->>'aal'));
  end if;
  return true;
end;
$$;
revoke all on function public.ledger_note_accountant_session(uuid) from public, anon;
grant execute on function public.ledger_note_accountant_session(uuid) to authenticated, service_role;

-- Receipts: the accountant reads every receipt's figures, and downloads a
-- file only once it has been scanned clean.
create policy finance_receipt_accountant_read on public.finance_receipt
for select to authenticated using (app.is_ledger_accountant(organization_id));

create policy "receipts accountant read clean" on storage.objects
for select to authenticated using (
  bucket_id = 'receipts' and exists (
    select 1 from public.finance_receipt r
    where r.storage_path = storage.objects.name
      and r.scan_status = 'clean'
      and app.is_ledger_accountant(r.organization_id)
  )
);

-- ---------------------------------------------------------------------------
-- Closing entries
-- ---------------------------------------------------------------------------
alter table public.journal_entry drop constraint journal_entry_kind_check;
alter table public.journal_entry add constraint journal_entry_kind_check
  check (kind in ('standard', 'opening', 'reversal', 'closing'));

-- Same rules as #148, except that a closing entry, like a reversal, may carry
-- inactive accounts and funds and restricted-fund expense lines outside the
-- fund's dates: it only moves balances that already passed those checks.
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
  where l.entry_id = e.id and not a.is_active and e.kind not in ('reversal', 'closing')
  limit 1;
  if found then
    raise exception 'Line %: account % is inactive', v_bad.line_no, v_bad.code using errcode = '23514';
  end if;

  select l.line_no, f.code into v_bad from public.journal_line l
  join public.ledger_fund f on f.id = l.fund_id
  where l.entry_id = e.id and not f.is_active and e.kind not in ('reversal', 'closing')
  limit 1;
  if found then
    raise exception 'Line %: fund % is inactive', v_bad.line_no, v_bad.code using errcode = '23514';
  end if;

  if e.kind not in ('reversal', 'closing') then
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

-- A closing entry is created only by ledger_close_fiscal_year, and undone only
-- by ledger_reopen_fiscal_year. Those functions announce themselves with a
-- transaction-local setting that no API caller can set.
create or replace function app.guard_year_end_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step text := coalesce(current_setting('app.ledger_year_end', true), '');
begin
  if new.kind = 'closing' and (tg_op = 'INSERT' or old.kind is distinct from 'closing')
     and v_step <> 'close' then
    raise exception 'Closing entries are made by closing the fiscal year' using errcode = '42501';
  end if;
  if new.reverses_entry_id is not null
     and (tg_op = 'INSERT' or old.reverses_entry_id is distinct from new.reverses_entry_id)
     and exists (select 1 from public.journal_entry c where c.id = new.reverses_entry_id and c.kind = 'closing')
     and v_step <> 'reopen' then
    raise exception 'A closing entry is undone only by reopening the fiscal year' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_year_end_entry() from public, anon, authenticated;
create trigger journal_entry_year_end_guard before insert or update on public.journal_entry
for each row execute function app.guard_year_end_entry();

-- ---------------------------------------------------------------------------
-- Fiscal year closes
-- ---------------------------------------------------------------------------
create table public.ledger_year_close (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  closing_entry_id uuid references public.journal_entry (id),
  closed_by uuid references public.user_profile (id) on delete set null,
  closed_at timestamptz not null default now(),
  reopening_entry_id uuid references public.journal_entry (id),
  reopened_by uuid references public.user_profile (id) on delete set null,
  reopened_at timestamptz,
  reopen_reason text check (reopen_reason is null or char_length(btrim(reopen_reason)) between 1 and 500),
  constraint ledger_year_close_dates check (starts_on <= ends_on),
  constraint ledger_year_close_reopen_recorded check ((reopened_at is null) = (reopen_reason is null))
);
create unique index uq_ledger_year_close_live
  on public.ledger_year_close (organization_id, starts_on) where reopened_at is null;

comment on table public.ledger_year_close is
  'Each close and reopening of a fiscal year (#154). History is kept: a reopened close stays with its reason.';

alter table public.ledger_year_close enable row level security;
create policy ledger_year_close_read on public.ledger_year_close
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.ledger_year_close from anon;
revoke insert, update, delete, truncate on public.ledger_year_close from authenticated;
grant select on public.ledger_year_close to authenticated;
grant all on public.ledger_year_close to service_role;

-- A period of a closed fiscal year reopens only with the year.
create or replace function app.guard_closed_year_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'closed' and new.status = 'open'
     and coalesce(current_setting('app.ledger_year_end', true), '') <> 'reopen'
     and exists (
       select 1 from public.ledger_year_close c
       where c.organization_id = old.organization_id and c.reopened_at is null
         and old.starts_on between c.starts_on and c.ends_on
     ) then
    raise exception 'Period % belongs to a closed fiscal year; reopen the year instead', old.name
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_closed_year_period() from public, anon, authenticated;
create trigger ledger_period_year_guard before update on public.ledger_period
for each row execute function app.guard_closed_year_period();

-- The fiscal year starting on p_starts_on is the twelve months that follow.
-- Its periods must cover it exactly.
create or replace function app.ledger_fiscal_year_bounds(p_organization uuid, p_starts_on date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_end date;
  v_days integer;
begin
  if p_starts_on is null or extract(day from p_starts_on) <> 1 then
    raise exception 'A fiscal year starts on the first day of a month' using errcode = '22023';
  end if;
  v_end := (p_starts_on + interval '1 year' - interval '1 day')::date;
  if exists (select 1 from public.ledger_period p
             where p.organization_id = p_organization
               and ((p.starts_on < p_starts_on and p.ends_on >= p_starts_on)
                 or (p.starts_on <= v_end and p.ends_on > v_end))) then
    raise exception 'A period straddles the start or end of this fiscal year' using errcode = '23514';
  end if;
  select coalesce(sum(p.ends_on - p.starts_on + 1), 0) into v_days
  from public.ledger_period p
  where p.organization_id = p_organization and p.starts_on >= p_starts_on and p.ends_on <= v_end;
  if v_days <> (v_end - p_starts_on + 1) then
    raise exception 'The periods of this fiscal year do not cover it; create the missing months first'
      using errcode = '23514';
  end if;
  return v_end;
end;
$$;
revoke all on function app.ledger_fiscal_year_bounds(uuid, date) from public, anon, authenticated;

create or replace function public.ledger_close_fiscal_year(p_organization uuid, p_starts_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end date;
  v_entry uuid;
  v_number integer;
  v_close uuid;
  v_lines integer;
  v_missing text;
  v_label text;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA closes the year' using errcode = '42501';
  end if;
  -- Serializes closes and posting for this organization.
  perform 1 from public.ledger_settings where organization_id = p_organization for update;
  v_end := app.ledger_fiscal_year_bounds(p_organization, p_starts_on);
  v_label := p_starts_on || ' to ' || v_end;

  if exists (select 1 from public.ledger_year_close c
             where c.organization_id = p_organization and c.starts_on = p_starts_on and c.reopened_at is null) then
    raise exception 'The fiscal year % is already closed', v_label using errcode = '23505';
  end if;
  if exists (select 1 from public.ledger_period p
             where p.organization_id = p_organization and p.ends_on < p_starts_on and p.status = 'open') then
    raise exception 'Close the earlier periods first' using errcode = '23514';
  end if;
  if exists (select 1 from public.journal_entry e
             where e.organization_id = p_organization and e.status = 'draft'
               and e.entry_date <= v_end) then
    raise exception 'Post or delete the drafts dated up to % before closing the year', v_end using errcode = '23514';
  end if;
  if exists (select 1 from public.ledger_period p
             where p.organization_id = p_organization and p.status = 'closed'
               and p.starts_on <= v_end and p.ends_on >= v_end) then
    raise exception 'The last period of the year is closed; reopen it so the closing entry can be dated %', v_end
      using errcode = '23514';
  end if;

  -- Revenue and expense balances up to the year end, per fund and account.
  create temporary table if not exists pg_temp.ledger_close_balance (
    fund_id uuid, restriction text, account_id uuid, balance bigint
  ) on commit drop;
  truncate pg_temp.ledger_close_balance;
  insert into pg_temp.ledger_close_balance
  select l.fund_id, f.restriction, l.account_id, sum(l.debit_cents - l.credit_cents)::bigint
  from public.journal_line l
  join public.journal_entry e on e.id = l.entry_id
  join public.ledger_account a on a.id = l.account_id
  join public.ledger_fund f on f.id = l.fund_id
  where l.organization_id = p_organization and e.status = 'posted' and e.entry_date <= v_end
    and a.account_type in ('revenue', 'expense')
  group by l.fund_id, f.restriction, l.account_id
  having sum(l.debit_cents - l.credit_cents) <> 0;

  if exists (select 1 from pg_temp.ledger_close_balance) then
    select string_agg(distinct x.code, ', ') into v_missing
    from (select distinct b.restriction,
            case b.restriction when 'unrestricted' then '3000'
                               when 'internally_restricted' then '3100' else '3200' end as code
          from pg_temp.ledger_close_balance b) x
    where not exists (select 1 from public.ledger_account a
                      where a.organization_id = p_organization and a.code = x.code
                        and a.account_type = 'net_assets');
    if v_missing is not null then
      raise exception 'Net assets account % is missing; add it to the chart of accounts', v_missing
        using errcode = '23514';
    end if;

    select count(*) + count(distinct fund_id) into v_lines from pg_temp.ledger_close_balance;
    if v_lines > 500 then
      raise exception 'The closing entry would need % lines; the limit is 500', v_lines using errcode = '23514';
    end if;

    perform set_config('app.ledger_year_end', 'close', true);
    insert into public.journal_entry (organization_id, entry_date, memo, kind, created_by)
    values (p_organization, v_end, 'Year-end closing entry, fiscal year ' || v_label, 'closing', auth.uid())
    returning id into v_entry;

    insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id,
      description, debit_cents, credit_cents)
    select p_organization, v_entry, (row_number() over (order by x.fund_code, x.sort, x.code))::integer,
      x.account_id, x.fund_id, x.description,
      greatest(-x.balance, 0), greatest(x.balance, 0)
    from (
      select b.fund_id, f.code as fund_code, 0 as sort, a.code, b.account_id, b.balance,
        'Close ' || a.code || ' ' || a.name as description
      from pg_temp.ledger_close_balance b
      join public.ledger_account a on a.id = b.account_id
      join public.ledger_fund f on f.id = b.fund_id
      union all
      select b.fund_id, f.code, 1, na.code, na.id, -sum(b.balance)::bigint,
        'Excess of revenue over expenses to net assets'
      from pg_temp.ledger_close_balance b
      join public.ledger_fund f on f.id = b.fund_id
      join public.ledger_account na on na.organization_id = p_organization and na.account_type = 'net_assets'
        and na.code = case b.restriction when 'unrestricted' then '3000'
                                         when 'internally_restricted' then '3100' else '3200' end
      group by b.fund_id, f.code, na.code, na.id
      having sum(b.balance) <> 0
    ) x;

    v_number := app.ledger_post(v_entry);
    perform set_config('app.ledger_year_end', '', true);
  end if;

  update public.ledger_period set status = 'closed', closed_by = auth.uid(), closed_at = now()
  where organization_id = p_organization and status = 'open'
    and starts_on >= p_starts_on and ends_on <= v_end;

  insert into public.ledger_year_close (organization_id, starts_on, ends_on, closing_entry_id, closed_by)
  values (p_organization, p_starts_on, v_end, v_entry, auth.uid())
  returning id into v_close;

  perform app.record_material_audit(p_organization, 'ledger', 'fiscal_year_closed',
    'ledger_year_close', v_close, jsonb_build_object('starts_on', p_starts_on, 'ends_on', v_end,
      'closing_entry_id', v_entry, 'closing_entry_number', v_number));
  return v_close;
end;
$$;
revoke all on function public.ledger_close_fiscal_year(uuid, date) from public, anon;
grant execute on function public.ledger_close_fiscal_year(uuid, date) to authenticated, service_role;

create or replace function public.ledger_reopen_fiscal_year(p_organization uuid, p_starts_on date, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_close public.ledger_year_close;
  v_entry uuid;
  v_number integer;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA reopens the year' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' or char_length(btrim(p_reason)) > 500 then
    raise exception 'Give the reason for reopening the year (up to 500 characters)' using errcode = '22023';
  end if;
  perform 1 from public.ledger_settings where organization_id = p_organization for update;
  select * into v_close from public.ledger_year_close c
  where c.organization_id = p_organization and c.starts_on = p_starts_on and c.reopened_at is null
  for update;
  if not found then
    raise exception 'This fiscal year is not closed' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.ledger_year_close c
             where c.organization_id = p_organization and c.reopened_at is null and c.starts_on > p_starts_on) then
    raise exception 'Reopen the later fiscal year first' using errcode = '23514';
  end if;

  perform set_config('app.ledger_year_end', 'reopen', true);
  update public.ledger_period set status = 'open', closed_by = null, closed_at = null
  where organization_id = p_organization and status = 'closed'
    and starts_on >= v_close.starts_on and ends_on <= v_close.ends_on;

  if v_close.closing_entry_id is not null then
    insert into public.journal_entry (organization_id, entry_date, memo, kind, reverses_entry_id, created_by)
    values (p_organization, v_close.ends_on,
            left('Reopening entry, fiscal year ' || v_close.starts_on || ' to ' || v_close.ends_on
                 || ': ' || btrim(p_reason), 500),
            'reversal', v_close.closing_entry_id, auth.uid())
    returning id into v_entry;
    insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id,
      program_id, project_id, description, debit_cents, credit_cents)
    select organization_id, v_entry, line_no, account_id, fund_id, program_id, project_id,
      description, credit_cents, debit_cents
    from public.journal_line where entry_id = v_close.closing_entry_id;
    v_number := app.ledger_post(v_entry);
  end if;
  perform set_config('app.ledger_year_end', '', true);

  update public.ledger_year_close set reopened_at = now(), reopened_by = auth.uid(),
    reopen_reason = btrim(p_reason), reopening_entry_id = v_entry
  where id = v_close.id;

  perform app.record_material_audit(p_organization, 'ledger', 'fiscal_year_reopened',
    'ledger_year_close', v_close.id, jsonb_build_object('starts_on', v_close.starts_on,
      'ends_on', v_close.ends_on, 'reopening_entry_id', v_entry, 'reopening_entry_number', v_number,
      'reason', btrim(p_reason)));
  return v_entry;
end;
$$;
revoke all on function public.ledger_reopen_fiscal_year(uuid, date, text) from public, anon;
grant execute on function public.ledger_reopen_fiscal_year(uuid, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- Per account and fund: the balance brought forward before p_from, the
-- movement between p_from and p_to without closing entries (and their
-- reopening reversals), the closing movement on its own, and the balance at
-- p_to. Balances are debits minus credits. Security invoker: row-level
-- security decides what is summed.
create or replace function public.ledger_statement_totals(p_organization uuid, p_from date, p_to date)
returns table (
  account_id uuid,
  code text,
  name text,
  account_type text,
  fund_id uuid,
  fund_code text,
  fund_name text,
  restriction text,
  opening_cents bigint,
  movement_cents bigint,
  closing_movement_cents bigint,
  balance_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    select l.account_id, l.fund_id, e.entry_date, l.debit_cents - l.credit_cents as amount,
      (e.kind = 'closing' or exists (
        select 1 from public.journal_entry c where c.id = e.reverses_entry_id and c.kind = 'closing'
      )) as is_closing
    from public.journal_line l
    join public.journal_entry e on e.id = l.entry_id
    where l.organization_id = p_organization and e.status = 'posted' and e.entry_date <= p_to
  )
  select a.id, a.code, a.name, a.account_type, f.id, f.code, f.name, f.restriction,
    coalesce(sum(x.amount) filter (where x.entry_date < p_from), 0)::bigint,
    coalesce(sum(x.amount) filter (where x.entry_date >= p_from and not x.is_closing), 0)::bigint,
    coalesce(sum(x.amount) filter (where x.entry_date >= p_from and x.is_closing), 0)::bigint,
    coalesce(sum(x.amount), 0)::bigint
  from lines x
  join public.ledger_account a on a.id = x.account_id
  join public.ledger_fund f on f.id = x.fund_id
  group by a.id, a.code, a.name, a.account_type, f.id, f.code, f.name, f.restriction
  order by a.code, f.code;
$$;
revoke all on function public.ledger_statement_totals(uuid, date, date) from public, anon;
grant execute on function public.ledger_statement_totals(uuid, date, date) to authenticated, service_role;

-- Every posted line between two dates, flat, for the accountant's software.
-- Security definer so program and project names come through for readers who
-- cannot otherwise see programs (the accountant); the caller is checked.
create or replace function public.ledger_export_lines(p_organization uuid, p_from date, p_to date)
returns table (
  entry_date date,
  entry_number integer,
  entry_kind text,
  line_no integer,
  account_code text,
  account_name text,
  account_type text,
  fund_code text,
  fund_name text,
  program_name text,
  project_name text,
  memo text,
  description text,
  debit_cents bigint,
  credit_cents bigint,
  entry_id uuid,
  source_type text,
  source_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.can_read_ledger(p_organization) then
    raise exception 'You do not have access to the ledger' using errcode = '42501';
  end if;
  return query
  select e.entry_date, e.entry_number, e.kind, l.line_no, a.code, a.name, a.account_type,
    f.code, f.name, pg.name, pj.name, e.memo, coalesce(l.description, e.memo),
    l.debit_cents, l.credit_cents, e.id, e.source_type, e.source_id
  from public.journal_line l
  join public.journal_entry e on e.id = l.entry_id
  join public.ledger_account a on a.id = l.account_id
  join public.ledger_fund f on f.id = l.fund_id
  left join public.program pg on pg.id = l.program_id
  left join public.project pj on pj.id = l.project_id
  where l.organization_id = p_organization and e.status = 'posted'
    and e.entry_date between p_from and p_to
  order by e.entry_date, e.entry_number, l.line_no;
end;
$$;
revoke all on function public.ledger_export_lines(uuid, date, date) from public, anon;
grant execute on function public.ledger_export_lines(uuid, date, date) to authenticated, service_role;

-- The recorded history of one entry (saved, posted, reversed, closing), with
-- who did each step. Ledger readers, the accountant included, cannot read the
-- audit log itself, so this returns only the ledger events about this entry.
create or replace function public.ledger_entry_trail(p_entry uuid)
returns table (occurred_at timestamptz, action text, actor_name text, metadata jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select e.organization_id into v_org from public.journal_entry e where e.id = p_entry;
  if v_org is null or not app.can_read_ledger(v_org) then
    raise exception 'You do not have access to the ledger' using errcode = '42501';
  end if;
  return query
  select ev.created_at, ev.action, coalesce(p.full_name, 'System'), ev.metadata
  from public.audit_event ev
  left join public.user_profile p on p.id = ev.actor_id
  where ev.organization_id = v_org and ev.event_type = 'ledger'
    and (
      (ev.object_type = 'journal_entry' and ev.object_id = p_entry)
      or (ev.action = 'entry_reversed' and ev.metadata->>'reversal_id' = p_entry::text)
      or (ev.action = 'fiscal_year_closed' and ev.metadata->>'closing_entry_id' = p_entry::text)
      or (ev.action = 'fiscal_year_reopened' and ev.metadata->>'reopening_entry_id' = p_entry::text)
    )
  order by ev.created_at, ev.id;
end;
$$;
revoke all on function public.ledger_entry_trail(uuid) from public, anon;
grant execute on function public.ledger_entry_trail(uuid) to authenticated, service_role;
