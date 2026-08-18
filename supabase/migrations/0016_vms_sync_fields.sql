-- VMS remains the system of record; Hub stores only a linked external id and
-- current availability needed for assignment/workload decisions.
alter table user_profile
  add column if not exists vms_availability text not null default 'unknown'
    check (vms_availability in ('available', 'unavailable', 'unknown')),
  add column if not exists vms_synced_at timestamptz;

create index if not exists idx_user_profile_vms_sync
  on user_profile (vms_id) where vms_id is not null;
