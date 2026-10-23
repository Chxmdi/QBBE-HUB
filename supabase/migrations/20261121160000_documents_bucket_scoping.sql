-- The documents bucket takes uploads only under the uploader's own folder,
-- within a per-person quota, and uploads nobody registered are cleaned up
-- (SEC-016).
--
-- 1. Before this, any active member of any organization could upload any
--    object name into the documents bucket, of any total size. Uploads now
--    go to <organization id>/<user id>/<random id>/<file name>, in an
--    organization the uploader is an active member of, with plain names
--    only (no "." or ".." parts, no encoded characters), and only while the
--    person's files in that organization stay within
--    app.document_upload_quota_bytes(). The receipts, form-files and
--    signing-documents buckets already took uploads only in the uploader's
--    own folder.
--    The quota lives in the policy, not a trigger: on the hosted platform
--    the storage tables belong to the storage service, not to migrations.
--    The storage server checks the policy once before the bytes arrive
--    (no size yet) and again with the size.
-- 2. Whether a stored file is registered (has its record) was judged
--    through the caller's own view of the records, so a record hidden from
--    its uploader (they left, or it was restricted to staff) made the file
--    count as unregistered: theirs to read and delete. It is now judged
--    against every record, in the four upload buckets.
-- 3. A failed save or a dismissed capture discards its upload through the
--    server (discardOwnUpload), which checks it is the person's own and
--    unregistered; unregistered bytes stay unreadable through the API.
-- 4. Uploads nobody registered (a closed tab, a failed save) stayed for
--    good. The purge-unregistered-uploads job deletes them from the four
--    upload buckets once 24 hours old, through the storage API so the bytes
--    go too. public.unregistered_uploads lists them for it.

create or replace function app.document_upload_quota_bytes()
returns bigint
language sql
immutable
set search_path = ''
as $$
  -- 5 GiB per person per organization.
  select 5::bigint * 1024 * 1024 * 1024;
$$;
revoke all on function app.document_upload_quota_bytes() from public, anon, authenticated;

create or replace function app.document_upload_allowed(p_name text, p_metadata jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_parts text[] := string_to_array(p_name, '/');
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_size numeric := 0;
  v_used numeric;
begin
  if v_uid is null or p_name is null or coalesce(array_length(v_parts, 1), 0) <> 4 then
    return false;
  end if;
  if v_parts[1] !~ v_uuid or v_parts[2] <> v_uid::text or v_parts[3] !~ v_uuid
     or v_parts[4] !~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$' then
    return false;
  end if;
  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_parts[1]::uuid and m.user_id = v_uid and m.status = 'active'
  ) then
    return false;
  end if;
  -- One upload at a time per person and organization, so uploads side by
  -- side cannot each fit on their own and overshoot together.
  perform pg_advisory_xact_lock(hashtextextended('document-upload:' || v_parts[1] || '/' || v_parts[2], 0));
  if p_metadata ? 'size' then
    if jsonb_typeof(p_metadata -> 'size') <> 'number' then
      return false;
    end if;
    v_size := (p_metadata ->> 'size')::numeric;
    if v_size < 0 then
      return false;
    end if;
  end if;
  select coalesce(sum((o.metadata ->> 'size')::numeric) filter (where jsonb_typeof(o.metadata -> 'size') = 'number'), 0)
    into v_used
  from storage.objects o
  where o.bucket_id = 'documents'
    and o.name like v_parts[1] || '/' || v_parts[2] || '/%'
    and o.name <> p_name;
  return v_used + v_size <= app.document_upload_quota_bytes();
end;
$$;
revoke all on function app.document_upload_allowed(text, jsonb) from public, anon;
grant execute on function app.document_upload_allowed(text, jsonb) to authenticated;

drop policy if exists "documents upload for entitled members" on storage.objects;
create policy "documents upload for entitled members" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'documents'
  and owner_id = (select auth.uid())::text
  and app.document_upload_allowed(name, metadata)
);

