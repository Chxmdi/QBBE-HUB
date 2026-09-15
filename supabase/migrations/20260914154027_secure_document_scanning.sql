alter table public.document add column scan_attempted_at timestamptz;

-- Restrictive policy composes with every existing entitlement policy.
create policy documents_require_clean_scan on storage.objects
as restrictive for select to authenticated
using (bucket_id <> 'documents' or exists (
  select 1 from public.document d where d.storage_path = storage.objects.name
    and d.kind = 'file' and d.scan_status = 'clean' and d.archived_at is null
));

-- Users cannot self-certify scans, swap the scanned object, or register another
-- user's upload. The trigger needs Storage metadata access before scan release.
create or replace function app.protect_document_scan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
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
$$;
revoke all on function app.protect_document_scan() from public, anon, authenticated;
create trigger document_protect_scan before insert or update on public.document
for each row execute function app.protect_document_scan();

insert into public.job_definition(name, description, schedule, queue, enabled, batch_size, max_attempts)
values ('scan-documents', 'Scan quarantined uploads using the private ClamAV socket.',
  '* * * * *', null, true, 2, 3);
select cron.schedule('scan-documents', '* * * * *',
  $$select app.dispatch_job('scan-documents')$$);

-- A clean verdict belongs to immutable bytes. Untrusted callers must create a
-- new document to replace a file; retention uses the trusted service role.
create or replace function app.protect_scanned_object() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (current_setting('role', true) in ('authenticated', 'anon')
      or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon'))
     and old.bucket_id = 'documents' and exists (
       select 1 from public.document d where d.storage_path = old.name
     ) then
    raise exception 'Registered file bytes are immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app.protect_scanned_object() from public, anon, authenticated;
create trigger documents_immutable_bytes before update or delete on storage.objects
for each row execute function app.protect_scanned_object();

-- Let a client clean up only bytes it owns when document registration fails.
-- Registered objects remain governed by the scoped delete policy and the
-- immutability trigger above.
create policy "document owners delete unregistered uploads" on storage.objects
for delete to authenticated using (
  bucket_id = 'documents'
  and owner_id = (select auth.uid())::text
  and not exists (
    select 1 from public.document d where d.storage_path = storage.objects.name
  )
);
