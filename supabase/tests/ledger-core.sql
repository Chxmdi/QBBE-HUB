-- General ledger and funds (#148, #149; migration 20260927100000). Proves the
-- rules hold in the database whoever calls: entries balance (overall and per
-- fund), closed periods are frozen, posted entries are immutable even for the
-- table owner, corrections are reversals, restricted funds are spent only
-- inside their dates and programs, fund balances add up to the ledger, and
-- only admins with MFA and named ledger readers see anything. Run after
-- qa-users.sql and rls.sql. All mutations are rolled back.
begin;

-- Runs a statement as the current role and asserts that it fails with a
-- message containing p_pattern. Deferred rules are forced to run so a
-- violation cannot hide until a commit that never comes.
create function tests.ledger_raises(p_sql text, p_pattern text, p_msg text)
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
grant execute on function tests.ledger_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_other_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_other_org uuid;
  v_program uuid;
  v_other_program uuid;
  v_bank uuid;
  v_rent uuid;
  v_grant_rev uuid;
  v_net_assets uuid;
  v_gen uuid;
  v_grant_fund uuid;
  v_other_bank uuid;
  v_other_gen uuid;
  v_entry uuid;
  v_entry2 uuid;
  v_reversal uuid;
  v_number integer;
  v_period uuid;
  v_rows integer;
  v_sum bigint;
  v_sum2 bigint;
  v_lines jsonb;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  -- Fixtures, as the table owner.
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Ledger youth program', 'ledger-youth', v_owner) returning id into v_program;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Ledger seniors program', 'ledger-seniors', v_owner) returning id into v_other_program;
  insert into public.organization (name, slug) values ('Ledger other org', 'ledger-other-org')
  returning id into v_other_org;

  -- Every organization starts with the starter chart and a general fund,
  -- including one created after the migration ran.
  select count(*) into v_rows from public.ledger_account where organization_id = v_org;
  perform tests.ok(v_rows >= 50, format('the starter chart is seeded (%s accounts)', v_rows));
  select count(*) into v_rows from public.ledger_account where organization_id = v_other_org;
  perform tests.ok(v_rows >= 50, 'a new organization gets the starter chart');
  perform tests.ok(exists (select 1 from public.ledger_fund where organization_id = v_other_org
    and code = 'GEN' and restriction = 'unrestricted'), 'a new organization gets a general fund');
  perform tests.ok(exists (select 1 from public.ledger_settings where organization_id = v_org
    and chart_approved_on is null), 'the chart starts unapproved');

  select id into strict v_bank from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_rent from public.ledger_account where organization_id = v_org and code = '5200';
  select id into strict v_grant_rev from public.ledger_account where organization_id = v_org and code = '4010';
  select id into strict v_net_assets from public.ledger_account where organization_id = v_org and code = '3000';
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';
  select id into strict v_other_bank from public.ledger_account where organization_id = v_other_org and code = '1000';
  select id into strict v_other_gen from public.ledger_fund where organization_id = v_other_org and code = 'GEN';

  -- ---------------------------------------------------------------------
  -- Who can read
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  select count(*) into v_rows from public.ledger_account where organization_id = v_org;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows >= 50, 'an owner with MFA reads the chart');

  perform tests.authenticate(v_owner, 'aal1');
  select count(*) into v_rows from public.ledger_account;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 0, 'an owner without MFA reads nothing');

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.ledger_account;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 0, 'staff not named as ledger readers read nothing');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_rows from public.ledger_account;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 0, 'volunteers read nothing');

  -- Staff cannot name themselves readers; an admin can, and cannot name a
  -- volunteer.
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ledger_raises(format(
    'insert into public.ledger_reader (organization_id, user_id) values (%L, %L)', v_org, v_staff),
    'row-level security', 'staff cannot grant themselves ledger access');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ledger_raises(format(
    'insert into public.ledger_reader (organization_id, user_id) values (%L, %L)', v_org, v_volunteer),
    'Only active staff', 'a volunteer cannot be named a ledger reader');
  insert into public.ledger_reader (organization_id, user_id) values (v_org, v_staff);
  perform tests.clear_auth(); reset role;
  perform tests.ok(exists (select 1 from public.ledger_reader where user_id = v_staff and granted_by = v_admin),
    'the grantor is recorded by the database');

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.ledger_account where organization_id = v_org;
  perform tests.ok(v_rows >= 50, 'a named ledger reader reads the chart');
  select count(*) into v_rows from public.ledger_account where organization_id = v_other_org;
  perform tests.ok(v_rows = 0, 'a ledger reader reads nothing of another organization');
  perform tests.ledger_raises(format(
    'insert into public.ledger_account (organization_id, code, name, account_type) values (%L, ''1999'', ''x'', ''asset'')', v_org),
    'row-level security', 'a ledger reader cannot add accounts');
  perform tests.ledger_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2026-10-05'', ''x'', ''standard'', ''[]''::jsonb)', v_org),
    'administrator', 'a ledger reader cannot write entries');
  perform tests.ledger_raises(format(
    'select public.ledger_create_fiscal_year(%L, date ''2026-10-01'')', v_org),
    'administrator', 'a ledger reader cannot create periods');
  perform tests.ledger_raises(format(
    'select public.ledger_record_chart_approval(%L, date ''2026-09-20'', ''Accountant'')', v_org),
    'administrator', 'a ledger reader cannot record the chart approval');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_other_staff, 'aal1');
  select count(*) into v_rows from public.ledger_account;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 0, 'another staff member without a grant still reads nothing');

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ledger_raises(format(
    'select public.ledger_create_fiscal_year(%L, date ''2026-10-01'')', v_org),
    'administrator', 'an owner without MFA cannot keep the books');
  perform tests.clear_auth(); reset role;

  -- Journal tables take no direct writes from signed-in users, admins included.
  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ledger_raises(format(
    'insert into public.journal_entry (organization_id, entry_date, memo) values (%L, date ''2026-10-05'', ''direct'')', v_org),
    'permission denied', 'an admin cannot insert journal entries directly');
  perform tests.ledger_raises(format(
    'insert into public.ledger_period (organization_id, name, starts_on, ends_on) values (%L, ''x'', date ''2030-01-01'', date ''2030-01-31'')', v_org),
    'permission denied', 'an admin cannot insert periods directly');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Periods and the chart approval
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  select public.ledger_create_fiscal_year(v_org, date '2026-10-01') into v_rows;
  perform tests.ok(v_rows = 12, 'a fiscal year creates twelve monthly periods');
  select public.ledger_create_fiscal_year(v_org, date '2026-10-01') into v_rows;
  perform tests.ok(v_rows = 0, 'creating the same fiscal year again adds nothing');
  perform tests.ledger_raises(format(
    'select public.ledger_create_fiscal_year(%L, date ''2026-10-15'')', v_org),
    'first day of a month', 'a fiscal year starts on the first of a month');
  perform tests.ok((select ends_on from public.ledger_period where organization_id = v_org
    and starts_on = date '2027-02-01') = date '2027-02-28', 'February ends on the 28th in 2027');

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'debit_cents', 1000000),
    jsonb_build_object('account_id', v_net_assets, 'fund_id', v_gen, 'credit_cents', 1000000));
  v_entry := public.ledger_save_draft(v_org, null, date '2026-10-01', 'Opening balances', 'opening', v_lines);
  perform tests.ok(v_entry is not null, 'a balanced draft saves before the chart is approved');
  perform tests.ledger_raises(format('select public.ledger_post_entry(%L)', v_entry),
    'approval of the chart', 'nothing posts before the accountant approves the chart');

  perform tests.ledger_raises(format(
    'select public.ledger_record_chart_approval(%L, current_date + 1, ''Accountant'')', v_org),
    'future', 'the approval date cannot be in the future');
  perform public.ledger_record_chart_approval(v_org, date '2026-09-20', 'Jeanne Comptable, CPA');
  select public.ledger_post_entry(v_entry) into v_number;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_number = 1, format('the first posted entry is number 1 (%s)', v_number));
  perform tests.ok(exists (select 1 from public.ledger_settings where organization_id = v_org
    and chart_approved_by_name = 'Jeanne Comptable, CPA' and chart_approval_recorded_by = v_owner),
    'the approval and who recorded it are kept');
  perform tests.ok(exists (select 1 from public.journal_entry where id = v_entry
    and status = 'posted' and posted_by = v_owner and posted_at is not null),
    'posting records who and when');

  -- ---------------------------------------------------------------------
  -- Balance
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ledger_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2026-10-05'', ''Unbalanced'', ''standard'', %L::jsonb)',
    v_org, jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 50000),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 49999))),
    'does not balance', 'an unbalanced entry cannot be saved');
  perform tests.ledger_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2026-10-05'', ''Both sides'', ''standard'', %L::jsonb)',
    v_org, jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 100, 'credit_cents', 100))),
    'journal_line_one_side', 'a line cannot carry both a debit and a credit');
  perform tests.ledger_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2026-10-05'', ''Other org account'', ''standard'', %L::jsonb)',
    v_org, jsonb_build_array(
      jsonb_build_object('account_id', v_other_bank, 'fund_id', v_gen, 'debit_cents', 100),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 100))),
    'foreign key', 'a line cannot use another organization''s account');
  perform tests.ledger_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2026-10-05'', ''Wrong org'', ''standard'', %L::jsonb)',
    v_other_org, jsonb_build_array(
      jsonb_build_object('account_id', v_other_bank, 'fund_id', v_other_gen, 'debit_cents', 100))),
    'administrator', 'an admin cannot write into another organization');
  perform tests.ledger_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2031-01-05'', ''No period'', ''standard'', %L::jsonb)',
    v_org, jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 100),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 100))),
    'No fiscal period', 'an entry outside every period is refused');
  perform tests.clear_auth(); reset role;

  -- The rule is in the database, not only in the function: the table owner
  -- writing lines directly is held to it at commit.
  insert into public.journal_entry (organization_id, entry_date, memo) values (v_org, date '2026-10-06', 'Direct')
  returning id into v_entry2;
  perform tests.ledger_raises(format(
    'insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id, debit_cents) values (%L, %L, 1, %L, %L, 700)',
    v_org, v_entry2, v_rent, v_gen),
    'does not balance', 'the table owner cannot leave an unbalanced entry either');
  delete from public.journal_entry where id = v_entry2;

  -- ---------------------------------------------------------------------
  -- Funds (#149)
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  insert into public.ledger_fund (organization_id, code, name, restriction, funder, starts_on, ends_on)
  values (v_org, 'MFQ-2026', 'Youth grant 2026-27', 'externally_restricted', 'Ministère de la Famille',
          date '2026-10-01', date '2027-03-31')
  returning id into v_grant_fund;
  insert into public.ledger_fund_program (organization_id, fund_id, program_id)
  values (v_org, v_grant_fund, v_program);

  -- The grant arrives: bank and revenue in the grant fund.
  v_entry := public.ledger_save_draft(v_org, null, date '2026-10-10', 'Grant received', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_bank, 'fund_id', v_grant_fund, 'debit_cents', 500000),
      jsonb_build_object('account_id', v_grant_rev, 'fund_id', v_grant_fund, 'credit_cents', 500000,
                         'program_id', v_program)));
  perform tests.ok(public.ledger_post_entry(v_entry) = 2, 'entries are numbered in posting order');

  perform tests.ledger_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2026-10-12'', ''Cross fund'', ''standard'', %L::jsonb)',
    v_org, jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_grant_fund, 'debit_cents', 1000, 'program_id', v_program),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 1000))),
    'within fund', 'an entry must balance within each fund');

  v_entry := public.ledger_save_draft(v_org, null, date '2026-10-12', 'Rent on the wrong program', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_grant_fund, 'debit_cents', 1000, 'program_id', v_other_program),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_grant_fund, 'credit_cents', 1000)));
  perform tests.ledger_raises(format('select public.ledger_post_entry(%L)', v_entry),
    'only be spent on its programs', 'a restricted fund cannot pay for another program');
  perform tests.ledger_raises(format('select public.ledger_save_draft(%L, %L, date ''2026-10-12'', ''No program'', ''standard'', %L::jsonb) is not null and public.ledger_post_entry(%L) > 0',
    v_org, v_entry, jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_grant_fund, 'debit_cents', 1000),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_grant_fund, 'credit_cents', 1000)), v_entry),
    'only be spent on its programs', 'a restricted expense must name one of the fund''s programs');
  perform tests.ledger_raises(format('select public.ledger_save_draft(%L, %L, date ''2027-04-02'', ''Late'', ''standard'', %L::jsonb) is not null and public.ledger_post_entry(%L) > 0',
    v_org, v_entry, jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_grant_fund, 'debit_cents', 1000, 'program_id', v_program),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_grant_fund, 'credit_cents', 1000)), v_entry),
    'cannot be spent on', 'a restricted fund cannot be spent after its end date');
  perform public.ledger_save_draft(v_org, v_entry, date '2026-10-12', 'Youth program rent', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_grant_fund, 'debit_cents', 120000, 'program_id', v_program),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_grant_fund, 'credit_cents', 120000)));
  perform tests.ok(public.ledger_post_entry(v_entry) = 3, 'an expense on an allowed program inside the dates posts');

  -- An unrestricted expense has no such limits.
  v_entry := public.ledger_save_draft(v_org, null, date '2026-10-15', 'Office rent', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 80000),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 80000)));
  perform public.ledger_post_entry(v_entry);
  perform tests.clear_auth(); reset role;
  set constraints all immediate;
  set constraints all deferred;
  perform tests.ok(true, 'every posted entry passes the deferred checks too');

  -- ---------------------------------------------------------------------
  -- Immutability
  -- ---------------------------------------------------------------------
  perform tests.ledger_raises(format('update public.journal_entry set memo = ''changed'' where id = %L', v_entry),
    'cannot be changed', 'the table owner cannot change a posted entry');
  perform tests.ledger_raises(format('delete from public.journal_entry where id = %L', v_entry),
    'cannot be deleted', 'the table owner cannot delete a posted entry');
  perform tests.ledger_raises(format('update public.journal_line set debit_cents = debit_cents + 1 where entry_id = %L and debit_cents > 0', v_entry),
    'cannot change', 'the table owner cannot change a posted line');
  perform tests.ledger_raises(format('delete from public.journal_line where entry_id = %L', v_entry),
    'cannot change', 'the table owner cannot delete a posted line');
  perform tests.ledger_raises(format(
    'insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id, debit_cents) values (%L, %L, 9, %L, %L, 5)',
    v_org, v_entry, v_rent, v_gen),
    'cannot change', 'nothing can be added to a posted entry');

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ledger_raises(format('update public.journal_entry set memo = ''changed'' where id = %L', v_entry),
    'permission denied', 'an owner cannot update a posted entry');
  perform tests.ledger_raises(format('select public.ledger_delete_draft(%L)', v_entry),
    'cannot be deleted', 'an owner cannot delete a posted entry through the app');
  perform tests.ledger_raises(format(
    'select public.ledger_save_draft(%L, %L, date ''2026-10-15'', ''edit'', ''standard'', ''[]''::jsonb)', v_org, v_entry),
    'reverse it instead', 'an owner cannot re-save a posted entry');

  -- Account and fund codes are fixed once used.
  perform tests.ledger_raises(format('update public.ledger_account set code = ''5201'' where id = %L', v_rent),
    'keeps its code', 'an account with entries keeps its code');
  update public.ledger_account set name = 'Rent and occupancy' where id = v_rent;
  perform tests.ok((select name from public.ledger_account where id = v_rent) = 'Rent and occupancy',
    'an account with entries can be renamed');

  -- ---------------------------------------------------------------------
  -- Reversal
  -- ---------------------------------------------------------------------
  perform tests.ledger_raises(format('select public.ledger_reverse_entry(%L, date ''2026-10-14'', null)', v_entry),
    'on or after', 'a reversal cannot be dated before the entry');
  v_reversal := public.ledger_reverse_entry(v_entry, date '2026-10-20', null);
  perform tests.ok(exists (select 1 from public.journal_entry where id = v_reversal
    and status = 'posted' and kind = 'reversal' and reverses_entry_id = v_entry),
    'a reversing entry is posted and points at the original');
  select sum(l.debit_cents) into v_sum from public.journal_line l where l.entry_id = v_reversal
    and l.account_id = v_bank;
  perform tests.ok(v_sum = 80000, 'the reversal mirrors the original lines');
  perform tests.ok((select memo from public.journal_entry where id = v_entry) = 'Office rent',
    'the original entry is untouched');
  perform tests.ledger_raises(format('select public.ledger_reverse_entry(%L, date ''2026-10-21'', null)', v_entry),
    'already been reversed', 'an entry is reversed only once');
  perform tests.ledger_raises(format('select public.ledger_reverse_entry(%L, date ''2026-10-21'', null)', v_reversal),
    'cannot itself be reversed', 'a reversal is not reversed again');

  -- ---------------------------------------------------------------------
  -- Closed periods
  -- ---------------------------------------------------------------------
  v_entry2 := public.ledger_save_draft(v_org, null, date '2026-11-03', 'November draft', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 100),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 100)));
  select id into v_period from public.ledger_period where organization_id = v_org and starts_on = date '2026-11-01';
  perform tests.ledger_raises(format('select public.ledger_set_period_status(%L, ''closed'')', v_period),
    'drafts', 'a period with drafts cannot close');
  perform public.ledger_delete_draft(v_entry2);
  perform public.ledger_set_period_status(v_period, 'closed');
  perform tests.ok(exists (select 1 from public.ledger_period where id = v_period and status = 'closed'
    and closed_by = v_owner), 'closing records who closed the period');
  perform tests.ledger_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2026-11-03'', ''Closed'', ''standard'', %L::jsonb)',
    v_org, jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 100),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 100))),
    'closed', 'no entry can be created in a closed period');
  v_entry2 := public.ledger_save_draft(v_org, null, date '2026-10-25', 'October draft', 'standard',
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 100),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 100)));
  perform tests.ledger_raises(format(
    'select public.ledger_save_draft(%L, %L, date ''2026-11-04'', ''Moved'', ''standard'', %L::jsonb)',
    v_org, v_entry2, jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 100),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 100))),
    'closed', 'a draft cannot be moved into a closed period');
  perform tests.ledger_raises(format('select public.ledger_reverse_entry(%L, date ''2026-11-10'', null)', v_entry2),
    'Only a posted entry', 'a draft is deleted, not reversed');
  perform public.ledger_delete_draft(v_entry2);
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ledger_raises(format('select public.ledger_set_period_status(%L, ''open'')', v_period),
    'administrator', 'a ledger reader cannot reopen a period');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Reports
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0)
    into v_sum, v_sum2 from public.ledger_trial_balance(v_org, date '2027-09-30');
  perform tests.ok(v_sum = v_sum2 and v_sum > 0,
    format('the trial balance balances (%s = %s)', v_sum, v_sum2));
  select balance_cents into v_sum from public.ledger_trial_balance(v_org, date '2027-09-30') where code = '1000';
  perform tests.ok(v_sum = 1000000 + 500000 - 120000,
    format('the bank balance is the opening plus the grant less the youth rent (%s)', v_sum));
  select count(*) into v_rows from public.ledger_trial_balance(v_org, date '2026-09-30');
  perform tests.ok(v_rows = 0, 'nothing is on the books before the opening date');

  -- Fund balances add up to the whole ledger.
  select sum(fund_balance_cents), sum(assets_cents - liabilities_cents) into v_sum, v_sum2
  from public.ledger_fund_balances(v_org, date '2027-09-30');
  perform tests.ok(v_sum = v_sum2, format('fund balances equal net assets across funds (%s = %s)', v_sum, v_sum2));
  select sum(-balance_cents) into v_sum2 from public.ledger_trial_balance(v_org, date '2027-09-30')
  where account_type in ('net_assets', 'revenue', 'expense');
  perform tests.ok(v_sum = v_sum2, format('fund balances sum to the ledger total (%s = %s)', v_sum, v_sum2));
  select fund_balance_cents into v_sum from public.ledger_fund_balances(v_org, date '2027-09-30') where code = 'MFQ-2026';
  perform tests.ok(v_sum = 500000 - 120000, format('the grant fund shows what is left of the grant (%s)', v_sum));

  -- General ledger running balance ends at the trial balance figure.
  select running_cents into v_sum from public.ledger_general_ledger(v_org, date '2026-10-01', date '2027-09-30', v_bank)
  order by entry_date desc, entry_number desc, line_id limit 1;
  perform tests.ok(v_sum = 1380000, format('the general ledger running balance ends at the account balance (%s)', v_sum));
  select opening_cents into v_sum from public.ledger_general_ledger(v_org, date '2026-10-11', date '2027-09-30', v_bank) limit 1;
  perform tests.ok(v_sum = 1500000, format('the general ledger brings the earlier balance forward (%s)', v_sum));
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_other_staff, 'aal1');
  select count(*) into v_rows from public.ledger_trial_balance(v_org, date '2027-09-30');
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 0, 'the trial balance is empty for someone who may not read the ledger');

  begin
    set local role anon;
    perform public.ledger_trial_balance(v_org, date '2027-09-30');
    reset role;
    perform tests.ok(false, 'anon cannot call the trial balance');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call the trial balance');
  end;

  -- Revoking access takes effect at once.
  perform tests.authenticate(v_admin, 'aal2');
  delete from public.ledger_reader where organization_id = v_org and user_id = v_staff;
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.journal_entry;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 0, 'a revoked reader reads nothing');

  -- Every material step left an audit record.
  select count(*) into v_rows from public.audit_event where organization_id = v_org and event_type = 'ledger'
    and action in ('entry_posted', 'entry_reversed', 'period_closed', 'chart_approved', 'reader_granted', 'reader_revoked');
  perform tests.ok(v_rows >= 9, format('posting, reversing, closing, approving and access changes are audited (%s)', v_rows));
end
$$;

rollback;