-- 2. Registered, judged against every record, not the caller's view.
create or replace function app.storage_object_registered(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_bucket
    when 'documents' then
      exists (select 1 from public.document d where d.storage_path = p_name)
    when 'receipts' then
      exists (select 1 from public.finance_receipt r where r.storage_path = p_name)
    when 'form-files' then
      exists (select 1 from public.form_file f where f.storage_path = p_name)
    when 'signing-documents' then
      exists (select 1 from public.signing_document s where s.storage_path = p_name)
    else true
  end;
$$;
revoke all on function app.storage_object_registered(text, text) from public, anon;
grant execute on function app.storage_object_registered(text, text) to authenticated, service_role;

drop policy if exists "Document owners delete unregistered uploads" on storage.objects;
create policy "Document owners delete unregistered uploads" on storage.objects
for delete to authenticated
using (
  bucket_id = 'documents'
  and owner_id = (select auth.uid())::text
  and not app.storage_object_registered(bucket_id, name)
);

drop policy if exists "receipts delete own unregistered" on storage.objects;
create policy "receipts delete own unregistered" on storage.objects
for delete to authenticated
using (
  bucket_id = 'receipts'
  and owner_id = (select auth.uid())::text
  and not app.storage_object_registered(bucket_id, name)
);
drop policy if exists "receipts read own unregistered" on storage.objects;
create policy "receipts read own unregistered" on storage.objects
for select to authenticated
using (
  bucket_id = 'receipts'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and not app.storage_object_registered(bucket_id, name)
);

drop policy if exists "form files delete own unregistered" on storage.objects;
create policy "form files delete own unregistered" on storage.objects
for delete to authenticated
using (
  bucket_id = 'form-files'
  and owner_id = (select auth.uid())::text
  and not app.storage_object_registered(bucket_id, name)
);
drop policy if exists "form files read own unregistered" on storage.objects;
create policy "form files read own unregistered" on storage.objects
for select to authenticated
using (
  bucket_id = 'form-files'
  and owner_id = (select auth.uid())::text
  and not app.storage_object_registered(bucket_id, name)
);

drop policy if exists "signing documents delete own unregistered" on storage.objects;
create policy "signing documents delete own unregistered" on storage.objects
for delete to authenticated
using (
  bucket_id = 'signing-documents'
  and owner_id = (select auth.uid())::text
  and not app.storage_object_registered(bucket_id, name)
);
drop policy if exists "signing documents read own unregistered" on storage.objects;
create policy "signing documents read own unregistered" on storage.objects
for select to authenticated
using (
  bucket_id = 'signing-documents'
  and owner_id = (select auth.uid())::text
  and not app.storage_object_registered(bucket_id, name)
);

-- 3. Whether the signed-in person may discard an upload: their own, in the
--    documents bucket, and registered nowhere. The server then removes it.
create or replace function public.document_upload_discardable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'documents' and o.name = p_name and o.owner_id = auth.uid()::text
  ) and not app.storage_object_registered('documents', p_name);
$$;
revoke all on function public.document_upload_discardable(text) from public, anon, authenticated, service_role;
grant execute on function public.document_upload_discardable(text) to authenticated;

-- 4. Cleanup of uploads nobody registered. A capture keeps its file only
--    until it is dismissed.
create or replace function public.unregistered_uploads(p_before timestamptz, p_limit integer)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id in ('documents', 'receipts', 'form-files', 'signing-documents')
    and o.created_at < p_before
    and not app.storage_object_registered(o.bucket_id, o.name)
    and not (o.bucket_id = 'documents' and exists (
      select 1 from public.capture_item c where c.storage_path = o.name and c.status <> 'dismissed'
    ))
  order by o.created_at, o.bucket_id, o.name
  limit greatest(coalesce(p_limit, 0), 0);
$$;
revoke all on function public.unregistered_uploads(timestamptz, integer) from public, anon, authenticated, service_role;
grant execute on function public.unregistered_uploads(timestamptz, integer) to service_role;

insert into public.job_definition (name, description, schedule, queue, batch_size, max_attempts)
values ('purge-unregistered-uploads',
        'Deletes uploads nobody registered, from the four upload buckets, once 24 hours old.',
        '23 * * * *', null, 200, 3)
on conflict (name) do nothing;

do $$
begin
  perform cron.unschedule('purge-unregistered-uploads')
    where exists (select 1 from cron.job where jobname = 'purge-unregistered-uploads');
  perform cron.schedule('purge-unregistered-uploads', '23 * * * *',
    format('select app.dispatch_job(%L)', 'purge-unregistered-uploads'));
end;
$$;
