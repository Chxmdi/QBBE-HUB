-- The documents bucket takes uploads only under the uploader's own folder,
-- <organization id>/<user id>/, within a per-person quota; a file is
-- registered only by the person who uploaded it, who alone may discard it
-- until then; and uploads nobody
-- registered are listed for cleanup after 24 hours (SEC-016).
-- Run after qa-users.sql and rls.sql. Rolled back.
begin;

create or replace function tests.try_upload(p_as uuid, p_name text, p_size bigint default 10)
returns boolean
language plpgsql
as $$
begin
  perform tests.authenticate(p_as, 'aal2');
  begin
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('documents', p_name, p_as::text,
            case when p_size is null then null else jsonb_build_object('size', p_size) end);
    perform tests.clear_auth();
    reset role;
    return true;
  exception when insufficient_privilege or check_violation then
    perform tests.clear_auth();
    reset role;
    return false;
  end;
end;
$$;
grant execute on function tests.try_upload(uuid, text, bigint) to authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_other_org uuid;
  v_role record;
  v_mine text;
  v_quota bigint;
  v_doc uuid;
  n integer;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;
  insert into public.organization (name, slug) values ('Bucket scoping other org', 'bucket-scoping-other-org')
    returning id into v_other_org;

  for v_role in
    select * from (values (v_owner, 'owner'), (v_admin, 'admin'), (v_staff, 'staff'),
                          (v_volunteer, 'volunteer'), (v_guest, 'guest')) as r(id, label)
  loop
    v_mine := v_org || '/' || v_role.id || '/';
    perform tests.ok(tests.try_upload(v_role.id, v_mine || gen_random_uuid() || '/report.pdf'),
      format('documents bucket: %s uploads under their own folder', v_role.label));
    perform tests.ok(not tests.try_upload(v_role.id, gen_random_uuid() || '/report.pdf'),
      format('documents bucket: %s cannot upload outside any folder', v_role.label));
    perform tests.ok(not tests.try_upload(v_role.id,
        v_org || '/' || (case when v_role.id = v_staff then v_volunteer else v_staff end) || '/' || gen_random_uuid() || '/x.pdf'),
      format('documents bucket: %s cannot upload into another person''s folder', v_role.label));
    perform tests.ok(not tests.try_upload(v_role.id, v_other_org || '/' || v_role.id || '/' || gen_random_uuid() || '/x.pdf'),
      format('documents bucket: %s cannot upload into another organization', v_role.label));
    perform tests.ok(not tests.try_upload(v_role.id, v_mine || '../' || v_staff || '/x.pdf'),
      format('documents bucket: %s cannot climb out of their folder with ../', v_role.label));
    perform tests.ok(not tests.try_upload(v_role.id, v_mine || gen_random_uuid() || '/../../x.pdf'),
      format('documents bucket: %s cannot climb out from deeper down', v_role.label));
    perform tests.ok(not tests.try_upload(v_role.id, v_mine || '%2e%2e/' || gen_random_uuid() || '/x.pdf'),
      format('documents bucket: %s cannot use an encoded ../', v_role.label));
    perform tests.ok(not tests.try_upload(v_role.id, v_mine || gen_random_uuid() || '/..'),
      format('documents bucket: %s cannot name a file ..', v_role.label));
    perform tests.ok(not tests.try_upload(v_role.id, v_mine || gen_random_uuid() || '/a%2Fb.pdf'),
      format('documents bucket: %s cannot use encoded characters in a name', v_role.label));
  end loop;

  -- Someone outside the organization cannot upload into its folders at all.
  delete from organization_membership where user_id = v_guest and organization_id = v_org;
  perform tests.ok(not tests.try_upload(v_guest, v_org || '/' || v_guest || '/' || gen_random_uuid() || '/x.pdf'),
    'documents bucket: a former member cannot upload into the organization');

  -- The quota: what a person already stores in the organization, plus the
  -- new file, stays within it. The storage server checks once before the
  -- bytes arrive (no size yet) and again with the size.
  v_quota := app.document_upload_quota_bytes();
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('documents', v_org || '/' || v_staff || '/' || gen_random_uuid() || '/big.bin', v_staff::text,
          jsonb_build_object('size', v_quota - 100));
  perform tests.ok(tests.try_upload(v_staff, v_org || '/' || v_staff || '/' || gen_random_uuid() || '/small.pdf', 50),
    'documents quota: an upload that fits is accepted');
  perform tests.ok(not tests.try_upload(v_staff, v_org || '/' || v_staff || '/' || gen_random_uuid() || '/over.pdf', 1000),
    'documents quota: an upload past the quota is refused');
  perform tests.ok(tests.try_upload(v_volunteer, v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/v.pdf', 1000),
    'documents quota: one person''s files do not count against another''s');
  perform tests.ok(tests.try_upload(v_volunteer, v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/probe.pdf', null),
    'documents quota: the size-less check before the bytes arrive is let through');
  perform tests.authenticate(v_volunteer, 'aal2');
  begin
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('documents', v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/odd.pdf', v_volunteer::text,
            '{"size": "lots"}'::jsonb);
    perform tests.ok(false, 'documents quota: a size that is not a number is refused');
  exception when insufficient_privilege then
    perform tests.ok(true, 'documents quota: a size that is not a number is refused');
  end;
  perform tests.clear_auth();
  reset role;

  -- Only the uploader registers a file: a member cannot point a library
  -- record at someone else's upload to read it.
  v_mine := v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/theirs.pdf';
  insert into storage.objects (bucket_id, name, owner_id) values ('documents', v_mine, v_volunteer::text);
  perform tests.authenticate(v_staff, 'aal2');
  begin
    insert into public.document (organization_id, title, kind, storage_path, owner_id, created_by)
    values (v_org, 'Not mine', 'file', v_mine, v_staff, v_staff);
    perform tests.ok(false, 'documents registration: a member cannot register another person''s upload');
  exception when insufficient_privilege then
    perform tests.ok(true, 'documents registration: a member cannot register another person''s upload');
  end;
  begin
    insert into public.document (organization_id, title, kind, storage_path, owner_id, created_by)
    values (v_org, 'Nothing there', 'file', v_org || '/' || v_staff || '/' || gen_random_uuid() || '/none.pdf', v_staff, v_staff);
    perform tests.ok(false, 'documents registration: a path with no upload behind it is refused');
  exception when insufficient_privilege then
    perform tests.ok(true, 'documents registration: a path with no upload behind it is refused');
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.authenticate(v_volunteer, 'aal2');
  insert into public.document (organization_id, title, kind, storage_path, owner_id, created_by)
  values (v_org, 'Mine', 'file', v_mine, v_volunteer, v_volunteer) returning id into v_doc;
  perform tests.ok(v_doc is not null, 'documents registration: the uploader registers their own upload');
  perform tests.clear_auth();
  reset role;

  -- Unscanned bytes are never readable through the API, not even by their
  -- uploader. The server discards a person's own unregistered upload after
  -- asking the database whether it may.
  v_mine := v_org || '/' || v_staff || '/' || gen_random_uuid() || '/drop.pdf';
  insert into storage.objects (bucket_id, name, owner_id) values ('documents', v_mine, v_staff::text);
  perform tests.authenticate(v_staff, 'aal2');
  perform tests.ok((select count(*) from storage.objects where name = v_mine) = 0,
    'documents cleanup: an unregistered upload is not readable, by its uploader either');
  perform tests.ok(public.document_upload_discardable(v_mine),
    'documents cleanup: the uploader may discard their own unregistered upload');
  perform tests.clear_auth();
  reset role;
  perform tests.authenticate(v_volunteer, 'aal2');
  perform tests.ok(not public.document_upload_discardable(v_mine),
    'documents cleanup: nobody else may discard it');
  perform tests.clear_auth();
  reset role;

  -- Registered means registered, whether or not the uploader still sees the
  -- record: a file filed in a staff-only record stays out of their reach.
  v_mine := v_org || '/' || v_volunteer || '/' || gen_random_uuid() || '/filed.pdf';
  insert into storage.objects (bucket_id, name, owner_id) values ('documents', v_mine, v_volunteer::text);
  insert into public.document (organization_id, title, kind, storage_path, visibility, owner_id, created_by)
    values (v_org, 'Staff only now', 'file', v_mine, 'staff', v_admin, v_admin);
  perform tests.authenticate(v_volunteer, 'aal2');
  perform tests.ok((select count(*) from public.document where storage_path = v_mine) = 0,
    'documents registration: (the volunteer cannot see the staff-only record)');
  perform tests.ok(not public.document_upload_discardable(v_mine),
    'documents registration: a file registered in a record its uploader cannot see is not theirs to discard');
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'documents' and name = v_mine;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(exists (select 1 from storage.objects where name = v_mine),
    'documents registration: nor theirs to delete');
  perform tests.ok(
    has_function_privilege('authenticated', 'public.document_upload_discardable(text)', 'execute')
      and not has_function_privilege('anon', 'public.document_upload_discardable(text)', 'execute'),
    'documents cleanup: only signed-in people ask whether they may discard an upload');

  -- Uploads nobody registered are listed for cleanup once 24 hours old, in
  -- all four upload buckets; registered ones and recent ones never are.
  insert into storage.objects (bucket_id, name, owner_id, created_at) values
    ('documents', 'purge-test/old-orphan.pdf', v_staff::text, now() - interval '25 hours'),
    ('documents', 'purge-test/new-orphan.pdf', v_staff::text, now() - interval '1 hour'),
    ('documents', 'purge-test/old-registered.pdf', v_staff::text, now() - interval '25 hours'),
    ('documents', 'purge-test/old-captured.pdf', v_staff::text, now() - interval '25 hours'),
    ('documents', 'purge-test/old-dismissed.pdf', v_staff::text, now() - interval '25 hours'),
    ('receipts', 'purge-test/old-receipt.pdf', v_staff::text, now() - interval '25 hours'),
    ('form-files', 'purge-test/old-form-file.pdf', v_staff::text, now() - interval '25 hours'),
    ('signing-documents', 'purge-test/old-signing.pdf', v_staff::text, now() - interval '25 hours');
  insert into public.document (organization_id, title, kind, storage_path, owner_id, created_by)
    values (v_org, 'Registered', 'file', 'purge-test/old-registered.pdf', v_staff, v_staff);
  insert into public.capture_item (organization_id, owner_id, kind, title, storage_path, file_name)
    values (v_org, v_staff, 'file', 'Captured', 'purge-test/old-captured.pdf', 'old-captured.pdf');
  insert into public.capture_item (organization_id, owner_id, kind, title, storage_path, file_name, status)
    values (v_org, v_staff, 'file', 'Dismissed', 'purge-test/old-dismissed.pdf', 'old-dismissed.pdf', 'dismissed');

  select count(*) into n from public.unregistered_uploads(now() - interval '24 hours', 1000) u
  where u.name like 'purge-test/%';
  perform tests.ok(n = 5, format('documents cleanup: five old unregistered uploads are listed, a dismissed capture''s among them (got %s)', n));
  perform tests.ok(
    exists (select 1 from public.unregistered_uploads(now() - interval '24 hours', 1000) u
            where u.bucket_id = 'documents' and u.name = 'purge-test/old-orphan.pdf')
    and exists (select 1 from public.unregistered_uploads(now() - interval '24 hours', 1000) u
                where u.bucket_id = 'receipts' and u.name = 'purge-test/old-receipt.pdf')
    and exists (select 1 from public.unregistered_uploads(now() - interval '24 hours', 1000) u
                where u.bucket_id = 'form-files' and u.name = 'purge-test/old-form-file.pdf')
    and exists (select 1 from public.unregistered_uploads(now() - interval '24 hours', 1000) u
                where u.bucket_id = 'signing-documents' and u.name = 'purge-test/old-signing.pdf'),
    'documents cleanup: each upload bucket is covered');

  perform tests.ok(
    has_function_privilege('service_role', 'public.unregistered_uploads(timestamptz, integer)', 'execute')
      and not has_function_privilege('authenticated', 'public.unregistered_uploads(timestamptz, integer)', 'execute')
      and not has_function_privilege('anon', 'public.unregistered_uploads(timestamptz, integer)', 'execute'),
    'documents cleanup: only the service role lists unregistered uploads');
  perform tests.ok(exists (select 1 from job_definition where name = 'purge-unregistered-uploads')
      and exists (select 1 from cron.job where jobname = 'purge-unregistered-uploads'),
    'documents cleanup: the cleanup job is registered and scheduled');
end;
$$;

rollback;
