-- The ledger read policies ask once per query, not once per row, which
-- organizations' books the caller may read, and the fund release page reads
-- every fund's available balance in one call (PERF-002, PERF-008).
--
-- 1. app.ledger_readable_org_ids() returns the organizations of the caller's
--    active memberships for which app.can_read_ledger is true. It does not
--    copy that rule: app.can_read_ledger stays the one place that says who
--    reads the books (admins with MFA, ledger readers with MFA, outside
--    accountants within their grant), and every branch of it needs an
--    active membership, so the memberships are the only candidates.
-- 2. The 27 read policies that called app.can_read_ledger(organization_id)
--    for every row now check organization_id against that set, evaluated
--    once per query. supabase/tests/ledger-rls-set-based.sql proves every
--    caller reads exactly the same rows as before.
-- 3. public.ledger_funds_available_cents(funds, as_of) is the one-fund
--    ledger_fund_available_cents for many funds at once, with the same
--    rule and the caller's own row security.

create or replace function app.ledger_readable_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_membership m
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and app.can_read_ledger(m.organization_id);
$$;
revoke all on function app.ledger_readable_org_ids() from public, anon;
grant execute on function app.ledger_readable_org_ids() to authenticated;

drop policy bank_account_read on public.bank_account;
create policy bank_account_read on public.bank_account for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy bank_import_read on public.bank_import;
create policy bank_import_read on public.bank_import for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy bank_match_read on public.bank_match;
create policy bank_match_read on public.bank_match for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy bank_reconciliation_read on public.bank_reconciliation;
create policy bank_reconciliation_read on public.bank_reconciliation for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy bank_transaction_read on public.bank_transaction;
create policy bank_transaction_read on public.bank_transaction for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy budget_read on public.budget;
create policy budget_read on public.budget for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy budget_line_read on public.budget_line;
create policy budget_line_read on public.budget_line for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy gift_read on public.gift;
create policy gift_read on public.gift for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy gift_ack_read on public.gift_acknowledgement;
create policy gift_ack_read on public.gift_acknowledgement for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy grant_award_read on public.grant_award;
create policy grant_award_read on public.grant_award for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy grant_report_read on public.grant_report;
create policy grant_report_read on public.grant_report for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy journal_entry_read on public.journal_entry;
create policy journal_entry_read on public.journal_entry for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy journal_line_read on public.journal_line;
create policy journal_line_read on public.journal_line for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy ledger_account_read on public.ledger_account;
create policy ledger_account_read on public.ledger_account for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy ledger_fund_read on public.ledger_fund;
create policy ledger_fund_read on public.ledger_fund for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy ledger_fund_program_read on public.ledger_fund_program;
create policy ledger_fund_program_read on public.ledger_fund_program for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy ledger_fund_release_read on public.ledger_fund_release;
create policy ledger_fund_release_read on public.ledger_fund_release for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy ledger_period_read on public.ledger_period;
create policy ledger_period_read on public.ledger_period for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy ledger_settings_read on public.ledger_settings;
create policy ledger_settings_read on public.ledger_settings for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy ledger_year_close_read on public.ledger_year_close;
create policy ledger_year_close_read on public.ledger_year_close for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy payroll_account_map_read on public.payroll_account_map;
create policy payroll_account_map_read on public.payroll_account_map for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy payroll_run_read on public.payroll_run;
create policy payroll_run_read on public.payroll_run for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy payroll_run_allocation_read on public.payroll_run_allocation;
create policy payroll_run_allocation_read on public.payroll_run_allocation for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy sales_tax_line_read on public.sales_tax_line;
create policy sales_tax_line_read on public.sales_tax_line for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy sales_tax_period_read on public.sales_tax_period;
create policy sales_tax_period_read on public.sales_tax_period for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy sales_tax_settings_read on public.sales_tax_settings;
create policy sales_tax_settings_read on public.sales_tax_settings for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));
drop policy zeffy_payment_read on public.zeffy_payment;
create policy zeffy_payment_read on public.zeffy_payment for select to authenticated
  using (organization_id in (select app.ledger_readable_org_ids()));

create or replace function public.ledger_funds_available_cents(p_funds uuid[], p_as_of date)
returns table (fund_id uuid, available_cents bigint)
language sql
stable
set search_path = ''
as $$
  with funds as (
    select f.id from public.ledger_fund f where f.id = any (p_funds)
  ),
  daily as (
    select l.fund_id, e.entry_date as d, sum(l.credit_cents - l.debit_cents) as amount
    from public.journal_line l
    join public.journal_entry e on e.id = l.entry_id
    join public.ledger_account a on a.id = l.account_id
    where l.fund_id in (select id from funds) and e.status = 'posted'
      and a.account_type in ('net_assets', 'revenue', 'expense')
    group by l.fund_id, e.entry_date
  ),
  running as (
    select fund_id, d, sum(amount) over (partition by fund_id order by d) as balance from daily
  )
  -- Per fund, as ledger_fund_available_cents: the balance on the date, but
  -- never more than the lowest balance after it (a later spend already uses
  -- it), and never below zero.
  select f.id, greatest(0, least(
    coalesce((select r.balance from running r where r.fund_id = f.id and r.d <= p_as_of order by r.d desc limit 1), 0),
    coalesce((select min(r.balance) from running r where r.fund_id = f.id and r.d > p_as_of), 9223372036854775807)
  ))::bigint
  from funds f;
$$;
revoke all on function public.ledger_funds_available_cents(uuid[], date) from public, anon;
grant execute on function public.ledger_funds_available_cents(uuid[], date) to authenticated, service_role;
