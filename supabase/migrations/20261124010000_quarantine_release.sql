-- Quarantined uploads can be explained, released or deleted.
--
-- A file the scanner quarantined stayed that way for good: the uploader was
-- not told why, and nothing in the app or the database could release a false
-- positive or remove the bytes. ClamAV quarantines password-protected PDFs
-- and archives by heuristic (Heuristics.Encrypted.*) as well as real
-- viruses, so an ordinary locked PDF was stuck for ever.
--
-- The scan jobs now store the scanner's verdict name in scan_note.
-- release_quarantined_file lets an owner or administrator with the second
-- factor release a password-protected PDF (Heuristics.Encrypted.PDF, never
-- a virus or any other heuristic) with a reason; purge_quarantined_file records the deletion of a quarantined or
-- oversized file and returns where its bytes are, which the server then
-- removes from storage. Both are audited. The scan-result guards on
-- documents, receipts and signing documents let through only the row a
-- release or deletion names, through a token in a private table for that
-- transaction (no session setting a caller could forge), and only a change
-- to the scan columns.

create table app.quarantine_release_token (
  txid bigint not null,
  target text not null,
  primary key (txid, target)
);
alter table app.quarantine_release_token enable row level security;
revoke all on table app.quarantine_release_token from public, anon, authenticated;

-- True only inside a release or deletion of this row, in this transaction,
-- when nothing but the scan columns changes and the note is one of the two
-- those functions write.
create or replace function app.quarantine_release_allowed(p_table text, p_id uuid, p_old jsonb, p_new jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from app.quarantine_release_token t
      where t.txid = txid_current() and t.target = p_table || ':' || p_id::text
    )
    and (p_old - array['scan_status', 'scan_note', 'quarantined_at', 'updated_at'])
      = (p_new - array['scan_status', 'scan_note', 'quarantined_at', 'updated_at'])
    and (
      p_new ->> 'scan_note' like 'Released by an administrator; %'
      or p_new ->> 'scan_note' like 'Deleted by an administrator; %'
    );
