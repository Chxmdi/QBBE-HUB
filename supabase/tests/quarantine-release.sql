-- Quarantined uploads (migration 20261124010000). Proves an administrator
-- with the second factor can release a file the scanner flagged only by a
-- heuristic (a password-protected PDF or archive), never one with a real
-- virus signature; can record a quarantined file's deletion; that both are
-- audited; and that staff, an administrator without the second factor and
-- signed-out visitors cannot do either, while a direct change to a scan
-- result is still refused. Run after qa-users.sql and rls.sql. All changes
-- are rolled back.
begin;

do $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_encrypted uuid;
  v_virus uuid;
  v_receipt uuid;
  v_bucket text;
  v_path text;
  v_row record;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_admin;

  insert into public.document (organization_id, title, kind, storage_path, owner_id, created_by, scan_status, scan_note, quarantined_at)
  values (v_org, 'Locked PDF', 'file', v_org || '/' || v_staff || '/q1/locked.pdf', v_staff, v_staff,
          'quarantined', 'Heuristics.Encrypted.PDF', now())
  returning id into v_encrypted;
  insert into public.document (organization_id, title, kind, storage_path, owner_id, created_by, scan_status, scan_note, quarantined_at)
  values (v_org, 'Test virus', 'file', v_org || '/' || v_staff || '/q2/eicar.txt', v_staff, v_staff,
          'quarantined', 'Eicar-Test-Signature', now())
  returning id into v_virus;
  insert into public.finance_receipt (organization_id, submitted_by, document_date, vendor, total_cents, storage_path, file_name,
                                      scan_status, scan_note, quarantined_at)
  values (v_org, v_staff, date '2026-10-01', 'Locked vendor', 1000, v_org || '/' || v_staff || '/q3/receipt.zip', 'receipt.zip',
          'quarantined', 'Heuristics.Encrypted.Zip', now())
  returning id into v_receipt;

  perform tests.ok(not has_function_privilege('anon', 'public.release_quarantined_file(text, uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.purge_quarantined_file(text, uuid)', 'execute'),
    'signed-out visitors cannot release or delete quarantined files');

  perform tests.authenticate(v_staff, 'aal2');
  perform tests.ok(tests.permission_denied(format('select public.release_quarantined_file(%L, %L, %L)', 'document', v_encrypted, 'mine')),
    'staff cannot release a quarantined file');
  perform tests.ok(tests.permission_denied(format('select * from public.purge_quarantined_file(%L, %L)', 'document', v_virus)),
    'staff cannot delete a quarantined file');
  perform tests.authenticate(v_admin, 'aal1');
  perform tests.ok(tests.permission_denied(format('select public.release_quarantined_file(%L, %L, %L)', 'document', v_encrypted, 'checked')),
    'an administrator without the second factor cannot release a file');

  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(tests.permission_denied(format('update public.document set scan_status = %L where id = %L', 'clean', v_virus)),
    'a direct change to a scan result is still refused');

  begin
    perform public.release_quarantined_file('document', v_virus, 'looks fine');
    perform tests.ok(false, 'a file with a virus signature cannot be released');
  exception when others then
    perform tests.ok(sqlstate = '22023', format('a file with a virus signature cannot be released (%s)', sqlstate));
  end;
  begin
    perform public.release_quarantined_file('document', v_encrypted, '   ');
    perform tests.ok(false, 'a release needs a reason');
  exception when others then
    perform tests.ok(sqlstate = '22023', format('a release needs a reason (%s)', sqlstate));
  end;

  perform public.release_quarantined_file('document', v_encrypted, 'Board minutes; the treasurer confirmed the password');
  perform public.release_quarantined_file('receipt', v_receipt, 'Vendor sends zipped receipts');
  select * into v_bucket, v_path from public.purge_quarantined_file('document', v_virus);
  perform tests.clear_auth(); reset role;

  select scan_status, scan_note, quarantined_at into v_row from public.document where id = v_encrypted;
  perform tests.ok(v_row.scan_status = 'clean' and v_row.quarantined_at is null
      and v_row.scan_note like 'Released by an administrator%Heuristics.Encrypted.PDF%',
    format('the password-protected file is released and says why (%s)', v_row.scan_note));
  perform tests.ok((select scan_status from public.finance_receipt where id = v_receipt) = 'clean',
    'a receipt can be released the same way');
  perform tests.ok(v_bucket = 'documents' and v_path = v_org || '/' || v_staff || '/q2/eicar.txt',
    'the deletion returns the stored file for the server to remove');
  select scan_status, scan_note into v_row from public.document where id = v_virus;
  perform tests.ok(v_row.scan_status = 'quarantined' and v_row.scan_note like 'Deleted by an administrator%',
    format('a deleted file stays quarantined and says it was deleted (%s)', v_row.scan_note));
  perform tests.ok(
    (select count(*) from audit_event where organization_id = v_org and actor_id = v_admin
       and action = 'quarantine_released' and object_id in (v_encrypted, v_receipt)) = 2
    and exists (select 1 from audit_event where actor_id = v_admin and action = 'quarantine_purged'
                  and object_id = v_virus and metadata ->> 'signature' = 'Eicar-Test-Signature'),
    'every release and deletion is in the audit log with its signature');
end;
$$;

rollback;
