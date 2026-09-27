-- Budgets against actuals (#153; migration 20260929100000). Proves that only
-- admins with MFA change budgets, that approval locks a version for every
-- role, that a revision is a new version and history is kept, that the
-- report's actuals equal the ledger's own totals for the same filters, and
-- that a program lead sees their own program's summary and nothing else.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

-- Runs a statement as the current role and asserts that it fails with a
-- message containing p_pattern.
create function tests.budget_raises(p_sql text, p_pattern text, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
    set constraints all immediate;
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  set constraints all deferred;
  perform tests.ok(v_error is not null and v_error ilike '%' || p_pattern || '%',
    format('%s (%s)', p_msg, coalesce(v_error, 'no error')));
end;
$$;
grant execute on function tests.budget_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_lead uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_other_org uuid;
  v_youth uuid;
  v_seniors uuid;
  v_seniors_project uuid;
  v_bank uuid;
  v_rent uuid;
  v_supplies uuid;
  v_donations uuid;
  v_net_assets uuid;
  v_other_rent uuid;
  v_gen uuid;
  v_grant_fund uuid;
  v_entry uuid;
  v_budget uuid;
  v_v2 uuid;
  v_line uuid;
  v_rent_line uuid;
  v_rows integer;
  v_sum bigint;
  v_ledger bigint;
  v_flag boolean;
  v_even bigint[] := array_fill(100000::bigint, array[12]); -- $1,000.00 a month
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  -- Fixtures, as the table owner. The QA "other staff" member leads the youth
  -- program.
  insert into public.program (organization_id, name, slug, created_by, lead_id)
  values (v_org, 'Budget youth program', 'budget-youth', v_owner, v_lead) returning id into v_youth;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Budget seniors program', 'budget-seniors', v_owner) returning id into v_seniors;
  insert into public.project (organization_id, program_id, name)
  values (v_org, v_seniors, 'Budget seniors outing')
  returning id into v_seniors_project;
  insert into public.organization (name, slug) values ('Budget other org', 'budget-other-org')
  returning id into v_other_org;

  select id into strict v_bank from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_rent from public.ledger_account where organization_id = v_org and code = '5200';
  select id into strict v_supplies from public.ledger_account where organization_id = v_org and code = '5400';
  select id into strict v_donations from public.ledger_account where organization_id = v_org and code = '4200';
  select id into strict v_net_assets from public.ledger_account where organization_id = v_org and code = '3000';
  select id into strict v_other_rent from public.ledger_account where organization_id = v_other_org and code = '5200';
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';

  -- Posted entries to compare against: FY 2026-10 to 2027-09.
  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2026-10-01');
  perform public.ledger_record_chart_approval(v_org, date '2026-09-20', 'Budget Accountant, CPA');
  insert into public.ledger_fund (organization_id, code, name, restriction)
  values (v_org, 'BUDGRANT', 'Budget test grant', 'externally_restricted') returning id into v_grant_fund;
  -- October: rent 800 for youth (general fund), supplies 150 for youth
  -- (grant fund), rent 200 without a program, a 500 donation to youth.
  v_entry := public.ledger_save_draft(v_org, null, date '2026-10-05', 'Budget test October', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'program_id', v_youth, 'debit_cents', 80000),
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 20000),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 100000),
      jsonb_build_object('account_id', v_supplies, 'fund_id', v_grant_fund, 'program_id', v_youth, 'debit_cents', 15000),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_grant_fund, 'credit_cents', 15000),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'debit_cents', 50000),
      jsonb_build_object('account_id', v_donations, 'fund_id', v_gen, 'program_id', v_youth, 'credit_cents', 50000)));
  perform public.ledger_post_entry(v_entry);
  -- November: rent 1,100 for youth, rent 300 for the seniors project.
  v_entry := public.ledger_save_draft(v_org, null, date '2026-11-10', 'Budget test November', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'program_id', v_youth, 'debit_cents', 110000),
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'program_id', v_seniors,
        'project_id', v_seniors_project, 'debit_cents', 30000),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 140000)));
  perform public.ledger_post_entry(v_entry);
  -- A draft in November never counts.
  perform public.ledger_save_draft(v_org, null, date '2026-11-12', 'Budget test draft', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'program_id', v_youth, 'debit_cents', 999900),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 999900)));
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Who can create and change budgets
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal1');
  perform tests.budget_raises(format(
    'select public.budget_create(%L, date ''2026-10-01'', ''FY'', null)', v_org),
    'administrator with MFA', 'an owner without MFA cannot create a budget');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_staff, 'aal1');
  perform tests.budget_raises(format(
    'select public.budget_create(%L, date ''2026-10-01'', ''FY'', null)', v_org),
    'administrator with MFA', 'staff cannot create a budget');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.budget_raises(format(
    'select public.budget_create(%L, date ''2026-10-01'', ''FY'', null)', v_org),
    'administrator with MFA', 'volunteers cannot create a budget');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform tests.budget_raises(format(
    'insert into public.budget (organization_id, fiscal_year_start, version, name) values (%L, date ''2026-10-01'', 1, ''x'')', v_org),
    'permission denied', 'an admin cannot insert budgets directly');
  perform tests.budget_raises(format(
    'select public.budget_create(%L, date ''2026-10-15'', ''FY'', null)', v_org),
    'first day of a month', 'a budget year starts on the first of a month');
  perform tests.budget_raises(format(
    'select public.budget_create(%L, date ''2026-10-01'', ''FY'', null)', v_other_org),
    'administrator with MFA', 'an admin cannot create a budget in another organization');
  v_budget := public.budget_create(v_org, date '2026-10-01', 'Operating budget 2026-27', 'First draft');
  perform tests.ok(v_budget is not null, 'an admin with MFA creates a draft budget');
  perform tests.budget_raises(format(
    'select public.budget_create(%L, date ''2026-10-01'', ''Again'', null)', v_org),
    'already has a budget', 'a fiscal year has one budget');

  -- Lines.
  perform tests.budget_raises(format(
    'select public.budget_save_line(%L, null, %L, null, null, null, array_fill(1::bigint, array[12]), null)', v_budget, v_bank),
    'revenue or expense', 'balance sheet accounts are not budgeted');
  perform tests.budget_raises(format(
    'select public.budget_save_line(%L, null, %L, null, null, null, array_fill(1::bigint, array[12]), null)', v_budget, v_other_rent),
    'revenue or expense', 'another organization''s account is refused');
  perform tests.budget_raises(format(
    'select public.budget_save_line(%L, null, %L, null, null, null, array_fill(1::bigint, array[11]), null)', v_budget, v_rent),
    'twelve months', 'a line needs twelve months');
  perform tests.budget_raises(format(
    'select public.budget_save_line(%L, null, %L, null, null, null, array[-1,0,0,0,0,0,0,0,0,0,0,0]::bigint[], null)', v_budget, v_rent),
    'negative', 'budget amounts are not negative');
  perform tests.budget_raises(format(
    'select public.budget_save_line(%L, null, %L, null, %L, %L, array_fill(1::bigint, array[12]), null)',
    v_budget, v_rent, v_youth, v_seniors_project),
    'not in this organization or program', 'a project must be inside the line''s program');

  -- Rent: 12,000 for youth (1,000 a month); 2,400 organization-wide; 3,600
  -- for the seniors project. Supplies: 1,200 for youth on the grant fund.
  -- Donations: 6,000 for youth.
  v_rent_line := public.budget_save_line(v_budget, null, v_rent, v_gen, v_youth, null, v_even, null);
  perform public.budget_save_line(v_budget, null, v_rent, v_gen, null, null, array_fill(20000::bigint, array[12]), null);
  perform public.budget_save_line(v_budget, null, v_rent, v_gen, v_seniors, v_seniors_project,
    array_fill(30000::bigint, array[12]), null);
  perform public.budget_save_line(v_budget, null, v_supplies, v_grant_fund, v_youth, null,
    array_fill(10000::bigint, array[12]), null);
  perform public.budget_save_line(v_budget, null, v_donations, v_gen, v_youth, null,
    array_fill(50000::bigint, array[12]), 'Spring campaign');
  perform tests.budget_raises(format(
    'select public.budget_save_line(%L, null, %L, %L, %L, null, array_fill(1::bigint, array[12]), null)',
    v_budget, v_rent, v_gen, v_youth),
    'already has a line', 'one line per account, fund, program and project');
  select annual_cents into v_sum from public.budget_line where id = v_rent_line;
  perform tests.ok(v_sum = 1200000, 'the annual amount is the sum of the months');
  perform tests.clear_auth(); reset role;

  -- Staff, even ledger readers, cannot change lines.
  insert into public.ledger_reader (organization_id, user_id) values (v_org, v_staff);
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.budget_raises(format(
    'select public.budget_save_line(%L, null, %L, null, null, null, array_fill(1::bigint, array[12]), null)', v_budget, v_supplies),
    'administrator with MFA', 'a ledger reader cannot add budget lines');
  perform tests.budget_raises(format('select public.budget_approve(%L)', v_budget),
    'administrator with MFA', 'a ledger reader cannot approve a budget');
  perform tests.budget_raises(format('update public.budget_line set annual_cents = 0 where id = %L', v_rent_line),
    'permission denied', 'a ledger reader cannot update lines directly');
  select count(*) into v_rows from public.budget_line where budget_id = v_budget;
  perform tests.ok(v_rows = 5, 'a ledger reader reads every budget line');
  perform tests.clear_auth(); reset role;
  delete from public.ledger_reader where organization_id = v_org and user_id = v_staff;

  -- ---------------------------------------------------------------------
  -- Approval locks; a revision is a new version
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  perform public.budget_approve(v_budget);
  perform tests.ok((select status = 'approved' and approved_by = v_admin from public.budget where id = v_budget),
    'the approver and time are recorded');
  perform tests.budget_raises(format(
    'select public.budget_save_line(%L, %L, %L, %L, %L, null, array_fill(1::bigint, array[12]), null)',
    v_budget, v_rent_line, v_rent, v_gen, v_youth),
    'locked', 'an approved budget''s lines cannot change');
  perform tests.budget_raises(format('select public.budget_delete_line(%L)', v_rent_line),
    'locked', 'an approved budget''s lines cannot be removed');
  perform tests.budget_raises(format('select public.budget_delete_draft(%L)', v_budget),
    'cannot be deleted', 'an approved budget cannot be deleted');
  perform tests.budget_raises(format('select public.budget_approve(%L)', v_budget),
    'Only a draft', 'an approved budget is not approved twice');
  perform tests.clear_auth(); reset role;

  -- The lock holds for the table owner too.
  perform tests.budget_raises(format('update public.budget set name = ''Changed'' where id = %L', v_budget),
    'locked', 'the table owner cannot rename an approved budget');
  perform tests.budget_raises(format('update public.budget_line set month_cents = array_fill(0::bigint, array[12]), annual_cents = 0 where id = %L', v_rent_line),
    'locked', 'the table owner cannot change an approved line');
  perform tests.budget_raises(format('delete from public.budget_line where id = %L', v_rent_line),
    'locked', 'the table owner cannot delete an approved line');
  perform tests.budget_raises(format('delete from public.budget where id = %L', v_budget),
    'cannot be deleted', 'the table owner cannot delete an approved budget');

  perform tests.authenticate(v_admin, 'aal2');
  v_v2 := public.budget_revise(v_budget);
  select count(*) into v_rows from public.budget_line where budget_id = v_v2;
  perform tests.ok(v_rows = 5, 'a revision starts with a copy of the approved lines');
  perform tests.ok((select version = 2 and status = 'draft' from public.budget where id = v_v2),
    'a revision is version 2, a draft');
  perform tests.budget_raises(format('select public.budget_revise(%L)', v_budget),
    'already in progress', 'only one revision at a time');
  select id into v_line from public.budget_line where budget_id = v_v2 and account_id = v_supplies;
  perform public.budget_save_line(v_v2, v_line, v_supplies, v_grant_fund, v_youth, null,
    array_fill(20000::bigint, array[12]), null);
  perform tests.ok((select annual_cents from public.budget_line where id = v_line) = 240000,
    'a draft revision''s lines can change');
  perform public.budget_approve(v_v2);
  perform tests.ok((select status = 'superseded' and superseded_at is not null from public.budget where id = v_budget),
    'approving the revision supersedes the old version');
  perform tests.ok((select annual_cents from public.budget_line where budget_id = v_budget and account_id = v_supplies) = 120000,
    'the superseded version keeps its own amounts');
  select count(*) into v_rows from public.budget where organization_id = v_org and fiscal_year_start = date '2026-10-01';
  perform tests.ok(v_rows = 2, 'both versions are kept');
  perform tests.budget_raises(format('select public.budget_revise(%L)', v_budget),
    'Only the approved', 'a superseded version cannot be revised');
  perform tests.clear_auth(); reset role;
  perform tests.budget_raises(format('update public.budget set name = ''Changed'' where id = %L', v_budget),
    'superseded budget cannot change', 'a superseded budget cannot change, even for the table owner');

  -- A draft can be deleted, with its lines.
  perform tests.authenticate(v_admin, 'aal2');
  v_line := public.budget_create(v_org, date '2027-10-01', 'Next year', null);
  perform public.budget_save_line(v_line, null, v_rent, null, null, null, v_even, null);
  perform tests.budget_raises(format('select public.budget_approve(%L)', public.budget_create(v_org, date '2028-10-01', 'Empty', null)),
    'at least one line', 'an empty budget cannot be approved');
  perform public.budget_delete_draft(v_line);
  perform tests.ok(not exists (select 1 from public.budget where id = v_line), 'a draft budget can be deleted');
  perform tests.clear_auth(); reset role;
  perform tests.ok(not exists (select 1 from public.budget_line where budget_id = v_line), 'its lines go with it');

  -- ---------------------------------------------------------------------
  -- The report: budget and actuals
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  select * into r from public.budget_vs_actual(v_v2, date '2026-11-01') where account_id = v_rent;
  perform tests.ok(r.annual_budget_cents = 1200000 + 240000 + 360000, 'annual rent budget sums every line');
  perform tests.ok(r.month_budget_cents = 100000 + 20000 + 30000, 'November''s rent budget is the November column');
  perform tests.ok(r.ytd_budget_cents = 2 * (100000 + 20000 + 30000), 'year-to-date budget is October and November');
  perform tests.ok(r.month_actual_cents = 110000 + 30000, 'November''s rent actual is November''s posted lines');
  perform tests.ok(r.ytd_actual_cents = 80000 + 20000 + 110000 + 30000, 'year-to-date rent actual excludes drafts');

  -- Actuals equal the ledger's own totals for the same filters.
  select coalesce(sum(debit_cents - credit_cents), 0) into v_ledger
  from public.ledger_trial_balance(v_org, date '2026-11-30') where account_id = v_rent;
  perform tests.ok(r.ytd_actual_cents = v_ledger,
    format('year-to-date rent equals the trial balance (%s = %s)', r.ytd_actual_cents, v_ledger));

  select sum(ytd_actual_cents) into v_sum from public.budget_vs_actual(v_v2, date '2026-11-01', null, null, v_grant_fund)
  where account_type = 'expense';
  select coalesce(sum(balance_cents), 0) into v_ledger
  from public.ledger_trial_balance(v_org, date '2026-11-30', v_grant_fund) where account_type = 'expense';
  perform tests.ok(v_sum = v_ledger, format('fund-filtered expenses equal the fund''s trial balance (%s = %s)', v_sum, v_ledger));

  select sum(ytd_actual_cents) into v_sum from public.budget_vs_actual(v_v2, date '2026-11-01', v_youth)
  where account_type = 'expense';
  select coalesce(sum(l.debit_cents - l.credit_cents), 0) into v_ledger
  from public.journal_line l join public.journal_entry e on e.id = l.entry_id
  join public.ledger_account a on a.id = l.account_id
  where l.organization_id = v_org and e.status = 'posted' and l.program_id = v_youth
    and a.account_type = 'expense' and e.entry_date between date '2026-10-01' and date '2026-11-30';
  perform tests.ok(v_sum = v_ledger and v_sum = 80000 + 15000 + 110000,
    format('program-filtered expenses equal the program''s posted lines (%s = %s)', v_sum, v_ledger));

  select * into r from public.budget_vs_actual(v_v2, date '2026-11-01', null, v_seniors_project) where account_id = v_rent;
  perform tests.ok(r.ytd_actual_cents = 30000 and r.ytd_budget_cents = 60000,
    'project filter keeps only that project''s budget and actuals');

  select * into r from public.budget_vs_actual(v_v2, date '2026-10-01', v_youth) where account_id = v_donations;
  perform tests.ok(r.ytd_actual_cents = 50000 and r.ytd_budget_cents = 50000,
    'revenue is measured as credits less debits');

  select count(*) into v_rows from public.budget_vs_actual(v_v2, date '2026-10-01')
  where account_type not in ('revenue', 'expense');
  perform tests.ok(v_rows = 0, 'balance sheet accounts stay out of the report');

  perform tests.budget_raises(format('select * from public.budget_vs_actual(%L, date ''2027-10-01'')', v_v2),
    'inside the budget', 'a month outside the fiscal year is refused');
  perform tests.clear_auth(); reset role;

  -- Who reads the report.
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.budget_raises(format('select * from public.budget_vs_actual(%L, date ''2026-11-01'')', v_v2),
    'do not have access', 'staff without ledger access cannot run the report');
  select count(*) into v_rows from public.budget;
  perform tests.ok(v_rows = 0, 'staff without ledger access read no budgets');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.budget_raises(format('select * from public.budget_vs_actual(%L, date ''2026-11-01'')', v_v2),
    'do not have access', 'an owner without MFA cannot run the report');
  perform tests.clear_auth(); reset role;

  insert into public.ledger_reader (organization_id, user_id) values (v_org, v_staff);
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.budget_vs_actual(v_v2, date '2026-11-01');
  perform tests.ok(v_rows >= 3, 'a named ledger reader runs the report');
  perform tests.clear_auth(); reset role;
  delete from public.ledger_reader where organization_id = v_org and user_id = v_staff;

  -- ---------------------------------------------------------------------
  -- Program leads see their own program's summary only
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_lead, 'aal1');
  select count(*) into v_rows from public.budget_managed_programs(v_org) where program_id = v_youth;
  perform tests.ok(v_rows = 1, 'the lead sees the program they lead');
  select count(*) into v_rows from public.budget_managed_programs(v_org) where program_id = v_seniors;
  perform tests.ok(v_rows = 0, 'the lead does not see a program they do not lead');
  select count(*) into v_rows from public.budget;
  perform tests.ok(v_rows = 0, 'a program lead reads no budget tables');
  select count(*) into v_rows from public.journal_line;
  perform tests.ok(v_rows = 0, 'a program lead reads no journal lines');

  select sum(ytd_actual_cents) filter (where account_type = 'expense'),
         sum(ytd_budget_cents) filter (where account_type = 'expense'),
         bool_and(budget_id = v_v2)
    into v_sum, v_ledger, v_flag
  from public.budget_program_summary(v_youth, date '2026-11-15');
  perform tests.ok(v_sum = 80000 + 15000 + 110000,
    format('the lead''s summary shows only the youth program''s spending (%s)', v_sum));
  perform tests.ok(v_flag and v_ledger = 2 * (100000 + 20000),
    format('against the youth program''s approved (version 2) budget (%s)', v_ledger));
  perform tests.budget_raises(format('select * from public.budget_program_summary(%L, date ''2026-11-15'')', v_seniors),
    'do not manage', 'the lead cannot see another program''s summary');
  perform tests.budget_raises(format('select * from public.budget_vs_actual(%L, date ''2026-11-01'')', v_v2),
    'do not have access', 'the lead cannot run the full report');
  select count(*) into v_rows from public.budget_program_summary(v_youth, date '2028-01-01');
  perform tests.ok(v_rows = 0, 'no approved budget for the month means an empty summary');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.budget_raises(format('select * from public.budget_program_summary(%L, date ''2026-11-15'')', v_youth),
    'do not manage', 'a volunteer cannot see a program summary');
  select count(*) into v_rows from public.budget_managed_programs(v_org);
  perform tests.ok(v_rows = 0, 'a volunteer manages no programs');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal2');
  select count(*) into v_rows from public.budget_program_summary(v_seniors, date '2026-11-15');
  perform tests.ok(v_rows >= 1, 'an admin with MFA sees any program''s summary');
  perform tests.clear_auth(); reset role;

  begin
    set local role anon;
    perform public.budget_vs_actual(v_v2, date '2026-11-01');
    reset role;
    perform tests.ok(false, 'anon cannot call the report');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call the report');
  end;

  -- Every change left an audit record.
  select count(*) into v_rows from public.audit_event where organization_id = v_org and event_type = 'budget'
    and action in ('budget_created', 'line_saved', 'budget_approved', 'budget_revision_started', 'draft_deleted');
  perform tests.ok(v_rows >= 10, format('budget changes are audited (%s)', v_rows));
end
$$;

rollback;
