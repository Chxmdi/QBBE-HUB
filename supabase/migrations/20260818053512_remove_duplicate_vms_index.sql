-- `idx_user_profile_vms` was established when the VMS identity link was added.
-- Keep one equivalent partial index rather than doubling write and vacuum cost.
drop index if exists idx_user_profile_vms_sync;
