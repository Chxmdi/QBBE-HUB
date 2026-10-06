-- Receipt and invoice capture (#142 v1, epic #139). From 2026-10-01 every
-- receipt and vendor invoice is kept digitally: a photo or PDF in a private
-- bucket, with the figures the accountant needs typed alongside it. The ledger
-- (#148) will read these rows; until then finance exports them as CSV.
--
-- Who sees what:
--   * any active staff member (and owner/admin with MFA) submits receipts and
--     sees their own;
--   * owners and admins with MFA (app.is_org_admin) see and review all of
--     their organization's receipts;
--   * volunteers and guests cannot submit or read any.
-- Files follow the documents rules (#35): uploaded into quarantine, released
-- for download only after the ClamAV job marks them clean, immutable once
-- registered, and never self-certified by the uploader.
-- Receipts are financial records, so nobody can delete one from the app;
-- retention and legal hold arrive with #146.

create table public.finance_receipt (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  submitted_by uuid not null default auth.uid() references public.user_profile (id),
  kind text not null default 'receipt' check (kind in ('receipt', 'bill')),
  document_date date not null,
  vendor text not null check (char_length(btrim(vendor)) between 1 and 200),
  -- Money in cents, never floats. Total includes taxes.
  total_cents bigint not null check (total_cents between 0 and 100000000000),
  gst_cents bigint not null default 0 check (gst_cents >= 0),
  qst_cents bigint not null default 0 check (qst_cents >= 0),
  program_id uuid references public.program (id) on delete set null,
  project_id uuid references public.project (id) on delete set null,
  note text check (note is null or char_length(note) <= 2000),
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text check (mime_type is null or char_length(mime_type) <= 200),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  scan_status text not null default 'pending'
    check (scan_status in ('pending', 'clean', 'quarantined', 'rejected')),
  scan_note text,
  scan_attempted_at timestamptz,
  quarantined_at timestamptz,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed')),
  reviewed_by uuid references public.user_profile (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_receipt_taxes_within_total check (gst_cents + qst_cents <= total_cents),
  constraint finance_receipt_review_recorded
    check ((status = 'reviewed') = (reviewed_by is not null and reviewed_at is not null))
);

create index idx_finance_receipt_org_date
  on public.finance_receipt (organization_id, document_date desc);
create index idx_finance_receipt_submitter
  on public.finance_receipt (submitted_by, created_at desc);
create index idx_finance_receipt_pending_scan
  on public.finance_receipt (scan_attempted_at nulls first)
  where scan_status = 'pending';

comment on table public.finance_receipt is
  'Receipts and vendor invoices captured digitally (#142). Financial records: never deleted from the app.';

alter table public.finance_receipt enable row level security;

create policy finance_receipt_read on public.finance_receipt
for select to authenticated using (
  (submitted_by = (select auth.uid()) and app.is_org_staff(organization_id))
  or app.is_org_admin(organization_id)
);

create policy finance_receipt_submit on public.finance_receipt
for insert to authenticated with check (
  submitted_by = (select auth.uid())
  and app.is_org_staff(organization_id)
);

-- The submitter may correct their own figures until finance has reviewed the
-- receipt; admins may correct any and mark it reviewed. The trigger below
-- keeps the file, the scan and the review fields out of reach.
create policy finance_receipt_update on public.finance_receipt
for update to authenticated
using (
  (submitted_by = (select auth.uid()) and status = 'submitted'
    and app.is_org_staff(organization_id))
  or app.is_org_admin(organization_id)
)
with check (
  (submitted_by = (select auth.uid()) and status = 'submitted'
    and app.is_org_staff(organization_id))
  or app.is_org_admin(organization_id)
);

grant select, insert, update on public.finance_receipt to authenticated;
grant all on public.finance_receipt to service_role;

create or replace function app.protect_finance_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
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
$$;
revoke all on function app.protect_finance_receipt() from public, anon, authenticated;
create trigger finance_receipt_protect before insert or update on public.finance_receipt
for each row execute function app.protect_finance_receipt();

-- ---------------------------------------------------------------------------
-- Storage: a private bucket of its own, so receipt files are never covered by
-- the documents library's organization-wide read policy.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 26214400,
        array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Paths are `<organization id>/<uploader id>/<random>/<file>`. Upload only
-- into your own folder of an organization where you may submit. The
-- organization is compared as text so a malformed path is refused, not an
-- error.
create policy "receipts upload own folder" on storage.objects
for insert to authenticated with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1 from public.organization_membership m
    where m.user_id = (select auth.uid())
      and m.organization_id::text = (storage.foldername(name))[1]
      and app.is_org_staff(m.organization_id)
  )
);

-- Download only a registered, clean file you may read the receipt of.
create policy "receipts read clean registered" on storage.objects
for select to authenticated using (
  bucket_id = 'receipts' and exists (
    select 1 from public.finance_receipt r
    where r.storage_path = storage.objects.name
      and r.scan_status = 'clean'
      and ((r.submitted_by = (select auth.uid()) and app.is_org_staff(r.organization_id))
           or app.is_org_admin(r.organization_id))
  )
);

-- Clean up your own upload when registering it failed. Registered files are
-- financial records and are never deleted from the app.
create policy "receipts delete own unregistered" on storage.objects
for delete to authenticated using (
  bucket_id = 'receipts'
  and owner_id = (select auth.uid())::text
  and not exists (select 1 from public.finance_receipt r where r.storage_path = storage.objects.name)
);

create or replace function app.protect_receipt_object() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (current_setting('role', true) in ('authenticated', 'anon')
      or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon'))
     and old.bucket_id = 'receipts' and exists (
       select 1 from public.finance_receipt r where r.storage_path = old.name
     ) then
    raise exception 'Registered receipt files are immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app.protect_receipt_object() from public, anon, authenticated;
create trigger receipts_immutable_bytes before update or delete on storage.objects
for each row execute function app.protect_receipt_object();

-- ---------------------------------------------------------------------------
-- Virus scanning, the same job as documents.
-- ---------------------------------------------------------------------------
insert into public.job_definition(name, description, schedule, queue, enabled, batch_size, max_attempts)
values ('scan-receipts', 'Scan quarantined receipt uploads using the private ClamAV socket.',
  '* * * * *', null, true, 2, 3)
on conflict (name) do nothing;
select cron.schedule('scan-receipts', '* * * * *',
  $$select app.dispatch_job('scan-receipts')$$);
