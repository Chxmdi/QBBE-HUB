-- Erasing a CRM contact (a donor's or partner's request): only an
-- administrator with MFA can do it; their identity goes from the contact,
-- its sensitive note, interaction text and the Zeffy match queue; gift
-- amounts stay for the tax-record period; the Zeffy identity is suppressed
-- so the sync cannot bring them back. Copies of the name in the activity
-- stream, notifications, sent email and issued tax receipts are outside this
-- function (kept for their own retention, or cleaned by their own jobs);
-- the contact's own history is scrubbed.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  org uuid;
  v_partner uuid;
  v_contact uuid;
  v_email text := 'erase-me-' || substr(md5(random()::text), 1, 8) || '@example.com';
  v_hits text;
  refused boolean;
  n int;
  r record;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  perform tests.ensure_verified_mfa_factor(admin_user);
  insert into public.crm_organization (organization_id, name, owner_id, next_action_at)
  values (org, 'CER partner', staff_user, now() + interval '7 days') returning id into v_partner;
  perform set_config('app.zeffy_link', 'on', true);
  insert into public.crm_contact (organization_id, crm_organization_id, full_name, email, phone, notes,
                                  communication_notes, owner_id, source, zeffy_contact_id)
  values (org, v_partner, 'Erin Erasable', v_email, '514-555-0199', 'Met at the gala, ' || v_email,
          'Prefers phone', staff_user, 'zeffy', 'zeffy-cer-1')
  returning id into v_contact;
  perform set_config('app.zeffy_link', '', true);
  insert into public.crm_sensitive_note (organization_id, crm_contact_id, notes)
  values (org, v_contact, 'Health: ' || v_email);
  insert into public.crm_interaction (organization_id, crm_organization_id, contact_id, owner_id, summary, next_steps)
  values (org, v_partner, v_contact, staff_user, 'Called Erin at ' || v_email, 'Email ' || v_email);
  insert into public.crm_follow_up (organization_id, crm_organization_id, contact_id, owner_id, title, due_at)
  values (org, v_partner, v_contact, staff_user, 'Thank Erin Erasable', now() + interval '3 days');
  update public.crm_contact set full_name = 'Erin Erasable' where id = v_contact;
  insert into public.zeffy_contact_match (organization_id, zeffy_contact_id, full_name, email, candidate_ids)
  values (org, 'zeffy-cer-1', 'Erin Erasable', v_email, array[v_contact]);
  insert into public.gift (organization_id, gift_number, gift_type, crm_contact_id, received_on, amount_cents, fund_id, created_by)
  values (org, 990001, 'donation', v_contact, current_date, 12345,
          (select id from public.ledger_fund where organization_id = org and code = 'GEN'), owner_user);

  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    perform public.erase_crm_contact(v_contact);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'staff cannot erase a contact');
  update public.crm_contact set phone = '514-555-0100' where id = v_contact;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'staff can still correct a contact');

  reset role;
  perform tests.authenticate(admin_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    perform public.erase_crm_contact(v_contact);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an administrator without MFA cannot erase a contact');

  reset role;
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  perform public.erase_crm_contact(v_contact);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  select full_name, email, phone, notes, communication_notes, zeffy_contact_id, status into r
  from public.crm_contact where id = v_contact;
  perform tests.ok(r.email is null and r.phone is null and r.notes is null and r.communication_notes is null
    and r.zeffy_contact_id is null and r.full_name <> 'Erin Erasable', 'the contact''s identity is erased');
  select count(*) into n from public.crm_sensitive_note where crm_contact_id = v_contact;
  perform tests.ok(n = 0, 'the sensitive note is deleted');
  select count(*) into n from public.gift where crm_contact_id = v_contact and amount_cents = 12345;
  perform tests.ok(n = 1, 'the gift amount stays');
  select count(*) into n from public.zeffy_suppressed_contact
  where organization_id = org and zeffy_contact_id = 'zeffy-cer-1';
  perform tests.ok(n = 1, 'the Zeffy identity is suppressed');
  select count(*) into n from public.audit_event where object_id = v_contact and action = 'crm_contact_erased';
  perform tests.ok(n = 1, 'the erasure is audited');

  -- No text or jsonb column (outside the copies named above) still holds the email.
  v_hits := null;
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and tb.table_type = 'BASE TABLE'
      and c.data_type in ('text', 'jsonb', 'character varying')
      and c.table_name not in ('notification', 'email_delivery', 'gift_acknowledgement', 'audit_event')
  loop
    execute format('select count(*) from public.%I where %I::text like %L or %I::text like %L',
      r.table_name, r.column_name, '%' || v_email || '%', r.column_name, '%Erin Erasable%') into n;
    if n > 0 then v_hits := coalesce(v_hits || ', ', '') || r.table_name || '.' || r.column_name; end if;
  end loop;
  perform tests.ok(v_hits is null, format('no column still holds the erased email or name (found: %s)', coalesce(v_hits, 'none')));
end;
$$;
rollback;
