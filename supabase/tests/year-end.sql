-- Year-end close, statements, exports and the external accountant's
-- read-only access (#154; migration 20260929200000). Proves: only an admin
-- with MFA grants accountant access, only to a Guest, for at most a year;
-- the accountant reads the books, receipt figures and clean receipt files
-- only in an MFA session and only while the grant is current, and can change
-- nothing; closing a year posts a closing entry that empties revenue and
-- expenses into each fund's net assets and closes every period; the close is
-- undone only by reopening, which posts an explicit reopening entry. Runs
-- after ledger-core.sql (which rolls back). All mutations are rolled back.
begin;

-- Runs a statement and asserts it fails with a message containing p_pattern
-- (deferred rules are forced to run). Same as ledger-core.sql's helper, which
-- is rolled back with that file.
create function tests.ye_raises(p_sql text, p_pattern text, p_msg text)
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
grant execute on function tests.ye_raises(text, text, text) to authenticated, anon;

-- Sets the token's auth session id, which ledger_note_accountant_session keys on.
create function tests.with_session_id(p_session text)
returns void
language plpgsql
set search_path = tests, public
as $$
begin
  perform set_config('request.jwt.claims',
    (current_setting('request.jwt.claims', true)::jsonb || jsonb_build_object('session_id', p_session))::text,
    true);
end;
$$;
grant execute on function tests.with_session_id(text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_other_org uuid;
  v_bank uuid;
  v_donations uuid;
  v_grant_rev uuid;
  v_rent uuid;
  v_na_unres uuid;
  v_na_ext uuid;
  v_gen uuid;
  v_grant_fund uuid;
  v_entry uuid;
  v_closing uuid;
  v_reopening uuid;
  v_grant uuid;
  v_close uuid;
  v_period uuid;
  v_rows integer;
  v_sum bigint;
  v_bool boolean;
  v_clean_path text;
  v_pending_path text;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.organization (name, slug) values ('Year-end other org', 'year-end-other-org')
  returning id into v_other_org;

  select id into strict v_bank from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_donations from public.ledger_account where organization_id = v_org and code = '4200';
  select id into strict v_grant_rev from public.ledger_account where organization_id = v_org and code = '4010';
  select id into strict v_rent from public.ledger_account where organization_id = v_org and code = '5200';
  select id into strict v_na_unres from public.ledger_account where organization_id = v_org and code = '3000';
  select id into strict v_na_ext from public.ledger_account where organization_id = v_org and code = '3200';
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';

  -- An externally restricted grant that ended before the year end: its
  -- expense lines are still closed out.
  insert into public.ledger_fund (organization_id, code, name, restriction, funder, starts_on, ends_on)
  values (v_org, 'YE-GRANT', 'Year-end test grant', 'externally_restricted', 'Test funder',
          date '2025-10-01', date '2026-06-30')
  returning id into v_grant_fund;

  -- Two fiscal years and a year of activity, as the owner with MFA.
  perform tests.authenticate(v_owner, 'aal2');
  perform public.ledger_record_chart_approval(v_org, date '2025-09-01', 'Year-end Accountant, CPA');
  perform public.ledger_create_fiscal_year(v_org, date '2025-10-01');
  perform public.ledger_create_fiscal_year(v_org, date '2026-10-01');
  v_entry := public.ledger_save_draft(v_org, null, date '2025-11-15', 'Donation', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'debit_cents', 100000),
    jsonb_build_object('account_id', v_donations, 'fund_id', v_gen, 'credit_cents', 100000)));
  perform public.ledger_post_entry(v_entry);
  v_entry := public.ledger_save_draft(v_org, null, date '2025-12-01', 'Rent', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 30000),
    jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 30000)));
  perform public.ledger_post_entry(v_entry);
  v_entry := public.ledger_save_draft(v_org, null, date '2026-01-10', 'Grant received', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_bank, 'fund_id', v_grant_fund, 'debit_cents', 50000),
    jsonb_build_object('account_id', v_grant_rev, 'fund_id', v_grant_fund, 'credit_cents', 50000)));
  perform public.ledger_post_entry(v_entry);
  v_entry := public.ledger_save_draft(v_org, null, date '2026-03-01', 'Grant rent', 'standard', jsonb_build_array(
    jsonb_build_object('account_id', v_rent, 'fund_id', v_grant_fund, 'debit_cents', 20000),
    jsonb_build_object('account_id', v_bank, 'fund_id', v_grant_fund, 'credit_cents', 20000)));
  perform public.ledger_post_entry(v_entry);
  perform tests.clear_auth(); reset role;

  -- Receipts: one scanned clean, one still pending, each with its file.
  v_clean_path := v_org::text || '/' || v_staff::text || '/ye-clean/receipt.pdf';
  v_pending_path := v_org::text || '/' || v_staff::text || '/ye-pending/receipt.pdf';
  insert into storage.objects (bucket_id, name, owner_id) values
    ('receipts', v_clean_path, v_staff::text), ('receipts', v_pending_path, v_staff::text);
  insert into public.finance_receipt (organization_id, submitted_by, document_date, vendor, total_cents,
    storage_path, file_name, scan_status)
  values (v_org, v_staff, date '2025-12-01', 'Year-end landlord', 30000, v_clean_path, 'receipt.pdf', 'clean'),
         (v_org, v_staff, date '2025-12-02', 'Year-end pending', 1000, v_pending_path, 'receipt.pdf', 'pending');

  -- ---------------------------------------------------------------------
  -- Granting accountant access
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_rows from public.journal_entry;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 0, 'a guest without a grant reads no journal entries');

  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ye_raises(format('select public.ledger_grant_accountant(%L, %L, current_date + 30)', v_org, v_guest),
    'administrator', 'staff cannot grant accountant access');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ye_raises(format('select public.ledger_grant_accountant(%L, %L, current_date + 30)', v_org, v_guest),
    'administrator', 'an owner without MFA cannot grant accountant access');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ye_raises(format('select public.ledger_grant_accountant(%L, %L, current_date + 30)', v_org, v_staff),
    'Guest', 'only a Guest can be given accountant access');
  perform tests.ye_raises(format('select public.ledger_grant_accountant(%L, %L, current_date + 400)', v_org, v_guest),
    'one year', 'accountant access lasts at most a year');
  -- "Yesterday" in the organization's zone, as the function measures it; UTC's
  -- date runs ahead of Quebec's every evening.
  perform tests.ye_raises(format(
    'select public.ledger_grant_accountant(%L, %L, (now() at time zone (select coalesce(o.timezone, ''America/Toronto'') from public.organization o where o.id = %L))::date - 1)',
    v_org, v_guest, v_org),
    'one year', 'accountant access cannot end in the past');
  perform tests.ye_raises(format(
    'insert into public.ledger_accountant_grant (organization_id, user_id, expires_at) values (%L, %L, now() + interval ''1 day'')',
    v_org, v_guest), 'permission denied', 'grants are not written directly, even by an admin');
  v_grant := public.ledger_grant_accountant(v_org, v_guest, current_date + 30, 'Year-end review');
  perform tests.clear_auth(); reset role;
  perform tests.ok(exists (select 1 from public.ledger_accountant_grant where id = v_grant
    and granted_by = v_admin and revoked_at is null), 'the grant and its grantor are recorded');

  -- ---------------------------------------------------------------------
  -- What the accountant sees and cannot do
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_guest, 'aal1');
  select count(*) into v_rows from public.journal_entry;
  perform tests.ok(v_rows = 0, 'the accountant reads nothing before completing MFA');
  select count(*) into v_rows from public.ledger_accountant_grant where user_id = v_guest;
  perform tests.ok(v_rows = 1, 'the accountant sees their own grant, so the app can ask for MFA');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_rows from public.journal_entry where organization_id = v_org;
  perform tests.ok(v_rows = 4, format('the accountant with MFA reads the journal (%s)', v_rows));
  select count(*) into v_rows from public.ledger_statement_totals(v_org, date '2025-10-01', date '2026-09-30');
  perform tests.ok(v_rows > 0, 'the accountant reads the statement totals');
  select count(*) into v_rows from public.ledger_export_lines(v_org, date '2025-10-01', date '2026-09-30');
  perform tests.ok(v_rows = 8, format('the accountant exports every posted line (%s)', v_rows));
  select count(*) into v_rows from public.ledger_entry_trail(v_entry);
  perform tests.ok(v_rows >= 2, 'the accountant reads an entry''s trail (saved, posted)');
  select count(*) into v_rows from public.finance_receipt where organization_id = v_org and vendor like 'Year-end %';
  perform tests.ok(v_rows = 2, 'the accountant reads every receipt''s figures');
  select count(*) into v_rows from storage.objects where bucket_id = 'receipts' and name = v_clean_path;
  perform tests.ok(v_rows = 1, 'the accountant can download a clean receipt file');
  select count(*) into v_rows from storage.objects where bucket_id = 'receipts' and name = v_pending_path;
  perform tests.ok(v_rows = 0, 'the accountant cannot download a file not yet scanned clean');
  select count(*) into v_rows from public.ledger_account where organization_id = v_other_org;
  perform tests.ok(v_rows = 0, 'the accountant reads nothing of another organization');
  select count(*) into v_rows from public.audit_event;
  perform tests.ok(v_rows = 0, 'the accountant cannot read the audit log');
  select count(*) into v_rows from public.ledger_accountant_grant where user_id <> v_guest;
  perform tests.ok(v_rows = 0, 'the accountant sees no one else''s grant');

  perform tests.ye_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2026-10-05'', ''x'', ''standard'', ''[]''::jsonb)', v_org),
    'administrator', 'the accountant cannot write entries');
  perform tests.ye_raises(format('select public.ledger_post_entry(%L)', v_entry),
    'administrator', 'the accountant cannot post');
  perform tests.ye_raises(format('select public.ledger_reverse_entry(%L, date ''2026-01-01'', null)', v_entry),
    'administrator', 'the accountant cannot reverse');
  perform tests.ye_raises(format('select public.ledger_close_fiscal_year(%L, date ''2025-10-01'')', v_org),
    'administrator', 'the accountant cannot close the year');
  perform tests.ye_raises(format('select public.ledger_grant_accountant(%L, %L, current_date + 300)', v_org, v_guest),
    'administrator', 'the accountant cannot extend their own access');
  update public.ledger_account set name = 'x' where organization_id = v_org;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'the accountant cannot rename accounts');
  update public.finance_receipt set vendor = 'changed' where organization_id = v_org;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'the accountant cannot change receipts');
  perform tests.ye_raises(format(
    'update public.ledger_accountant_grant set expires_at = now() + interval ''10 years'' where id = %L', v_grant),
    'permission denied', 'the accountant cannot change their grant');

  -- Each accountant session that opens the books is recorded once.
  perform tests.with_session_id('ye-session-1');
  perform tests.ok(public.ledger_note_accountant_session(v_org), 'an accountant session is noted');
  perform public.ledger_note_accountant_session(v_org);
  perform tests.with_session_id('ye-session-2');
  perform public.ledger_note_accountant_session(v_org);
  perform tests.clear_auth(); reset role;
  select count(*) into v_rows from public.audit_event
  where organization_id = v_org and action = 'accountant_signed_in' and actor_id = v_guest;
  perform tests.ok(v_rows = 2, format('each accountant sign-in is audited once (%s)', v_rows));

  perform tests.authenticate(v_staff, 'aal1');
  perform tests.with_session_id('ye-staff');
  perform tests.ok(not public.ledger_note_accountant_session(v_org), 'staff sessions are not noted as accountant sign-ins');
  perform tests.ye_raises(format('select public.ledger_export_lines(%L, date ''2025-10-01'', date ''2026-09-30'')', v_org),
    'access to the ledger', 'the export refuses someone who may not read the ledger');
  perform tests.clear_auth(); reset role;

  -- Expiry and revocation take effect at once.
  update public.ledger_accountant_grant set starts_at = now() - interval '2 days', expires_at = now() - interval '1 day'
  where id = v_grant;
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_rows from public.journal_entry;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 0, 'an expired grant reads nothing');
  update public.ledger_accountant_grant set starts_at = now() - interval '1 day', expires_at = now() + interval '1 day'
  where id = v_grant;

  perform tests.authenticate(v_admin, 'aal2');
  perform public.ledger_revoke_accountant(v_grant);
  perform tests.clear_auth(); reset role;
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_rows from public.journal_entry;
  perform tests.ok(v_rows = 0, 'a revoked grant reads nothing');
  select count(*) into v_rows from public.finance_receipt;
  perform tests.ok(v_rows = 0, 'a revoked accountant reads no receipts');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Closing the year
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ye_raises(format('select public.ledger_close_fiscal_year(%L, date ''2025-10-01'')', v_org),
    'administrator', 'staff cannot close the year');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ye_raises(format('select public.ledger_close_fiscal_year(%L, date ''2024-10-01'')', v_org),
    'do not cover', 'a year without its periods cannot be closed');
  perform tests.ye_raises(format('select public.ledger_close_fiscal_year(%L, date ''2026-10-01'')', v_org),
    'earlier periods', 'years close in order');
  perform tests.ye_raises(format(
    'insert into public.journal_entry (organization_id, entry_date, memo, kind) values (%L, date ''2026-09-30'', ''x'', ''closing'')', v_org),
    'permission denied', 'nobody writes a closing entry by hand');
  perform tests.clear_auth(); reset role;
  perform tests.ye_raises(format(
    'insert into public.journal_entry (organization_id, entry_date, memo, kind) values (%L, date ''2026-09-30'', ''x'', ''closing'')', v_org),
    'closing the fiscal year', 'not even the table owner writes a closing entry outside the close');
  perform tests.authenticate(v_owner, 'aal2');
  v_close := public.ledger_close_fiscal_year(v_org, date '2025-10-01');
  select closing_entry_id into v_closing from public.ledger_year_close where id = v_close;
  perform tests.ok(v_closing is not null, 'closing the year posts a closing entry');
  perform tests.ok((select kind = 'closing' and status = 'posted' and entry_date = date '2026-09-30'
    from public.journal_entry where id = v_closing), 'the closing entry is posted on the last day of the year');

  select count(*) into v_rows from public.ledger_period
  where organization_id = v_org and starts_on between date '2025-10-01' and date '2026-09-30' and status = 'closed';
  perform tests.ok(v_rows = 12, 'every period of the year is closed');

  select coalesce(sum(balance_cents), 0) into v_sum from public.ledger_trial_balance(v_org, date '2026-09-30')
  where account_type in ('revenue', 'expense');
  select count(*) into v_rows from public.ledger_trial_balance(v_org, date '2026-09-30')
  where account_type in ('revenue', 'expense') and balance_cents <> 0;
  perform tests.ok(v_rows = 0, 'no revenue or expense balance is left after the close');
  select balance_cents into v_sum from public.ledger_trial_balance(v_org, date '2026-09-30', v_gen)
  where account_id = v_na_unres;
  perform tests.ok(v_sum = -70000, format('the general fund''s excess (700.00) is in unrestricted net assets (%s)', v_sum));
  select balance_cents into v_sum from public.ledger_trial_balance(v_org, date '2026-09-30', v_grant_fund)
  where account_id = v_na_ext;
  perform tests.ok(v_sum = -30000, format('the grant''s excess (300.00) is in externally restricted net assets (%s)', v_sum));

  -- The statement of operations still shows the year's activity.
  select movement_cents into v_sum from public.ledger_statement_totals(v_org, date '2025-10-01', date '2026-09-30')
  where account_id = v_donations and fund_id = v_gen;
  perform tests.ok(v_sum = -100000, format('operations ignore the closing entry (%s)', v_sum));
  select closing_movement_cents into v_sum from public.ledger_statement_totals(v_org, date '2025-10-01', date '2026-09-30')
  where account_id = v_donations and fund_id = v_gen;
  perform tests.ok(v_sum = 100000, 'the closing movement is reported apart');

  perform tests.ye_raises(format('select public.ledger_close_fiscal_year(%L, date ''2025-10-01'')', v_org),
    'already closed', 'a closed year cannot be closed twice');
  perform tests.ye_raises(format('select public.ledger_reverse_entry(%L, date ''2026-10-01'', null)', v_closing),
    'reopening the fiscal year', 'a closing entry cannot be reversed like an ordinary entry');
  select id into strict v_period from public.ledger_period where organization_id = v_org and starts_on = date '2026-03-01';
  perform tests.ye_raises(format('select public.ledger_set_period_status(%L, ''open'')', v_period),
    'closed fiscal year', 'a period of a closed year cannot be reopened on its own');
  perform tests.ye_raises(format(
    'select public.ledger_save_draft(%L, null, date ''2026-03-05'', ''late'', ''standard'', %L::jsonb)', v_org,
    jsonb_build_array(
      jsonb_build_object('account_id', v_rent, 'fund_id', v_gen, 'debit_cents', 100),
      jsonb_build_object('account_id', v_bank, 'fund_id', v_gen, 'credit_cents', 100))),
    'closed', 'nothing can be dated in a closed year');

  -- Reopening needs a reason and posts an explicit reopening entry.
  perform tests.ye_raises(format('select public.ledger_reopen_fiscal_year(%L, date ''2025-10-01'', '' '')', v_org),
    'reason', 'reopening the year needs a reason');
  v_reopening := public.ledger_reopen_fiscal_year(v_org, date '2025-10-01', 'Auditor adjustment');
  perform tests.ok((select kind = 'reversal' and status = 'posted' and reverses_entry_id = v_closing
    from public.journal_entry where id = v_reopening), 'reopening posts the reversal of the closing entry');
  select count(*) into v_rows from public.ledger_period
  where organization_id = v_org and starts_on between date '2025-10-01' and date '2026-09-30' and status = 'open';
  perform tests.ok(v_rows = 12, 'reopening reopens every period of the year');
  select balance_cents into v_sum from public.ledger_trial_balance(v_org, date '2026-09-30', v_gen)
  where account_id = v_donations;
  perform tests.ok(v_sum = -100000, 'revenue balances are back after reopening');
  perform tests.ok(exists (select 1 from public.ledger_year_close where id = v_close
    and reopened_at is not null and reopen_reason = 'Auditor adjustment'), 'the reopening is kept with its reason');

  -- And the year closes again cleanly.
  v_close := public.ledger_close_fiscal_year(v_org, date '2025-10-01');
  select count(*) into v_rows from public.ledger_trial_balance(v_org, date '2026-09-30')
  where account_type in ('revenue', 'expense') and balance_cents <> 0;
  perform tests.ok(v_rows = 0, 'closing again empties revenue and expenses again');
  select balance_cents into v_sum from public.ledger_trial_balance(v_org, date '2026-09-30', v_gen)
  where account_id = v_na_unres;
  perform tests.ok(v_sum = -70000, 'net assets are not doubled by a second close');
  perform tests.clear_auth(); reset role;

  -- Every step was audited.
  select count(*) into v_rows from public.audit_event where organization_id = v_org and event_type = 'ledger'
    and action in ('accountant_granted', 'accountant_revoked', 'fiscal_year_closed', 'fiscal_year_reopened');
  perform tests.ok(v_rows = 5, format('grants, revocations, closes and reopenings are audited (%s)', v_rows));

  begin
    set local role anon;
    perform public.ledger_statement_totals(v_org, date '2025-10-01', date '2026-09-30');
    reset role;
    perform tests.ok(false, 'anon cannot call the statement totals');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call the statement totals');
  end;
end
$$;

rollback;
