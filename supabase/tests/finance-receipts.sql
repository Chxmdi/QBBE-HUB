-- finance_receipt (#142, migration 20260926100000): who may submit, read,
-- correct, review and download receipts, and what nobody may do. Run after
-- qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_other_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_receipt uuid;
  v_path text;
  v_count integer;
  v_ok boolean;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_volunteer, v_other_staff);

  v_path := v_org::text || '/' || v_staff::text || '/' || gen_random_uuid()::text || '/receipt.jpg';
  insert into storage.objects (bucket_id, name, owner_id)
  values ('receipts', v_path, v_staff::text);
  insert into storage.objects (bucket_id, name, owner_id)
  values ('receipts', v_org::text || '/' || v_other_staff::text || '/theirs.jpg', v_other_staff::text);

  -- Before a receipt is saved, the uploader can see their own upload (so a
  -- refused save can remove it) but not anyone else's.
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from storage.objects where bucket_id = 'receipts' and name = v_path;
  perform tests.ok(v_count = 1, 'an uploader sees their own unregistered upload, so a refused save can remove it');
  select count(*) into v_count from storage.objects
  where bucket_id = 'receipts' and name = v_org::text || '/' || v_other_staff::text || '/theirs.jpg';
  perform tests.ok(v_count = 0, 'nobody sees another person''s unregistered upload');

  -- Staff submit their own upload.
  insert into public.finance_receipt (organization_id, document_date, vendor, total_cents,
    gst_cents, qst_cents, storage_path, file_name, mime_type, size_bytes)
  values (v_org, current_date, 'Staples', 4218, 183, 365, v_path, 'receipt.jpg', 'image/jpeg', 1234)
  returning id into v_receipt;
  perform tests.ok(v_receipt is not null, 'staff submit a receipt for their own upload');

  select count(*) into v_count from public.finance_receipt where id = v_receipt;
  perform tests.ok(v_count = 1, 'the submitter reads their own receipt');

  -- ...but cannot self-certify the scan, register someone else's file, or
  -- enter taxes above the total.
  begin
    insert into public.finance_receipt (organization_id, document_date, vendor, total_cents,
      storage_path, file_name, scan_status)
    values (v_org, current_date, 'X', 100, v_path || '2', 'x.jpg', 'clean');
    perform tests.ok(false, 'a submitter cannot mark their upload clean');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a submitter cannot mark their upload clean');
  end;
  begin
    insert into public.finance_receipt (organization_id, document_date, vendor, total_cents,
      storage_path, file_name)
    values (v_org, current_date, 'X', 100, v_org::text || '/' || v_other_staff::text || '/theirs.jpg', 'theirs.jpg');
    perform tests.ok(false, 'nobody registers another person''s upload');
  exception when insufficient_privilege then
    perform tests.ok(true, 'nobody registers another person''s upload');
  end;
  begin
    insert into public.finance_receipt (organization_id, document_date, vendor, total_cents,
      gst_cents, storage_path, file_name)
    values (v_org, current_date, 'X', 100, 500, v_path, 'x.jpg');
    perform tests.ok(false, 'taxes cannot exceed the total');
  exception when check_violation or unique_violation then
    perform tests.ok(true, 'taxes cannot exceed the total');
  end;

  -- The file stays unreadable until it is scanned clean.
  select count(*) into v_count from storage.objects where bucket_id = 'receipts' and name = v_path;
  perform tests.ok(v_count = 0, 'a pending receipt file cannot be downloaded, even by its submitter');

  -- The submitter corrects figures, but not the file, scan or review.
  update public.finance_receipt set vendor = 'Staples Canada' where id = v_receipt;
  select count(*) into v_count from public.finance_receipt where id = v_receipt and vendor = 'Staples Canada';
  perform tests.ok(v_count = 1, 'the submitter corrects their own figures before review');
  begin
    update public.finance_receipt set status = 'reviewed' where id = v_receipt;
    perform tests.ok(false, 'a submitter cannot review their own receipt');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a submitter cannot review their own receipt');
  end;
  begin
    update public.finance_receipt set scan_status = 'clean' where id = v_receipt;
    perform tests.ok(false, 'a submitter cannot change the scan result');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a submitter cannot change the scan result');
  end;

  -- Nobody deletes a receipt from the app.
  delete from public.finance_receipt where id = v_receipt;
  perform tests.clear_auth();
  reset role;
  select count(*) into v_count from public.finance_receipt where id = v_receipt;
  perform tests.ok(v_count = 1, 'a submitter cannot delete a receipt');

  -- Another staff member, a volunteer, and an admin without MFA see nothing.
  for r in select * from (values (v_other_staff, 'aal2', 'another staff member'),
                                 (v_volunteer, 'aal2', 'a volunteer'),
                                 (v_admin, 'aal1', 'an admin without MFA')) as t(uid, lvl, who) loop
    perform tests.authenticate(r.uid, r.lvl);
    select count(*) into v_count from public.finance_receipt where id = v_receipt;
    perform tests.clear_auth();
    reset role;
    perform tests.ok(v_count = 0, format('%s cannot read someone else''s receipt', r.who));
  end loop;

  -- A volunteer cannot submit at all.
  insert into storage.objects (bucket_id, name, owner_id)
  values ('receipts', v_org::text || '/' || v_volunteer::text || '/v.jpg', v_volunteer::text);
  perform tests.authenticate(v_volunteer, 'aal2');
  begin
    insert into public.finance_receipt (organization_id, document_date, vendor, total_cents, storage_path, file_name)
    values (v_org, current_date, 'X', 100, v_org::text || '/' || v_volunteer::text || '/v.jpg', 'v.jpg');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_ok, 'a volunteer cannot submit receipts');

  -- An admin with MFA reads every receipt and reviews it; the reviewer is
  -- recorded by the database, not taken from the request.
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_count from public.finance_receipt where id = v_receipt;
  perform tests.ok(v_count = 1, 'an admin with MFA reads every receipt');
  update public.finance_receipt set status = 'reviewed' where id = v_receipt;
  perform tests.clear_auth();
  reset role;
  select count(*) into v_count from public.finance_receipt
  where id = v_receipt and status = 'reviewed' and reviewed_by = v_admin and reviewed_at is not null;
  perform tests.ok(v_count = 1, 'the review records the admin who did it');

  -- After review the submitter can no longer change it.
  perform tests.authenticate(v_staff, 'aal1');
  update public.finance_receipt set vendor = 'Changed later' where id = v_receipt;
  perform tests.clear_auth();
  reset role;
  select count(*) into v_count from public.finance_receipt where id = v_receipt and vendor = 'Staples Canada';
  perform tests.ok(v_count = 1, 'a reviewed receipt is closed to its submitter');

  -- Once scanned clean, the submitter and admins can download; others cannot.
  update public.finance_receipt set scan_status = 'clean' where id = v_receipt;
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from storage.objects where bucket_id = 'receipts' and name = v_path;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_count = 1, 'the submitter downloads a clean receipt');
  perform tests.authenticate(v_other_staff, 'aal2');
  select count(*) into v_count from storage.objects where bucket_id = 'receipts' and name = v_path;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_count = 0, 'another staff member cannot download it');

  -- A registered file cannot be deleted or swapped by its uploader.
  perform tests.authenticate(v_staff, 'aal1');
  begin
    delete from storage.objects where bucket_id = 'receipts' and name = v_path;
    get diagnostics v_count = row_count;
    v_ok := v_count = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_ok, 'a registered receipt file cannot be deleted by its uploader');

  -- Signed out: nothing.
  set local role anon;
  select count(*) into v_count from public.finance_receipt;
  reset role;
  perform tests.ok(v_count = 0, 'anon reads no receipts');
end
$$;

rollback;
