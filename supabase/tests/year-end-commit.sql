-- Closing a fiscal year commits, and budget-versus-actual leaves the closing
-- entry out (migration 20261118100000). Proves: the close passes the ledger's
-- checks that run at commit (they used to refuse the closing entry because
-- its period was closed by then); a closed year's budget report still shows
-- the year's revenue, with nothing in the last month from the close; after
-- reopening, the reopening entry is left out too. All mutations are rolled
-- back.
begin;

create function tests.yec_flush()
returns text
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    set constraints all immediate;
  exception when others then
    v_error := sqlerrm;
  end;
  set constraints all deferred;
  return v_error;
end;
$$;
grant execute on function tests.yec_flush() to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_gen uuid;
  v_bank uuid;
  v_fees uuid;
  v_entry uuid;
  v_budget uuid;
  v_error text;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';
  select id into strict v_bank from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_fees from public.ledger_account where organization_id = v_org and code = '4400';

  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_record_chart_approval(v_org, date '2024-12-01', 'Accountant');
  perform public.ledger_create_fiscal_year(v_org, date '2025-01-01');
  perform public.ledger_create_fiscal_year(v_org, date '2026-01-01');
  v_entry := public.ledger_save_draft(v_org, null, date '2025-06-15', 'Fees', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'debit_cents', 10000),
    jsonb_build_object('account_id', v_fees, 'fund_id', v_gen, 'credit_cents', 10000)));
  perform public.ledger_post_entry(v_entry);
  -- As if that entry had been committed earlier: only the close is pending.
  perform tests.ok(tests.yec_flush() is null, 'the year''s activity is posted');
  v_budget := public.budget_create(v_org, date '2025-01-01', 'Budget 2025', null);
  perform public.budget_save_line(v_budget, null, v_fees, v_gen, null, null, array_fill(1000::bigint, array[12]), null);

  perform public.ledger_close_fiscal_year(v_org, date '2025-01-01');
  v_error := tests.yec_flush();
  perform tests.ok(v_error is null, format('closing a year with activity passes the commit-time checks (%s)', coalesce(v_error, 'ok')));
  perform tests.ok((select count(*) = 12 from public.ledger_period
    where organization_id = v_org and starts_on between date '2025-01-01' and date '2025-12-31' and status = 'closed'),
    'every period of the year is closed');
  perform tests.ok(exists (select 1 from public.journal_entry
    where organization_id = v_org and kind = 'closing' and status = 'posted' and entry_date = date '2025-12-31'),
    'the closing entry is posted on the last day');

  select * into r from public.budget_vs_actual(v_budget, date '2025-12-01') where account_id = v_fees;
  perform tests.ok(r.ytd_actual_cents = 10000, format('the year''s fees still show after the close (%s)', r.ytd_actual_cents));
  perform tests.ok(r.month_actual_cents = 0, format('December shows nothing from the closing entry (%s)', r.month_actual_cents));

  perform public.ledger_reopen_fiscal_year(v_org, date '2025-01-01', 'Auditor adjustment');
  v_error := tests.yec_flush();
  perform tests.ok(v_error is null, format('reopening the year passes the commit-time checks (%s)', coalesce(v_error, 'ok')));
  select * into r from public.budget_vs_actual(v_budget, date '2025-12-01') where account_id = v_fees;
  perform tests.ok(r.ytd_actual_cents = 10000 and r.month_actual_cents = 0,
    format('the reopening entry is left out as well (%s, %s)', r.ytd_actual_cents, r.month_actual_cents));
  perform tests.clear_auth(); reset role;
end;
$$;

rollback;
