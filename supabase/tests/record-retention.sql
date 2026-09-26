-- #146: records retention rules and legal hold.
--
-- The guarantees live in the database, so this is where they are proven:
--   - a classified record cannot be deleted before its retention date, even by
--     an administrator, even by the service role;
--   - a record under hold (directly or through its category) cannot be
--     deleted, archived or reclassified at all;
--   - only an administrator signed in with MFA can place or release a hold or
--     change a rule, and every change is audited.
--
-- Transactional; fixtures are rolled back.
begin;
do $$
declare
  owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  org uuid;
  recent_receipt uuid;
  old_receipt uuid;
  old_receipt_2 uuid;
  old_bill uuid;
  governance uuid;
  plain uuid;
  hold uuid;
  bill_hold uuid;
  n int;
  v_until date;
  v_held boolean;
  v_past boolean;
  url text := 'https://drive.google.com/file/d/retention/view';
begin
  select organization_id into strict org
    from public.organization_membership where user_id = owner limit 1;

  select count(*) into n from public.record_category;
  perform tests.ok(n = 8, 'eight record categories are seeded');
  select count(*) into n from public.record_category
   where key in ('financial_record', 'receipt', 'bill', 'bank_statement')
     and retention_basis = 'fiscal_year_end' and minimum_years = 6;
  perform tests.ok(n = 4, 'financial categories keep six years after the fiscal year end');

  -- Fixtures, created by the owner (an administrator with MFA).
  perform tests.authenticate(owner, 'aal2');
  insert into public.document(organization_id, title, kind, url, owner_id, created_by, record_category, record_date)
    values (org, 'Recent receipt', 'link', url, owner, owner, 'receipt', current_date - 30)
    returning id into recent_receipt;
  insert into public.document(organization_id, title, kind, url, owner_id, created_by, record_category, record_date)
    values (org, 'Old receipt', 'link', url, owner, owner, 'receipt', current_date - interval '10 years')
    returning id into old_receipt;
  insert into public.document(organization_id, title, kind, url, owner_id, created_by, record_category, record_date)
    values (org, 'Old receipt two', 'link', url, owner, owner, 'receipt', current_date - interval '10 years')
    returning id into old_receipt_2;
  insert into public.document(organization_id, title, kind, url, owner_id, created_by, record_category, record_date)
    values (org, 'Old bill', 'link', url, owner, owner, 'bill', current_date - interval '10 years')
    returning id into old_bill;
  insert into public.document(organization_id, title, kind, url, owner_id, created_by, record_category, record_date)
    values (org, 'By-laws', 'link', url, owner, owner, 'governance_record', current_date - interval '20 years')
    returning id into governance;
  insert into public.document(organization_id, title, kind, url, owner_id, created_by)
    values (org, 'Meeting agenda', 'link', url, owner, owner)
    returning id into plain;

  -- -------------------------------------------------------------------------
  -- Retention: not before its date, not by anybody
  -- -------------------------------------------------------------------------
  begin
    delete from public.document where id = recent_receipt;
    raise exception 'FAIL: a receipt inside its retention period was deleted by an administrator';
  exception when insufficient_privilege then null; end;
  perform tests.ok(exists (select 1 from public.document where id = recent_receipt),
    'an administrator cannot delete a financial record before its retention date');

  begin
    delete from public.document where id = governance;
    raise exception 'FAIL: a governance record was deleted';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a permanent governance record cannot be deleted');

  -- Archiving keeps the record, so a retention period does not stop it.
  update public.document set archived_at = now() where id = recent_receipt;
  update public.document set archived_at = null where id = recent_receipt;
  perform tests.ok(true, 'a record inside its retention period can still be archived and restored');

  -- Reclassifying to escape the period is refused; lengthening is fine.
  begin
    update public.document set record_category = null where id = recent_receipt;
    raise exception 'FAIL: a receipt was unclassified to escape retention';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a record cannot be unclassified while its retention period runs');

  begin
    update public.document set record_date = current_date - interval '9 years' where id = recent_receipt;
    raise exception 'FAIL: backdating a receipt shortened its retention';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'backdating a record to shorten its retention is refused');

  begin
    update public.document set created_at = now() - interval '9 years', record_date = null
     where id = recent_receipt;
    raise exception 'FAIL: clearing the record date and backdating created_at shortened retention';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'falling back to an older creation date cannot shorten retention either');

  update public.document set record_category = 'governance_record' where id = recent_receipt;
  perform tests.ok(true, 'a record can be reclassified to keep it longer');
  select count(*) into n from public.audit_event
   where object_type = 'document' and object_id = recent_receipt
     and event_type = 'document.retention' and action = 'classified';
  perform tests.ok(n = 1, 'reclassifying a record is audited');

  -- The service role (and any other connection with no signed-in user) is
  -- held to the same rule.
  perform tests.clear_auth();
  reset role;
  begin
    delete from public.document where id = recent_receipt;
    raise exception 'FAIL: the service role deleted a record inside its retention period';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'the service role cannot delete a record before its retention date');

  -- The stored file is protected with the row.
  insert into storage.objects(bucket_id, name, owner_id)
    values ('documents', 'retention-guard/receipt.pdf', owner::text);
  insert into public.document(organization_id, title, kind, storage_path, owner_id, created_by, record_category, record_date)
    values (org, 'Scanned receipt', 'file', 'retention-guard/receipt.pdf', owner, owner, 'receipt', current_date);
  begin
    delete from storage.objects where bucket_id = 'documents' and name = 'retention-guard/receipt.pdf';
    raise exception 'FAIL: the file behind a retained record was deleted';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'the stored file of a retained record cannot be deleted');

  -- The date arithmetic, with and without a fiscal year end.
  v_until := app.record_retain_until(org, 'receipt', date '2020-05-01');
  perform tests.ok(v_until = date '2027-05-01',
    'without a fiscal year end, retention counts from one year after the record (the latest possible year end)');
  insert into public.record_retention_setting(organization_id, fiscal_year_end_month, fiscal_year_end_day)
    values (org, 3, 31);
  v_until := app.record_retain_until(org, 'receipt', date '2020-01-05');
  perform tests.ok(v_until = date '2026-03-31', 'a receipt from January counts from the March 31 year end that follows it');
  v_until := app.record_retain_until(org, 'receipt', date '2020-05-01');
  perform tests.ok(v_until = date '2027-03-31', 'a receipt from May counts from the next March 31');
  v_until := app.record_retain_until(org, 'signed_document', date '2020-05-01');
  perform tests.ok(v_until = date '2026-05-01', 'a signed document counts from its own date');
  v_until := app.record_retain_until(org, null, date '2020-05-01');
  perform tests.ok(v_until is null, 'an unclassified record has no retention date');

  begin
    insert into public.record_retention_setting(organization_id, fiscal_year_end_month, fiscal_year_end_day)
      values (org, 2, 29)
      on conflict (organization_id) do update set fiscal_year_end_month = 2, fiscal_year_end_day = 29;
    raise exception 'FAIL: February 29 was accepted as a fiscal year end';
  exception when check_violation then null; end;
  perform tests.ok(true, 'February 29 is refused as a fiscal year end');

  -- -------------------------------------------------------------------------
  -- Rules: never below the floor, administrators with MFA only
  -- -------------------------------------------------------------------------
  perform tests.authenticate(owner, 'aal2');
  begin
    insert into public.record_retention_rule(organization_id, category_key, retain_years)
      values (org, 'receipt', 5);
    raise exception 'FAIL: a five-year rule for receipts was accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a rule below the legal floor is refused, even for an administrator');

  insert into public.record_retention_rule(organization_id, category_key, retain_years, confirmed_at)
    values (org, 'receipt', 8, now());
  select confirmed_by = owner into v_held from public.record_retention_rule
   where organization_id = org and category_key = 'receipt';
  perform tests.ok(v_held, 'confirming a rule records who confirmed it');
  update public.record_retention_rule set retain_years = 7
   where organization_id = org and category_key = 'receipt';
  select confirmed_at is null into v_held from public.record_retention_rule
   where organization_id = org and category_key = 'receipt';
  perform tests.ok(v_held, 'changing a confirmed period clears the confirmation');
  perform tests.clear_auth();
  reset role;
  v_until := app.record_retain_until(org, 'receipt', date '2020-05-01');
  perform tests.ok(v_until = date '2028-03-31', 'the organization''s longer rule is used');
  perform tests.authenticate(owner, 'aal2');

  begin
    insert into public.record_retention_rule(organization_id, category_key, retain_years)
      values (org, 'governance_record', 10);
    raise exception 'FAIL: a period was set on a permanent category';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a permanent category takes no period');

  select count(*) into n from public.audit_event
   where organization_id = org and object_type = 'record_retention_rule';
  perform tests.ok(n >= 2, 'saving a rule is audited');

  perform tests.authenticate(staff, 'aal2');
  begin
    insert into public.record_retention_rule(organization_id, category_key, retain_years)
      values (org, 'bill', 9);
    raise exception 'FAIL: staff saved a retention rule';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'staff cannot change a retention rule');
  select count(*) into n from public.record_retention_rule where organization_id = org;
  perform tests.ok(n = 1, 'staff can read the organization''s retention rules');

  perform tests.authenticate(volunteer, 'aal2');
  select count(*) into n from public.record_retention_rule where organization_id = org;
  perform tests.ok(n = 0, 'a volunteer cannot read retention rules');

  -- -------------------------------------------------------------------------
  -- Legal hold: who may place one
  -- -------------------------------------------------------------------------
  perform tests.authenticate(owner, 'aal1');
  begin
    insert into public.legal_hold(organization_id, scope, record_type, record_id, reason, placed_by)
      values (org, 'record', 'document', old_receipt, 'Audit by Revenu Québec', owner);
    raise exception 'FAIL: an owner without MFA placed a hold';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'an administrator without MFA cannot place a hold');

  perform tests.authenticate(staff, 'aal2');
  begin
    insert into public.legal_hold(organization_id, scope, record_type, record_id, reason, placed_by)
      values (org, 'record', 'document', old_receipt, 'Audit by Revenu Québec', staff);
    raise exception 'FAIL: staff placed a hold';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'staff cannot place a hold');

  perform tests.authenticate(owner, 'aal2');
  begin
    insert into public.legal_hold(organization_id, scope, record_type, record_id, reason, placed_by)
      values (org, 'record', 'document', gen_random_uuid(), 'Audit by Revenu Québec', owner);
    raise exception 'FAIL: a hold was placed on a record that does not exist';
  exception when foreign_key_violation then null; end;
  perform tests.ok(true, 'a hold must point at a record in this organization');

  insert into public.legal_hold(organization_id, scope, record_type, record_id, reason, placed_by)
    values (org, 'record', 'document', old_receipt, 'Audit by Revenu Québec', owner)
    returning id into hold;
  perform tests.ok(hold is not null, 'an administrator with MFA can place a hold on a record');
  select count(*) into n from public.audit_event
   where object_type = 'legal_hold' and object_id = hold and action = 'placed';
  perform tests.ok(n = 1, 'placing a hold is audited');

  -- -------------------------------------------------------------------------
  -- Legal hold: what it stops
  -- -------------------------------------------------------------------------
  begin
    delete from public.document where id = old_receipt;
    raise exception 'FAIL: a held record was deleted';
  exception when insufficient_privilege then null; end;
  perform tests.ok(exists (select 1 from public.document where id = old_receipt),
    'a held record cannot be deleted, even after its retention period');

  begin
    update public.document set archived_at = now() where id = old_receipt;
    raise exception 'FAIL: a held record was archived';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a held record cannot be archived');

  begin
    update public.document set record_category = 'governance_record' where id = old_receipt;
    raise exception 'FAIL: a held record was reclassified';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a held record cannot be reclassified');

  -- A hold is released, never edited or deleted.
  begin
    update public.legal_hold set reason = 'Something else' where id = hold;
    raise exception 'FAIL: a hold reason was edited';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a hold cannot be edited');

  -- No delete policy, so an administrator's delete matches nothing ...
  delete from public.legal_hold where id = hold;
  perform tests.ok(exists (select 1 from public.legal_hold where id = hold),
    'an administrator cannot delete a hold');

  begin
    update public.legal_hold set released_at = now() where id = hold;
    raise exception 'FAIL: a hold was released without a reason';
  exception when check_violation then null; end;
  perform tests.ok(true, 'releasing a hold needs a reason');

  perform tests.authenticate(staff, 'aal2');
  update public.legal_hold set released_at = now(), release_reason = 'Audit closed' where id = hold;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'staff cannot release a hold');

  -- A category hold covers every record in it, including old ones.
  perform tests.authenticate(owner, 'aal2');
  insert into public.legal_hold(organization_id, scope, category_key, reason, placed_by)
    values (org, 'category', 'bill', 'Dispute with a supplier', owner)
    returning id into bill_hold;
  begin
    delete from public.document where id = old_bill;
    raise exception 'FAIL: a bill under a category hold was deleted';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a category hold stops deletion of every record in the category');
  begin
    update public.document set record_category = null where id = old_bill;
    raise exception 'FAIL: a bill was moved out of a held category';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a record cannot be moved out of a held category');

  -- The register shows it all to an administrator.
  select r.held, r.past_retention into v_held, v_past
    from public.record_retention_register(org) r where r.record_id = old_receipt;
  perform tests.ok(v_held and v_past, 'the register shows a held record past retention as held');
  select r.held, r.past_retention into v_held, v_past
    from public.record_retention_register(org) r where r.record_id = old_receipt_2;
  perform tests.ok(not v_held and v_past, 'the register shows an unheld record past retention');
  select count(*) into n from public.record_retention_register(org) r where r.record_id = plain;
  perform tests.ok(n = 0, 'an unclassified, unheld document is not in the register');

  perform tests.authenticate(staff, 'aal2');
  begin
    perform * from public.record_retention_register(org);
    raise exception 'FAIL: staff read the records register';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'staff cannot read the records register');

  -- Release, then the old record can finally go.
  perform tests.authenticate(owner, 'aal2');
  update public.legal_hold set released_at = now(), release_reason = 'Audit closed' where id = hold;
  select released_by = owner into v_held from public.legal_hold where id = hold;
  perform tests.ok(v_held, 'releasing a hold records who released it');
  select count(*) into n from public.audit_event
   where object_type = 'legal_hold' and object_id = hold and action = 'released';
  perform tests.ok(n = 1, 'releasing a hold is audited');
  begin
    update public.legal_hold set release_reason = 'Again' where id = hold;
    raise exception 'FAIL: a hold was released twice';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a released hold stays released');

  delete from public.document where id = old_receipt;
  perform tests.ok(not exists (select 1 from public.document where id = old_receipt),
    'once released and past retention, a record can be deleted');

  delete from public.document where id = plain;
  perform tests.ok(not exists (select 1 from public.document where id = plain),
    'an unclassified document is unaffected');

  -- ... and a signed-in caller that bypasses row security is stopped by the
  -- trigger. (The service role has no signed-in user; only an organization
  -- being removed takes its holds with it.)
  perform tests.clear_auth();
  reset role;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner::text)::text, true);
  begin
    delete from public.legal_hold where id = bill_hold;
    raise exception 'FAIL: a hold was deleted around row security';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a hold cannot be deleted even around row security');

  perform tests.clear_auth();
  reset role;
end;
$$;
rollback;
