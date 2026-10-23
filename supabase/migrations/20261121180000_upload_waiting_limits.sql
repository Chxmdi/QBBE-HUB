-- Limits on uploads waiting in the documents bucket, and expiry of
-- unfinished multipart uploads (SEC-016 follow-up).
--
-- 1. A person may have at most app.document_upload_outstanding_cap() uploads
--    from the last day waiting in an organization: not registered (captures
--    included), or not yet scanned, or multipart uploads not finished. The upload policy refuses more. Uploads older
--    than a day stop counting, so a scanner outage does not lock anyone out
--    for good.
-- 2. The bytes of every unfinished multipart upload count against the quota.
-- 3. Unfinished multipart uploads older than 24 hours, in the four upload
--    buckets, are counted by the purge-unregistered-uploads job and, once
--    its operator switch is on, their upload records are removed
--    (public.expire_unfinished_uploads), so they can no longer be finished
--    or count. Parts already sent stay in the storage backend; the Hub
--    does not use multipart uploads, and the runbook turns that way of
--    uploading off. Resumable uploads expire on the storage server's side.
-- 4. An older delete policy for the documents bucket, under a name that
--    differs only in case, still judged "registered" through the caller's
--    own view of the records. It is dropped; the replacement stays.

create or replace function app.document_upload_outstanding_cap()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 50;
$$;
revoke all on function app.document_upload_outstanding_cap() from public, anon, authenticated;

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
  v_prefix text;
  v_waiting integer;
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
  v_prefix := v_parts[1] || '/' || v_parts[2] || '/';

  -- Waiting uploads from the last day: not registered, or registered and
  -- not yet scanned, plus unfinished multipart uploads. Older ones stop
  -- counting, so a scanner outage does not lock anyone out for good.
  select count(*) into v_waiting
  from storage.objects o
  where o.bucket_id = 'documents'
    and o.name like v_prefix || '%'
    and o.name <> p_name
    and o.created_at > now() - interval '24 hours'
    and (
      not app.storage_object_registered('documents', o.name)
      or exists (select 1 from public.document d where d.storage_path = o.name and d.scan_status = 'pending')
    );
  -- Every unfinished upload counts, but the caller's own: one on this name.
  v_waiting := v_waiting + greatest((
    select count(*) - least(count(*) filter (where u.key = p_name), 1)
    from storage.s3_multipart_uploads u
    where u.bucket_id = 'documents' and u.key like v_prefix || '%'
      and u.created_at > now() - interval '24 hours'
  ), 0);
  if v_waiting >= app.document_upload_outstanding_cap() then
    return false;
  end if;

  -- The quota counts stored files and the bytes of unfinished multipart uploads.
  select coalesce(sum((o.metadata ->> 'size')::numeric) filter (where jsonb_typeof(o.metadata -> 'size') = 'number'), 0)
    into v_used
  from storage.objects o
  where o.bucket_id = 'documents'
    and o.name like v_prefix || '%'
    and o.name <> p_name;
  v_used := v_used + coalesce((
    select sum(u.in_progress_size) - coalesce(max(u.in_progress_size) filter (where u.key = p_name), 0)
    from storage.s3_multipart_uploads u
    where u.bucket_id = 'documents' and u.key like v_prefix || '%'
  ), 0);
  return v_used + v_size <= app.document_upload_quota_bytes();
end;
$$;
revoke all on function app.document_upload_allowed(text, jsonb) from public, anon;
grant execute on function app.document_upload_allowed(text, jsonb) to authenticated;

create or replace function public.expire_unfinished_uploads(p_before timestamptz, p_limit integer, p_apply boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids text[];
begin
  if not coalesce(p_apply, false) then
    -- The report counts them all.
    return (select count(*) from storage.s3_multipart_uploads u
            where u.bucket_id in ('documents', 'receipts', 'form-files', 'signing-documents')
              and u.created_at < p_before);
  end if;
  if not coalesce((select s.enabled from public.operator_switch s where s.name = 'purge-unregistered-uploads'), false) then
    raise exception 'The purge-unregistered-uploads switch is off' using errcode = '42501';
  end if;
  select array_agg(u.id) into v_ids
  from (
    select u.id from storage.s3_multipart_uploads u
    where u.bucket_id in ('documents', 'receipts', 'form-files', 'signing-documents')
      and u.created_at < p_before
    order by u.created_at, u.id
    limit greatest(coalesce(p_limit, 0), 0)
  ) u;
  if v_ids is null then
    return 0;
  end if;
  -- Their part records go with them (on delete cascade).
  delete from storage.s3_multipart_uploads where id = any (v_ids);
  return cardinality(v_ids);
end;
$$;
revoke all on function public.expire_unfinished_uploads(timestamptz, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.expire_unfinished_uploads(timestamptz, integer, boolean) to service_role;

drop policy if exists "document owners delete unregistered uploads" on storage.objects;

update public.job_definition
set description = 'Reports uploads nobody registered, and unfinished multipart uploads, older than 24 hours in the four upload buckets; removes them once the purge-unregistered-uploads operator switch is on.'
where name = 'purge-unregistered-uploads';
