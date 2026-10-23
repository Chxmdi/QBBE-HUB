-- A person can have only so many uploads waiting (unregistered, or not yet
-- scanned) at once, unfinished multipart uploads count against both that
-- cap and the storage quota, and unfinished multipart uploads are expired
-- after 24 hours by the cleanup job once its switch is on (SEC-016).
-- Run after qa-users.sql and rls.sql. Rolled back.
begin;

create or replace function tests.try_upload_doc(p_as uuid, p_name text, p_size bigint)
returns boolean
language plpgsql
as $$
begin
  perform tests.authenticate(p_as, 'aal2');
  begin
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('documents', p_name, p_as::text, jsonb_build_object('size', p_size));
    perform tests.clear_auth();
    reset role;
    return true;
  exception when insufficient_privilege then
    perform tests.clear_auth();
    reset role;
    return false;
  end;
end;
$$;
grant execute on function tests.try_upload_doc(uuid, text, bigint) to authenticated;

do $$
declare
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_prefix text;
  v_cap integer := app.document_upload_outstanding_cap();
  v_doc uuid;
  n integer;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_staff limit 1;
  v_prefix := v_org || '/' || v_staff || '/';
  -- Start from nothing waiting, whatever earlier runs left (rolled back).
  update storage.objects set created_at = now() - interval '2 days'
  where bucket_id = 'documents' and (name like v_org || '/' || v_staff || '/%' or name like v_org || '/' || v_volunteer || '/%');
  delete from storage.s3_multipart_uploads where owner_id in (v_staff::text, v_volunteer::text);

  -- The cap: uploads waiting from the last day.
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  select 'documents', v_prefix || gen_random_uuid() || '/waiting.pdf', v_staff::text, '{"size": 1}'
  from generate_series(1, v_cap - 1);
  perform tests.ok(tests.try_upload_doc(v_staff, v_prefix || gen_random_uuid() || '/last.pdf', 1),
    'upload limits: an upload up to the cap of waiting files is accepted');
  perform tests.ok(not tests.try_upload_doc(v_staff, v_prefix || gen_random_uuid() || '/over.pdf', 1),
    'upload limits: one more waiting upload is refused');
  perform tests.ok(tests.try_upload_doc(v_volunteer, v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/v.pdf', 1),
    'upload limits: one person''s waiting files do not count against another''s');

  -- A file registered and scanned clean is no longer waiting.
  select name into v_prefix from storage.objects
  where name like v_org || '/' || v_staff || '/%' and name like '%/waiting.pdf' limit 1;
  insert into public.document (organization_id, title, kind, storage_path, owner_id, created_by)
    values (v_org, 'Scanned', 'file', v_prefix, v_staff, v_staff) returning id into v_doc;
  v_prefix := v_org || '/' || v_staff || '/';
  perform tests.ok(not tests.try_upload_doc(v_staff, v_prefix || gen_random_uuid() || '/still-waiting.pdf', 1),
    'upload limits: a registered file still waiting for its scan counts');
  update public.document set scan_status = 'clean' where id = v_doc;
  perform tests.ok(tests.try_upload_doc(v_staff, v_prefix || gen_random_uuid() || '/after-scan.pdf', 1),
    'upload limits: a file scanned clean stops counting as waiting');
  perform tests.ok(not tests.try_upload_doc(v_staff, v_prefix || gen_random_uuid() || '/over-again.pdf', 1),
    'upload limits: (back at the cap)');

  -- A registered file still waiting for its scan counts; files older than a
  -- day do not, so a scanner outage does not lock people out for good.
  update storage.objects set created_at = now() - interval '25 hours'
  where bucket_id = 'documents' and name like v_prefix || '%';
  perform tests.ok(tests.try_upload_doc(v_staff, v_prefix || gen_random_uuid() || '/next-day.pdf', 1),
    'upload limits: waiting files older than a day no longer count');

  -- Captures count like any other unregistered upload.
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  select 'documents', v_prefix || gen_random_uuid() || '/captured.jpg', v_staff::text, '{"size": 1}'
  from generate_series(1, v_cap);
  insert into public.capture_item (organization_id, owner_id, kind, title, storage_path, file_name)
  select v_org, v_staff, 'photo', 'Photo', o.name, 'captured.jpg'
  from storage.objects o where o.bucket_id = 'documents' and o.name like v_prefix || '%/captured.jpg';
  perform tests.ok(not tests.try_upload_doc(v_staff, v_prefix || gen_random_uuid() || '/after-captures.pdf', 1),
    'upload limits: captures waiting in the inbox count against the cap');
  update storage.objects set created_at = now() - interval '2 days'
  where bucket_id = 'documents' and name like v_prefix || '%/captured.jpg';

  -- Unfinished multipart uploads count against the cap and the quota.
  insert into storage.s3_multipart_uploads (id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at)
  select gen_random_uuid()::text, 0, 'sig', 'documents', v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/part.bin',
         '1', v_volunteer::text, now()
  from generate_series(1, v_cap);
  perform tests.ok(not tests.try_upload_doc(v_volunteer, v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/x.pdf', 1),
    'upload limits: unfinished multipart uploads count against the cap');
  update storage.s3_multipart_uploads set created_at = now() - interval '3 days' where owner_id = v_volunteer::text;
  perform tests.ok(tests.try_upload_doc(v_volunteer, v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/x2.pdf', 1),
    'upload limits: unfinished multipart uploads older than a day stop counting against the cap');
  delete from storage.s3_multipart_uploads where owner_id = v_volunteer::text;

  -- Many unfinished uploads on one name count like any others, all but one.
  v_prefix := v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/same.bin';
  insert into storage.s3_multipart_uploads (id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at)
  select gen_random_uuid()::text, 1024, 'sig', 'documents', v_prefix, '1', v_volunteer::text, now()
  from generate_series(1, v_cap + 5);
  perform tests.ok(not tests.try_upload_doc(v_volunteer, v_prefix, 1),
    'upload limits: unfinished uploads on the same name all count, but one');
  delete from storage.s3_multipart_uploads where owner_id = v_volunteer::text;
  insert into storage.s3_multipart_uploads (id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at)
  select gen_random_uuid()::text, app.document_upload_quota_bytes() / 2, 'sig', 'documents', v_prefix, '1', v_volunteer::text,
         now() - interval '2 days'
  from generate_series(1, 3);
  perform tests.ok(not tests.try_upload_doc(v_volunteer, v_prefix, 1),
    'upload limits: bytes of unfinished uploads on the same name all count, but one');
  delete from storage.s3_multipart_uploads where owner_id = v_volunteer::text;
  v_prefix := v_org || '/' || v_staff || '/';
  insert into storage.s3_multipart_uploads (id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at)
  values (gen_random_uuid()::text, app.document_upload_quota_bytes() - 10, 'sig', 'documents',
          v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/big.bin', '1', v_volunteer::text, now() - interval '2 days');
  perform tests.ok(not tests.try_upload_doc(v_volunteer, v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/y.pdf', 100),
    'upload limits: bytes of an unfinished multipart upload count against the quota');

  -- Expiry: unfinished multipart uploads older than 24 hours, in the four
  -- upload buckets, are counted while the switch is off and removed once on.
  insert into storage.s3_multipart_uploads (id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at) values
    ('expire-old-receipt', 5, 'sig', 'receipts', 'expire/old.pdf', '1', v_staff::text, now() - interval '30 hours'),
    ('expire-new-doc', 5, 'sig', 'documents', 'expire/new.pdf', '1', v_staff::text, now() - interval '1 hour');
  insert into storage.s3_multipart_uploads_parts (upload_id, size, part_number, bucket_id, key, etag, owner_id, version)
    values ('expire-old-receipt', 5, 1, 'receipts', 'expire/old.pdf', 'etag', v_staff::text, '1');
  select public.expire_unfinished_uploads(now() - interval '24 hours', 1000, false) into n;
  perform tests.ok(n >= 2, format('upload limits: unfinished uploads over a day old are counted (got %s)', n));
  perform tests.ok((select count(*) from storage.s3_multipart_uploads where id like 'expire-%') = 2,
    'upload limits: counting removes nothing');
  begin
    perform public.expire_unfinished_uploads(now() - interval '24 hours', 1000, true);
    perform tests.ok(false, 'upload limits: nothing is expired while the switch is off');
  exception when insufficient_privilege then
    perform tests.ok(exists (select 1 from storage.s3_multipart_uploads where id = 'expire-old-receipt'),
      'upload limits: nothing is expired while the switch is off');
  end;
  perform public.set_operator_switch('purge-unregistered-uploads', true);
  select public.expire_unfinished_uploads(now() - interval '24 hours', 1000, true) into n;
  perform tests.ok(n = 2
      and not exists (select 1 from storage.s3_multipart_uploads where id = 'expire-old-receipt')
      and not exists (select 1 from storage.s3_multipart_uploads_parts where upload_id = 'expire-old-receipt')
      and exists (select 1 from storage.s3_multipart_uploads where id = 'expire-new-doc'),
    'upload limits: expiring removes old unfinished uploads and their parts, and keeps recent ones');

  perform tests.ok(not exists (select 1 from pg_policies where schemaname = 'storage'
      and policyname = 'document owners delete unregistered uploads'),
    'upload limits: the older documents delete policy is gone');

  perform tests.ok(
    has_function_privilege('service_role', 'public.expire_unfinished_uploads(timestamptz, integer, boolean)', 'execute')
      and not has_function_privilege('authenticated', 'public.expire_unfinished_uploads(timestamptz, integer, boolean)', 'execute')
      and not has_function_privilege('anon', 'public.expire_unfinished_uploads(timestamptz, integer, boolean)', 'execute')
      and not has_function_privilege('authenticated', 'app.document_upload_outstanding_cap()', 'execute'),
    'upload limits: only the service role expires unfinished uploads');
end;
$$;

rollback;
