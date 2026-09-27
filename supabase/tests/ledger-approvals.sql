-- The approval chain behind a journal entry (#154 follow-up; migration
-- 20260929200100). Proves: an entry posted from a bill shows that bill's
-- approvals, and only those; waiting steps are listed; a reversal shows the
-- chain of the entry it reverses; a payment entry shows the payment's own
-- approvals; admins with MFA and the external accountant (Guest with a
-- current grant, in an MFA session) can read it; staff without ledger access,
-- a guest without a grant, and an accountant without MFA cannot. Runs after
-- qa-users.sql and rls.sql. All mutations are rolled back.
begin;

create function tests.la_raises(p_sql text, p_pattern text, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  perform tests.ok(v_error is not null and v_error ilike '%' || p_pattern || '%',
    format('%s (%s)', p_msg, coalesce(v_error, 'no error')));
end;
$$;
grant execute on function tests.la_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_bill uuid := gen_random_uuid();
  v_bill2 uuid := gen_random_uuid();
  v_payment uuid := gen_random_uuid();
  v_item uuid;
  v_item2 uuid;
  v_item_pay uuid;
  v_entry uuid;
  v_entry2 uuid;
  v_reversal uuid;
  v_payment_entry uuid;
  v_plain_entry uuid;
  v_rows integer;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  -- Fixtures, as the table owner. A period far from the other suites' dates.
  insert into public.ledger_period (organization_id, name, starts_on, ends_on)
  values (v_org, '2031-01', date '2031-01-01', date '2031-01-31');

  -- An approved bill: submitted by staff, approved by the admin at step 1.
  insert into public.approval_item (organization_id, subject_type, subject_id, title, amount_cents,
    requested_by, status, decided_by, decided_at)
  values (v_org, 'bill', v_bill, 'Bill from Approval Test Supplies', 50000, v_staff, 'approved', v_admin, now())
  returning id into v_item;
  insert into public.approval_step (item_id, organization_id, step, label, approver_kind, approver_id,
    status, decided_by, decided_at)
  values (v_item, v_org, 1, 'Treasurer', 'person', v_admin, 'approved', v_admin, now());
  insert into public.approval_event (item_id, organization_id, actor_id, kind, step, note, created_at) values
    (v_item, v_org, v_staff, 'submitted', null, null, now() - interval '2 hours'),
    (v_item, v_org, v_admin, 'approved', 1, 'Matches the quote', now() - interval '1 hour'),
    (v_item, v_org, v_admin, 'completed', null, null, now() - interval '1 hour');

  -- A second bill still waiting on its director.
  insert into public.approval_item (organization_id, subject_type, subject_id, title, amount_cents,
    requested_by, status, current_step)
  values (v_org, 'bill', v_bill2, 'Bill waiting for the director', 90000, v_staff, 'pending', 1)
  returning id into v_item2;
  insert into public.approval_step (item_id, organization_id, step, label, approver_kind, approver_id)
  values (v_item2, v_org, 1, 'Director', 'person', v_owner);
  insert into public.approval_event (item_id, organization_id, actor_id, kind)
  values (v_item2, v_org, v_staff, 'submitted');

  -- A payment's own approval.
  insert into public.approval_item (organization_id, subject_type, subject_id, title, amount_cents,
    requested_by, status, decided_by, decided_at)
  values (v_org, 'payment', v_payment, 'Payment to Approval Test Supplies', 50000, v_staff, 'approved', v_owner, now())
  returning id into v_item_pay;
  insert into public.approval_event (item_id, organization_id, actor_id, kind, step)
  values (v_item_pay, v_org, v_owner, 'approved', 1);

  -- Entries that came from those records, a reversal, and a manual entry.
  insert into public.journal_entry (organization_id, entry_date, memo, source_type, source_id)
  values (v_org, date '2031-01-15', 'Bill posted', 'finance_bill', v_bill) returning id into v_entry;
  insert into public.journal_entry (organization_id, entry_date, memo, source_type, source_id)
  values (v_org, date '2031-01-16', 'Second bill', 'finance_bill', v_bill2) returning id into v_entry2;
  insert into public.journal_entry (organization_id, entry_date, memo, kind, reverses_entry_id)
  values (v_org, date '2031-01-20', 'Reversal of the bill', 'reversal', v_entry) returning id into v_reversal;
  insert into public.journal_entry (organization_id, entry_date, memo, source_type, source_id)
  values (v_org, date '2031-01-21', 'Payment made', 'finance_payment', v_payment) returning id into v_payment_entry;
  insert into public.journal_entry (organization_id, entry_date, memo)
  values (v_org, date '2031-01-22', 'Manual entry') returning id into v_plain_entry;

  -- ---------------------------------------------------------------------
  -- What an admin sees
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_rows from public.ledger_entry_approvals(v_entry);
  perform tests.ok(v_rows = 3, format('a bill entry shows its approval trail (%s events)', v_rows));
  select * into r from public.ledger_entry_approvals(v_entry) where kind = 'approved';
  perform tests.ok(r.actor_name = 'QA Admin' and r.step_label = 'Treasurer' and r.note = 'Matches the quote'
    and r.item_status = 'approved' and r.item_amount_cents = 50000,
    'the approval names who approved, at which step, with the note');
  select count(*) into v_rows from public.ledger_entry_approvals(v_entry) where item_id <> v_item;
  perform tests.ok(v_rows = 0, 'another bill''s approvals are not mixed in');

  select count(*) into v_rows from public.ledger_entry_approvals(v_entry2) where kind = 'waiting'
    and step_label = 'Director' and actor_name = 'QA Owner';
  perform tests.ok(v_rows = 1, 'a step still waiting is listed with its approver');

  select count(*) into v_rows from public.ledger_entry_approvals(v_reversal) where item_id = v_item;
  perform tests.ok(v_rows = 3, 'a reversal shows the chain of the entry it reverses');

  select count(*) into v_rows from public.ledger_entry_approvals(v_payment_entry) where item_id = v_item_pay;
  perform tests.ok(v_rows = 1, 'a payment entry shows the payment''s approval');

  select count(*) into v_rows from public.ledger_entry_approvals(v_plain_entry);
  perform tests.ok(v_rows = 0, 'a manual entry has no approval chain');
  perform tests.clear_auth(); reset role;

  -- ---------------------------------------------------------------------
  -- The external accountant, and who is refused
  -- ---------------------------------------------------------------------
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '1 day', v_admin);

  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_rows from public.ledger_entry_approvals(v_entry);
  perform tests.ok(v_rows = 3, 'the accountant with MFA reads the approval chain');
  select count(*) into v_rows from public.approval_item where id = v_item;
  perform tests.ok(v_rows = 0, 'the accountant still cannot read approval items directly');
  perform tests.la_raises(format('select public.decide_approval(%L, ''approve'', null)', v_item2),
    'not available to you', 'the accountant cannot decide an approval');
  perform tests.clear_auth(); reset role;
  perform tests.ok((select status = 'pending' from public.approval_item where id = v_item2)
    and not exists (select 1 from public.approval_event where item_id = v_item2 and kind = 'approved'),
    'the waiting bill is untouched after the accountant''s attempt');

  perform tests.authenticate(v_guest, 'aal1');
  perform tests.la_raises(format('select * from public.ledger_entry_approvals(%L)', v_entry),
    'access to the ledger', 'the accountant without MFA is refused');
  perform tests.clear_auth(); reset role;

  update public.ledger_accountant_grant set revoked_at = now(), revoked_by = v_admin where user_id = v_guest;
  perform tests.authenticate(v_guest, 'aal2');
  perform tests.la_raises(format('select * from public.ledger_entry_approvals(%L)', v_entry),
    'access to the ledger', 'a revoked accountant is refused');
  perform tests.clear_auth(); reset role;

  perform tests.authenticate(v_staff, 'aal1');
  perform tests.la_raises(format('select * from public.ledger_entry_approvals(%L)', v_entry),
    'access to the ledger', 'staff without ledger access are refused, even as the requester');
  perform tests.clear_auth(); reset role;

  begin
    set local role anon;
    perform public.ledger_entry_approvals(v_entry);
    reset role;
    perform tests.ok(false, 'anon cannot call the approval chain');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call the approval chain');
  end;
end
$$;

rollback;
