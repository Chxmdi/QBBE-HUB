-- Ledger integrity: entries that came from a document are undone only from
-- that document; closing a fiscal year commits; budget-versus-actual leaves
-- out the closing entry.
--
-- 1. ledger_reverse_entry reversed any posted entry, including one posted by
--    a gift, bill, invoice, payment, pay run or GST/QST return. The document
--    then still looked live (a gift still recorded, a bill still owing, a tax
--    period still closed), and its own void or reversal was refused because
--    the entry was already reversed, so the two could never be brought back
--    in step. A reversal of such an entry now commits only when the document
--    records that reversal as its own undo, which is what gift_void,
--    finance_void_document, finance_reverse_payment, payroll_reverse_run and
--    sales_tax_reopen_period do. The check runs at commit because those
--    functions mark the document after reversing. Entries from bank matches
--    and fund releases are left as they were (reversible in the ledger).
--
-- 2. ledger_close_fiscal_year posted the closing entry and then closed the
--    year's periods in the same transaction. The ledger's deferred checks ran
--    at commit, found the closing entry in a closed period and rolled the
--    close back, so no year could ever be closed. The close now runs those
--    checks on its entry before closing the periods.
--
-- 3. app.budget_rows counted the closing entry as activity, so a closed
--    year's actuals read as zero (and the last month negative).

create or replace function app.guard_source_entry_reversal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.journal_entry;
  v_undone boolean;
  v_label text;
begin
  if not exists (select 1 from public.journal_entry where id = new.id) then
    return null; -- removed before commit
  end if;
  select * into v_original from public.journal_entry where id = new.reverses_entry_id;
  if not found or v_original.source_type is null then
    return null;
  end if;

  v_undone := case v_original.source_type
    when 'gift' then exists (select 1 from public.gift g
      where g.id = v_original.source_id and g.void_entry_id = new.id)
    when 'finance_bill' then exists (select 1 from public.finance_bill b
      where b.id = v_original.source_id and b.void_entry_id = new.id)
    when 'finance_invoice' then exists (select 1 from public.finance_invoice i
      where i.id = v_original.source_id and i.void_entry_id = new.id)
    when 'finance_payment' then exists (select 1 from public.finance_payment p
      where p.id = v_original.source_id and p.reversal_entry_id = new.id)
    when 'payroll_run' then exists (select 1 from public.payroll_run r
      where r.id = v_original.source_id and r.reversal_entry_id = new.id)
    when 'sales_tax_period' then not exists (select 1 from public.sales_tax_period s
      where s.id = v_original.source_id and s.closing_entry_id = v_original.id)
    else true
  end;
  if v_undone then
    return null;
  end if;

  v_label := case v_original.source_type
    when 'gift' then 'void the gift'
    when 'finance_bill' then 'void the bill'
    when 'finance_invoice' then 'void the invoice'
    when 'finance_payment' then 'reverse the payment'
    when 'payroll_run' then 'reverse the pay run'
    else 'reopen the GST/QST return'
  end;
  raise exception 'Entry % came from another record; % instead, so both stay in step',
    v_original.entry_number, v_label
    using errcode = '42501', hint = 'ledger_source_reversal:' || v_original.source_type;
end;
$$;
revoke all on function app.guard_source_entry_reversal() from public, anon, authenticated;

create constraint trigger journal_entry_source_reversal_guard
after insert or update of reverses_entry_id on public.journal_entry
deferrable initially deferred
for each row when (new.reverses_entry_id is not null)
execute function app.guard_source_entry_reversal();

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

    -- The ledger checks every entry again at commit, and by then the periods
    -- below are closed, so the check refused the closing entry ("Period ...
    -- is closed") and the whole close rolled back. Run those checks now,
    -- while the last period is still open, then defer them again for the
    -- rest of the transaction. The closed-period rule itself is unchanged.
    set constraints public.journal_entry_rules, public.journal_line_rules immediate;
    set constraints public.journal_entry_rules, public.journal_line_rules deferred;
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
revoke all on function public.ledger_close_fiscal_year(uuid, date) from public, anon, authenticated;
grant execute on function public.ledger_close_fiscal_year(uuid, date) to authenticated, service_role;

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
      -- The year-end closing entry (and a reopening's reversal of it) moves
      -- balances to net assets; it is not activity, as in the statements.
      and e.kind <> 'closing'
      and not exists (select 1 from public.journal_entry c
                      where c.id = e.reverses_entry_id and c.kind = 'closing')
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