$$;
revoke all on function app.quarantine_release_allowed(text, uuid, jsonb, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app.protect_document_scan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- An administrator's audited release or deletion of this one quarantined
  -- row (public.release_quarantined_file / purge_quarantined_file), which
  -- leaves a token for this transaction and row. Even then only the scan
  -- columns change, to a note those functions write.
  if tg_op = 'UPDATE' and app.quarantine_release_allowed(tg_table_name, old.id, to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;
  if current_setting('role', true) in ('authenticated', 'anon')
     or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.scan_status <> 'pending' or new.scan_note is not null
         or new.quarantined_at is not null or new.scan_attempted_at is not null then
        raise exception 'Scan results are server managed' using errcode = '42501';
      end if;
      if new.kind = 'file' and not exists (
        select 1 from storage.objects o where o.bucket_id = 'documents'
          and o.name = new.storage_path and o.owner_id = auth.uid()::text
      ) then raise exception 'Upload ownership required' using errcode = '42501'; end if;
    else
      if (new.scan_status, new.scan_note, new.quarantined_at, new.scan_attempted_at,
          new.storage_path, new.kind) is distinct from
         (old.scan_status, old.scan_note, old.quarantined_at, old.scan_attempted_at,
          old.storage_path, old.kind) then
        raise exception 'File identity and scan results are server managed' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.protect_finance_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  -- An administrator's audited release or deletion of this one quarantined
  -- row (public.release_quarantined_file / purge_quarantined_file), which
  -- leaves a token for this transaction and row. Even then only the scan
  -- columns change, to a note those functions write.
  if tg_op = 'UPDATE' and app.quarantine_release_allowed(tg_table_name, old.id, to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;
  if current_setting('role', true) in ('authenticated', 'anon')
     or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.scan_status <> 'pending' or new.scan_note is not null
         or new.quarantined_at is not null or new.scan_attempted_at is not null then
        raise exception 'Scan results are server managed' using errcode = '42501';
      end if;
      if new.status <> 'submitted' or new.reviewed_by is not null or new.reviewed_at is not null then
        raise exception 'A new receipt starts unreviewed' using errcode = '42501';
      end if;
      -- The file must be the caller's own upload into this organization's
      -- folder of the receipts bucket.
      if split_part(new.storage_path, '/', 1) <> new.organization_id::text
         or split_part(new.storage_path, '/', 2) <> auth.uid()::text then
        raise exception 'Upload path does not match the receipt' using errcode = '42501';
      end if;
      if not exists (
        select 1 from storage.objects o where o.bucket_id = 'receipts'
          and o.name = new.storage_path and o.owner_id = auth.uid()::text
      ) then
        raise exception 'Upload ownership required' using errcode = '42501';
      end if;
    else
      if (new.organization_id, new.submitted_by, new.storage_path, new.file_name,
          new.mime_type, new.size_bytes, new.scan_status, new.scan_note,
          new.scan_attempted_at, new.quarantined_at, new.created_at)
         is distinct from
         (old.organization_id, old.submitted_by, old.storage_path, old.file_name,
          old.mime_type, old.size_bytes, old.scan_status, old.scan_note,
          old.scan_attempted_at, old.quarantined_at, old.created_at) then
        raise exception 'The file, its scan and its submitter are server managed' using errcode = '42501';
      end if;
      -- Only an admin changes the review state, and the record of who did it
      -- is written here, not taken from the request.
      if new.status is distinct from old.status then
        if not app.is_org_admin(old.organization_id) then
          raise exception 'Only finance administrators review receipts' using errcode = '42501';
        end if;
        if new.status = 'reviewed' then
          new.reviewed_by := auth.uid();
          new.reviewed_at := now();
        else
          new.reviewed_by := null;
          new.reviewed_at := null;
        end if;
      elsif (new.reviewed_by, new.reviewed_at) is distinct from (old.reviewed_by, old.reviewed_at) then
        raise exception 'Review fields are server managed' using errcode = '42501';
      end if;
    end if;
  end if;
  -- Program and project must belong to the receipt's organization, and the
  -- project to the program when both are given.
  if new.program_id is not null and not exists (
    select 1 from public.program p where p.id = new.program_id and p.organization_id = new.organization_id
  ) then
    raise exception 'Program is not in this organization' using errcode = '23514';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.project p where p.id = new.project_id and p.organization_id = new.organization_id
      and (new.program_id is null or p.program_id is not distinct from new.program_id)
  ) then
    raise exception 'Project is not in this organization or program' using errcode = '23514';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.protect_signing_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- An administrator's audited release or deletion of this one quarantined
  -- row (public.release_quarantined_file / purge_quarantined_file), which
  -- leaves a token for this transaction and row. Even then only the scan
  -- columns change, to a note those functions write.
  if tg_op = 'UPDATE' and app.quarantine_release_allowed(tg_table_name, old.id, to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;
  if current_setting('role', true) in ('authenticated', 'anon')
     or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon') then
    if tg_op <> 'INSERT' then
      raise exception 'Documents sent for signature are server managed' using errcode = '42501';
    end if;
    new.uploaded_by := auth.uid();
    new.created_at := now();
    if new.scan_status <> 'pending' or new.scan_note is not null or new.quarantined_at is not null
       or new.scan_attempted_at is not null or new.content_sha256 is not null then
      raise exception 'Scan results and the file hash are server managed' using errcode = '42501';
    end if;
    if split_part(new.storage_path, '/', 1) <> new.organization_id::text
       or split_part(new.storage_path, '/', 2) <> auth.uid()::text then
      raise exception 'Upload path does not match the document' using errcode = '42501';
    end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'signing-documents'
        and o.name = new.storage_path and o.owner_id = auth.uid()::text
    ) then
      raise exception 'Upload ownership required' using errcode = '42501';
    end if;
    select (o.metadata->>'size')::bigint into new.size_bytes from storage.objects o
    where o.bucket_id = 'signing-documents' and o.name = new.storage_path;
  elsif tg_op = 'UPDATE' then
    -- Even the scanning job cannot change what was signed.
    if (new.organization_id, new.storage_path, new.uploaded_by, new.created_at)
       is distinct from (old.organization_id, old.storage_path, old.uploaded_by, old.created_at)
       or (old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256) then
      raise exception 'A document''s file and hash never change' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function app.quarantine_target(p_kind text, out tbl text, out bucket text)
language sql
immutable
set search_path = ''
as $$
  select t.tbl, t.bucket from (values
    ('document', 'document', 'documents'),
    ('receipt', 'finance_receipt', 'receipts'),
    ('form_file', 'form_file', 'form-files'),
    ('signing_document', 'signing_document', 'signing-documents')
  ) as t(kind, tbl, bucket)
  where t.kind = p_kind;
$$;
revoke all on function app.quarantine_target(text) from public, anon, authenticated;

create or replace function public.release_quarantined_file(p_kind text, p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target record;
  v_org uuid;
  v_status text;
  v_note text;
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]+', ' ', 'g'));
  v_count integer;
begin
  select * into v_target from app.quarantine_target(p_kind);
  if v_target.tbl is null then
    raise exception 'Unknown file kind' using errcode = '22023';
  end if;
  execute format('select organization_id, scan_status, scan_note from public.%I where id = $1', v_target.tbl)
    into v_org, v_status, v_note using p_id;
  if v_org is null or not app.is_org_admin(v_org) then
    raise exception 'Only an administrator of this organization can release a file' using errcode = '42501';
  end if;
  -- Only a password-protected PDF: ClamAV cannot read inside it, and the
  -- person who sent it can vouch for it. Other heuristics (archives too deep
  -- to scan, phishing, macros, broken executables) mean nothing was checked.
  if v_status <> 'quarantined' or coalesce(v_note, '') <> 'Heuristics.Encrypted.PDF' then
    raise exception 'Only a password-protected PDF can be released' using errcode = '22023';
  end if;
  if v_reason = '' or length(v_reason) > 500 then
    raise exception 'A release needs a reason of at most 500 characters' using errcode = '22023';
  end if;

  insert into app.quarantine_release_token (txid, target) values (txid_current(), v_target.tbl || ':' || p_id::text)
  on conflict do nothing;
  execute format(
    'update public.%I set scan_status = ''clean'', quarantined_at = null, scan_note = $2
     where id = $1 and scan_status = ''quarantined'' and scan_note = $3',
    v_target.tbl)
  using p_id, 'Released by an administrator; the scanner reported ' || v_note, v_note;
  get diagnostics v_count = row_count;
  delete from app.quarantine_release_token where txid = txid_current() and target = v_target.tbl || ':' || p_id::text;
  if v_count <> 1 then
    raise exception 'The file changed while it was being released' using errcode = '40001';
  end if;

  insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action, object_type, object_id, metadata)
  values (v_org, auth.uid(), 'user', 'documents', 'quarantine_released', p_kind, p_id,
          jsonb_build_object('signature', v_note, 'reason', v_reason));
end;
$$;
revoke all on function public.release_quarantined_file(text, uuid, text) from public, anon;
grant execute on function public.release_quarantined_file(text, uuid, text) to authenticated;

create or replace function public.purge_quarantined_file(p_kind text, p_id uuid)
returns table (bucket text, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target record;
  v_org uuid;
  v_status text;
  v_note text;
  v_path text;
  v_count integer;
begin
  select * into v_target from app.quarantine_target(p_kind);
  if v_target.tbl is null then
    raise exception 'Unknown file kind' using errcode = '22023';
  end if;
  execute format('select organization_id, scan_status, scan_note, storage_path from public.%I where id = $1', v_target.tbl)
    into v_org, v_status, v_note, v_path using p_id;
  if v_org is null or not app.is_org_admin(v_org) then
    raise exception 'Only an administrator of this organization can delete a file' using errcode = '42501';
  end if;
  if v_status not in ('quarantined', 'rejected') then
    raise exception 'Only a quarantined or rejected file can be deleted here' using errcode = '22023';
  end if;

  -- Deleting again (the storage removal failed) returns the path again.
  if coalesce(v_note, '') not like 'Deleted by an administrator%' then
    insert into app.quarantine_release_token (txid, target) values (txid_current(), v_target.tbl || ':' || p_id::text)
    on conflict do nothing;
    execute format(
      'update public.%I set scan_note = $2 where id = $1 and scan_status in (''quarantined'', ''rejected'')',
      v_target.tbl)
    using p_id, 'Deleted by an administrator; the scanner reported ' || coalesce(v_note, v_status);
    get diagnostics v_count = row_count;
    delete from app.quarantine_release_token where txid = txid_current() and target = v_target.tbl || ':' || p_id::text;
    if v_count <> 1 then
      raise exception 'The file changed while it was being deleted' using errcode = '40001';
    end if;
    insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action, object_type, object_id, metadata)
    values (v_org, auth.uid(), 'user', 'documents', 'quarantine_purged', p_kind, p_id,
            jsonb_build_object('signature', coalesce(v_note, v_status)));
  end if;

  bucket := v_target.bucket;
  storage_path := v_path;
  return next;
end;
$$;
revoke all on function public.purge_quarantined_file(text, uuid) from public, anon;
grant execute on function public.purge_quarantined_file(text, uuid) to authenticated;

-- The replaced guards are trigger functions only; nobody calls them.
revoke all on function app.protect_document_scan() from public, anon, authenticated;
revoke all on function app.protect_finance_receipt() from public, anon, authenticated;
revoke all on function app.protect_signing_document() from public, anon, authenticated;
