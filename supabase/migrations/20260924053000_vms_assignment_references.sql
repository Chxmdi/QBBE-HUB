-- Minimal VMS assignment references.
--
-- The VMS remains the source of truth. Hub stores only enough assignment
-- metadata to show/compare the external assignment without creating or mutating
-- Hub tasks. Deleting a VMS link can never delete QBBE work records.

create table if not exists vms_assignment_reference (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id) on delete cascade,
  user_id uuid not null references user_profile(id) on delete cascade,
  external_assignment_id text not null,
  title text not null,
  status text not null default 'unknown'
    check (status in ('assigned','confirmed','completed','cancelled','unknown')),
  starts_at timestamptz,
  ends_at timestamptz,
  source_url text check (source_url is null or source_url ~ '^https://'),
  external_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_assignment_id)
);

create index if not exists idx_vms_assignment_user
  on vms_assignment_reference (organization_id, user_id, status);
create index if not exists idx_vms_assignment_seen
  on vms_assignment_reference (organization_id, last_seen_at desc);

alter table vms_assignment_reference enable row level security;

create policy vms_assignment_read on vms_assignment_reference
  for select to authenticated
  using (
    (app.is_org_member(organization_id) and user_id = auth.uid())
    or app.is_org_admin(organization_id)
  );

comment on table vms_assignment_reference is
  'Minimal references to VMS-owned assignments. Never a source of truth for QBBE Hub tasks.';
