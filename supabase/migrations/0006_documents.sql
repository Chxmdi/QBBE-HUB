-- Documents & Resources (Part II §10.15): QBBE operational files and links
-- attached to programs, projects, channels, meetings, CRM records, and
-- reports. Files live in a private Storage bucket; access follows the same
-- membership rules as the rest of the product (SEC-007).

create type document_kind as enum ('file', 'link');

create table document (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  title text not null,
  description text,
  kind document_kind not null default 'link',
  -- For kind='link': the external URL (QBBE-controlled Drive, etc.).
  -- For kind='file': the object path inside the private documents bucket.
  url text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  -- Context links: a document shows where it is used (§10.15 acceptance).
  program_id uuid references program (id) on delete set null,
  project_id uuid references project (id) on delete set null,
  channel_id uuid references channel (id) on delete set null,
  meeting_id uuid references meeting (id) on delete set null,
  crm_organization_id uuid references crm_organization (id) on delete set null,
  -- 'organization' = every active member; 'staff' = staff and above.
  visibility text not null default 'organization',
  owner_id uuid references user_profile (id),
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint document_target check (
    (kind = 'link' and url is not null)
    or (kind = 'file' and storage_path is not null)
  )
);
create index idx_document_org on document (organization_id, created_at desc);
create index idx_document_project on document (project_id);
create index idx_document_program on document (program_id);

create trigger trg_document_updated_at before update on document
  for each row execute function set_updated_at();

alter table document enable row level security;

create policy document_read on document for select using (
  app.is_staff() or (visibility = 'organization' and app.is_member())
);
create policy document_member_insert on document for insert with check (
  app.is_member() and created_by = auth.uid()
);
create policy document_update on document for update using (
  app.is_staff() or owner_id = auth.uid()
);
create policy document_delete on document for delete using (
  app.is_admin() or owner_id = auth.uid()
);

-- Private storage bucket. Retrieval goes through signed URLs generated
-- server-side; an obscure path is never treated as authorization (SEC-007).
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "documents read for active members"
  on storage.objects for select
  using (bucket_id = 'documents' and app.is_member());

create policy "documents upload for active members"
  on storage.objects for insert
  with check (bucket_id = 'documents' and app.is_member());

create policy "documents delete for staff"
  on storage.objects for delete
  using (bucket_id = 'documents' and app.is_staff());
