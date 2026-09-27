-- Gifts, grants and acknowledgements (#156; migration 20260929300000). Proves
-- in the database, whoever calls: only admins with MFA record gifts; a gift
-- posts one balanced entry through the ledger and is linked to it; the ledger
-- refusing the entry leaves no gift behind; in-kind gifts carry a value only
-- when the donor supplied one; gifts never change and are voided by reversal;
-- acknowledgements always carry the bilingual "not an official receipt"
-- sentence and never call themselves receipts; donor lists and statements are
-- audited; and nobody outside the ledger's readers sees a donor's gifts.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

create function tests.gift_raises(p_sql text, p_pattern text, p_msg text)
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
grant execute on function tests.gift_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_disclaimer text := E'This is not an official donation receipt for income tax purposes.\n'
    || E'Ceci n''est pas un reçu officiel de don aux fins de l''impôt.';
  v_org uuid;
  v_other_org uuid;
  v_program uuid;
  v_donor uuid;
  v_funder uuid;
  v_other_donor uuid;
  v_bank uuid;
  v_donations uuid;
  v_grant_rev uuid;
  v_supplies uuid;
  v_rent uuid;
  v_gen uuid;
  v_grant_fund uuid;
  v_grant uuid;
  v_gift uuid;
  v_gift2 uuid;
  v_inkind uuid;
  v_grant_gift uuid;
  v_ack uuid;
  v_entry uuid;
  v_rows integer;
  v_sum bigint;
  v_text text;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Gift literacy program', 'gift-literacy', v_owner) returning id into v_program;
  insert into public.crm_contact (organization_id, full_name, email)
  values (v_org, 'Gift Test Donor', 'donor@example.com') returning id into v_donor;
  insert into public.crm_organization (organization_id, name, category, owner_id, status)
  values (v_org, 'Gift Test Foundation', 'funder', v_owner, 'inactive') returning id into v_funder;
  insert into public.organization (name, slug) values ('Gift other org', 'gift-other-org')
  returning id into v_other_org;
  insert into public.crm_organization (organization_id, name, category, status)
  values (v_other_org, 'Other org funder', 'funder', 'inactive');
  insert into public.crm_contact (organization_id, full_name)
  values (v_other_org, 'Other org donor') returning id into v_other_donor;

  select id into strict v_bank from public.ledger_account where organization_id = v_org and code = '1000';
  select id into strict v_donations from public.ledger_account where organization_id = v_org and code = '4200';
  select id into strict v_grant_rev from public.ledger_account where organization_id = v_org and code = '4100';
  select id into strict v_supplies from public.ledger_account where organization_id = v_org and code = '5400';
  select id into strict v_rent from public.ledger_account where organization_id = v_org and code = '5200';
  select id into strict v_gen from public.ledger_fund where organization_id = v_org and code = 'GEN';

  -- The books are set up by an admin with MFA: a 2026 fiscal year and the
  -- accountant's approval of the chart.
  perform tests.authenticate(v_admin, 'aal2');
  perform public.ledger_create_fiscal_year(v_org, date '2026-01-01');
  perform public.ledger_record_chart_approval(v_org, date '2026-01-02', 'Accountant');
  insert into public.ledger_fund (organization_id, code, name, restriction, funder)
  values (v_org, 'GIFT-FDN', 'Foundation literacy grant', 'externally_restricted', 'Gift Test Foundation')
  returning id into v_grant_fund;
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- Who may record a gift
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.gift_raises(format($f$select public.gift_record(%L, %L::jsonb)$f$, v_org,
    jsonb_build_object('gift_type', 'donation', 'crm_contact_id', v_donor, 'received_on', '2026-03-15',
      'amount_cents', 5000, 'fund_id', v_gen, 'debit_account_id', v_bank, 'credit_account_id', v_donations)),
    'Only an administrator', 'staff cannot record a gift');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.gift_raises(format($f$select public.gift_record(%L, %L::jsonb)$f$, v_org,
    jsonb_build_object('gift_type', 'donation', 'crm_contact_id', v_donor, 'received_on', '2026-03-15',
      'amount_cents', 5000, 'fund_id', v_gen, 'debit_account_id', v_bank, 'credit_account_id', v_donations)),
    'Only an administrator', 'an owner without MFA cannot record a gift');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform tests.gift_raises(
    format($f$insert into public.gift (organization_id, gift_number, gift_type, crm_contact_id, received_on,
      amount_cents, fund_id) values (%L, 999, 'donation', %L, '2026-03-15', 100, %L)$f$, v_org, v_donor, v_gen),
    'permission denied', 'even an admin cannot write a gift row directly');
  perform tests.clear_auth(); reset role;

  begin
    set local role anon;
    perform public.gift_record(v_org, '{}'::jsonb);
    reset role;
    perform tests.ok(false, 'anon cannot call gift_record');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call gift_record');
  end;

  -- ---------------------------------------------------------------------
  -- Recording a donation posts a balanced, linked ledger entry
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  v_gift := public.gift_record(v_org, jsonb_build_object(
    'gift_type', 'donation', 'crm_contact_id', v_donor, 'received_on', '2026-03-15',
    'amount_cents', 25000, 'fund_id', v_gen, 'program_id', v_program,
    'donor_restriction', 'For the literacy program',
    'debit_account_id', v_bank, 'credit_account_id', v_donations));
  perform tests.clear_auth(); reset role;

  select * into r from public.gift where id = v_gift;
  perform tests.ok(r.gift_number >= 1 and r.status = 'recorded' and r.journal_entry_id is not null,
    'a donation is recorded with a gift number and a ledger entry');
  select * into r from public.journal_entry where id = (select journal_entry_id from public.gift where id = v_gift);
  perform tests.ok(r.status = 'posted' and r.source_type = 'gift' and r.source_id = v_gift
    and r.entry_date = date '2026-03-15', 'the entry is posted, dated the day received and points back to the gift');
  select sum(debit_cents) - sum(credit_cents), count(*) into v_sum, v_rows
  from public.journal_line where entry_id = r.id;
  perform tests.ok(v_sum = 0 and v_rows = 2, 'the entry balances on two lines');
  perform tests.ok(exists (select 1 from public.journal_line where entry_id = r.id and account_id = v_bank
    and debit_cents = 25000 and fund_id = v_gen and program_id = v_program),
    'the bank is debited in the gift''s fund and program');
  perform tests.ok(exists (select 1 from public.journal_line where entry_id = r.id and account_id = v_donations
    and credit_cents = 25000), 'donations revenue is credited');

  -- Donors come from the CRM, of this organization.
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.gift_raises(format($f$select public.gift_record(%L, %L::jsonb)$f$, v_org,
    jsonb_build_object('gift_type', 'donation', 'crm_contact_id', v_other_donor, 'received_on', '2026-03-15',
      'amount_cents', 100, 'fund_id', v_gen, 'debit_account_id', v_bank, 'credit_account_id', v_donations)),
    'Donor not found', 'a donor from another organization is refused');
  perform tests.gift_raises(format($f$select public.gift_record(%L, %L::jsonb)$f$, v_org,
    jsonb_build_object('gift_type', 'donation', 'crm_contact_id', v_donor, 'crm_organization_id', v_funder,
      'received_on', '2026-03-15', 'amount_cents', 100, 'fund_id', v_gen,
      'debit_account_id', v_bank, 'credit_account_id', v_donations)),
    'one donor', 'a gift names exactly one donor');
  perform tests.gift_raises(format($f$select public.gift_record(%L, %L::jsonb)$f$, v_org,
    jsonb_build_object('gift_type', 'donation', 'crm_contact_id', v_donor, 'received_on', '2026-03-15',
      'amount_cents', 100, 'fund_id', v_gen, 'debit_account_id', v_rent, 'credit_account_id', v_bank)),
    'credited to a revenue', 'a gift cannot be credited to an asset');
  perform tests.gift_raises(format($f$select public.gift_record(%L, %L::jsonb)$f$, v_org,
    jsonb_build_object('gift_type', 'donation', 'crm_contact_id', v_donor, 'received_on', '2026-03-15',
      'fund_id', v_gen, 'debit_account_id', v_bank, 'credit_account_id', v_donations)),
    'Enter the amount', 'a donation needs an amount');

  -- The ledger's own rules apply, and a refused entry leaves no gift behind.
  select count(*) into v_rows from public.gift where organization_id = v_org;
  perform tests.gift_raises(format($f$select public.gift_record(%L, %L::jsonb)$f$, v_org,
    jsonb_build_object('gift_type', 'donation', 'crm_contact_id', v_donor, 'received_on', '2025-06-01',
      'amount_cents', 100, 'fund_id', v_gen, 'debit_account_id', v_bank, 'credit_account_id', v_donations)),
    'No fiscal period', 'a gift dated outside every fiscal period is refused by the ledger');
  perform tests.ok((select count(*) from public.gift where organization_id = v_org) = v_rows,
    'the refused gift was not recorded');

  -- ---------------------------------------------------------------------
  -- In-kind gifts
  -- ---------------------------------------------------------------------
  v_inkind := public.gift_record(v_org, jsonb_build_object(
    'gift_type', 'in_kind', 'crm_organization_id', v_funder, 'received_on', '2026-04-01',
    'in_kind_description', 'Twenty boxes of children''s books', 'fund_id', v_gen));
  perform tests.gift_raises(format($f$select public.gift_record(%L, %L::jsonb)$f$, v_org,
    jsonb_build_object('gift_type', 'in_kind', 'crm_contact_id', v_donor, 'received_on', '2026-04-01',
      'in_kind_description', 'Laptop', 'amount_cents', 50000, 'fund_id', v_gen,
      'debit_account_id', v_supplies, 'credit_account_id', v_donations)),
    'only when the donor supplied', 'an in-kind value is refused unless the donor supplied it');
  v_gift2 := public.gift_record(v_org, jsonb_build_object(
    'gift_type', 'in_kind', 'crm_contact_id', v_donor, 'received_on', '2026-04-02',
    'in_kind_description', 'Printer paper', 'amount_cents', 4000, 'value_supplied_by_donor', true,
    'fund_id', v_gen, 'debit_account_id', v_supplies, 'credit_account_id', v_donations));
  perform tests.clear_auth(); reset role;

  perform tests.ok((select journal_entry_id is null and amount_cents is null from public.gift where id = v_inkind),
    'an in-kind gift without a value is recorded and not posted');
  perform tests.ok((select journal_entry_id is not null and value_supplied_by_donor from public.gift where id = v_gift2),
    'an in-kind gift with the donor''s value is posted');

  -- ---------------------------------------------------------------------
  -- Grants and grant payments
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.gift_raises(format($f$insert into public.grant_award (organization_id, funder_crm_organization_id,
    title, amount_awarded_cents, fund_id) values (%L, %L, 'x', 100, %L)$f$, v_org, v_funder, v_grant_fund),
    'row-level security', 'staff cannot create a grant');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform tests.gift_raises(format($f$insert into public.grant_award (organization_id, funder_crm_organization_id,
    title, amount_awarded_cents, fund_id) values (%L, (select id from public.crm_organization where organization_id = %L limit 1),
    'x', 100, %L)$f$, v_org, v_other_org, v_grant_fund),
    'not in this organization', 'a grant''s funder must be in this organization''s CRM');
  insert into public.grant_award (organization_id, funder_crm_organization_id, title, amount_awarded_cents,
    awarded_on, starts_on, ends_on, fund_id, program_id, restrictions, responsible_user_id)
  values (v_org, v_funder, 'Literacy 2026', 3000000, '2026-02-01', '2026-02-01', '2026-12-31',
    v_grant_fund, v_program, 'Books and tutors only', v_staff)
  returning id into v_grant;
  insert into public.grant_report (organization_id, grant_id, title, due_on)
  values (v_org, v_grant, 'Interim report', '2026-07-31');

  perform tests.gift_raises(format($f$select public.gift_record(%L, %L::jsonb)$f$, v_org,
    jsonb_build_object('gift_type', 'grant_payment', 'grant_id', v_grant, 'crm_contact_id', v_donor,
      'received_on', '2026-02-15', 'amount_cents', 1500000,
      'debit_account_id', v_bank, 'credit_account_id', v_grant_rev)),
    'funder', 'a grant payment must come from the grant''s funder');
  v_grant_gift := public.gift_record(v_org, jsonb_build_object(
    'gift_type', 'grant_payment', 'grant_id', v_grant, 'crm_organization_id', v_funder,
    'received_on', '2026-02-15', 'amount_cents', 1500000,
    'debit_account_id', v_bank, 'credit_account_id', v_grant_rev));
  perform tests.clear_auth(); reset role;

  perform tests.ok((select fund_id = v_grant_fund and program_id = v_program from public.gift where id = v_grant_gift),
    'a grant payment lands in the grant''s fund and program');
  perform tests.ok(exists (select 1 from public.journal_line l join public.gift g on g.journal_entry_id = l.entry_id
    where g.id = v_grant_gift and l.fund_id = v_grant_fund and l.credit_cents = 1500000),
    'the grant payment is posted to the restricted fund');

  -- ---------------------------------------------------------------------
  -- Gifts never change; mistakes are voided by reversal
  -- ---------------------------------------------------------------------
  perform tests.gift_raises(format('update public.gift set amount_cents = 1 where id = %L', v_gift),
    'cannot be changed', 'a recorded gift cannot be edited, even by the table owner');
  perform tests.gift_raises(format('delete from public.gift where id = %L', v_gift),
    'cannot be deleted', 'a gift cannot be deleted, even by the table owner');

  perform tests.authenticate(v_staff, 'aal1');
  perform tests.gift_raises(format($f$select public.gift_void(%L, date '2026-05-01', 'wrong')$f$, v_gift2),
    'Only an administrator', 'staff cannot void a gift');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform public.gift_void(v_gift2, date '2026-05-01', 'Entered twice');
  perform tests.gift_raises(format($f$select public.gift_void(%L, date '2026-05-01', 'again')$f$, v_gift2),
    'already voided', 'a gift is voided once');
  perform tests.clear_auth(); reset role;

  select * into r from public.gift where id = v_gift2;
  perform tests.ok(r.status = 'voided' and r.void_entry_id is not null and r.voided_by = v_admin,
    'the void is recorded with its reversing entry');
  perform tests.ok((select reverses_entry_id = r.journal_entry_id and status = 'posted'
    from public.journal_entry where id = r.void_entry_id), 'the reversal points at the gift''s entry');

  -- ---------------------------------------------------------------------
  -- Acknowledgements are never tax receipts
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.gift_raises(format($f$insert into public.gift_acknowledgement (organization_id, kind, gift_id,
    crm_contact_id, language, channel, recipient_name, subject, body_text)
    values (%L, 'gift', %L, %L, 'en', 'print', 'Gift Test Donor', 'Thank you', 'Thank you for your gift.')$f$,
    v_org, v_gift, v_donor),
    'gift_ack_not_a_tax_receipt', 'an acknowledgement without the disclaimer is refused');
  perform tests.gift_raises(format($f$insert into public.gift_acknowledgement (organization_id, kind, gift_id,
    crm_contact_id, language, channel, recipient_name, subject, body_text)
    values (%L, 'gift', %L, %L, 'en', 'print', 'Gift Test Donor', 'Thank you', %L)$f$,
    v_org, v_gift, v_donor, 'Thank you. This is not an official donation receipt for income tax purposes.'),
    'gift_ack_not_a_tax_receipt', 'the English sentence alone is not enough: French is required too');
  perform tests.gift_raises(format($f$insert into public.gift_acknowledgement (organization_id, kind, gift_id,
    crm_contact_id, language, channel, recipient_name, subject, body_text)
    values (%L, 'gift', %L, %L, 'en', 'print', 'Gift Test Donor', 'Your donation receipt', %L)$f$,
    v_org, v_gift, v_donor, v_disclaimer),
    'gift_ack_subject_not_receipt', 'a subject calling itself a receipt is refused');
  perform tests.gift_raises(format($f$insert into public.gift_acknowledgement (organization_id, kind, gift_id,
    crm_contact_id, language, channel, recipient_name, subject, body_text)
    values (%L, 'gift', %L, %L, 'fr', 'print', 'Gift Test Donor', 'Votre reçu', %L)$f$,
    v_org, v_gift, v_donor, v_disclaimer),
    'gift_ack_subject_not_receipt', 'a French subject calling itself a receipt is refused');
  perform tests.gift_raises(format($f$insert into public.gift_acknowledgement (organization_id, kind, gift_id,
    crm_organization_id, language, channel, recipient_name, subject, body_text)
    values (%L, 'gift', %L, %L, 'en', 'print', 'Someone', 'Thank you', %L)$f$,
    v_org, v_gift, v_funder, v_disclaimer),
    'gift''s donor', 'an acknowledgement goes to the gift''s own donor');
  perform tests.gift_raises(format($f$insert into public.gift_acknowledgement (organization_id, kind, gift_id,
    crm_contact_id, language, channel, recipient_name, subject, body_text)
    values (%L, 'gift', %L, %L, 'en', 'print', 'Gift Test Donor', 'Thank you', %L)$f$,
    v_org, v_gift2, v_donor, v_disclaimer),
    'voided gift', 'a voided gift is not acknowledged');

  insert into public.gift_acknowledgement (organization_id, kind, gift_id, crm_contact_id, language, channel,
    recipient_name, recipient_email, subject, body_text)
  values (v_org, 'gift', v_gift, v_donor, 'fr', 'email', 'Gift Test Donor', 'donor@example.com',
    'Merci pour votre don', 'Merci. ' || v_disclaimer)
  returning id into v_ack;
  update public.gift_acknowledgement set email_status = 'sent', sent_at = now() where id = v_ack;
  perform tests.gift_raises(format($f$update public.gift_acknowledgement set body_text = %L where id = %L$f$,
    'Changed. ' || v_disclaimer, v_ack),
    'cannot be changed', 'an issued acknowledgement''s text never changes');
  perform tests.gift_raises(format('delete from public.gift_acknowledgement where id = %L', v_ack),
    'permission denied', 'an acknowledgement cannot be deleted');
  perform tests.clear_auth(); reset role;

  perform tests.ok((select created_by = v_admin and email_status = 'sent' from public.gift_acknowledgement where id = v_ack),
    'the issuer is recorded and the delivery status moves');

  -- Annual statement for the year, as an acknowledgement of kind annual_statement.
  perform tests.authenticate(v_admin, 'aal2');
  insert into public.gift_acknowledgement (organization_id, kind, statement_year, crm_contact_id, language, channel,
    recipient_name, subject, body_text)
  values (v_org, 'annual_statement', 2026, v_donor, 'en', 'print', 'Gift Test Donor',
    '2026 statement of gifts', v_disclaimer);
  select count(*), sum(amount_cents) into v_rows, v_sum
  from public.gift_donor_statement(v_org, v_donor, null, 2026);
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_rows = 1 and v_sum = 25000,
    format('the statement lists the donor''s recorded gifts of the year, not voided ones (%s, %s)', v_rows, v_sum));

  -- ---------------------------------------------------------------------
  -- Who reads donor data, and the audit of it
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.gift;
  perform tests.ok(v_rows = 0, 'staff who are not ledger readers see no gifts');
  select count(*) into v_rows from public.gift_acknowledgement;
  perform tests.ok(v_rows = 0, 'staff who are not ledger readers see no acknowledgements');
  perform tests.gift_raises(format($f$select * from public.gift_donor_list(%L, date '2026-01-01', date '2026-12-31')$f$, v_org),
    'do not have access', 'staff who are not ledger readers cannot list donors');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_rows from public.gift;
  perform tests.ok(v_rows = 0, 'volunteers see no gifts');
  select count(*) into v_rows from public.grant_award;
  perform tests.ok(v_rows = 0, 'volunteers see no grants');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_admin, 'aal2');
  insert into public.ledger_reader (organization_id, user_id) values (v_org, v_staff);
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.gift where organization_id = v_org;
  perform tests.ok(v_rows >= 4, 'a named ledger reader sees the gifts');
  perform tests.gift_raises(format($f$insert into public.gift_acknowledgement (organization_id, kind, gift_id,
    crm_contact_id, language, channel, recipient_name, subject, body_text)
    values (%L, 'gift', %L, %L, 'en', 'print', 'Gift Test Donor', 'Thank you', %L)$f$,
    v_org, v_gift, v_donor, v_disclaimer),
    'row-level security', 'a ledger reader cannot issue acknowledgements');
  select count(*), sum(total_cents) into v_rows, v_sum
  from public.gift_donor_list(v_org, date '2026-01-01', date '2026-12-31', 'export');
  perform tests.ok(v_rows = 2 and v_sum = 1525000,
    format('the donor list totals recorded gifts per donor (%s donors, %s)', v_rows, v_sum));
  perform tests.gift_raises(format($f$select * from public.gift_donor_list(%L, date '2026-01-01', date '2026-12-31')$f$, v_other_org),
    'do not have access', 'a reader cannot list another organization''s donors');
  perform tests.clear_auth(); reset role;

  perform tests.ok(exists (select 1 from public.audit_event where organization_id = v_org and event_type = 'gifts'
    and action = 'donor_list_exported' and actor_id = v_staff), 'exporting the donor list is audited with who did it');
  perform tests.ok(exists (select 1 from public.audit_event where organization_id = v_org and event_type = 'gifts'
    and action = 'donor_statement_viewed' and actor_id = v_admin), 'reading a donor statement is audited');
  select count(*) into v_rows from public.audit_event where organization_id = v_org and event_type = 'gifts'
    and action in ('gift_recorded', 'gift_voided', 'acknowledgement_issued', 'statement_issued', 'grant_created',
      'grant_report_added');
  perform tests.ok(v_rows >= 8, format('recording, voiding, acknowledging and grant changes are audited (%s)', v_rows));

  -- Grant report reminders reset when the due date moves.
  update public.grant_report set last_reminder_kind = 'upcoming', last_reminded_at = now() where grant_id = v_grant;
  update public.grant_report set due_on = '2026-08-31' where grant_id = v_grant;
  perform tests.ok((select last_reminder_kind is null from public.grant_report where grant_id = v_grant),
    'moving a report''s due date starts its reminders again');
  perform tests.ok(exists (select 1 from public.job_definition where name = 'grant-report-reminders' and enabled),
    'the grant report reminder job is registered');
end
$$;

rollback;
