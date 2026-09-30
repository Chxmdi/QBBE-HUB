-- Workspace-wide feature switches can no longer be changed through the API.
--
-- feature_flag_admin_write (20260818082054) reads
--   using (organization_id is null or app.is_org_admin(organization_id))
-- and every switch is a workspace-wide row with organization_id null, so the
-- first half let any signed-in member, guests and volunteers included, turn
-- any switch on or off, add new ones or delete them: gmail_inbox,
-- notification_email, workflow_rules, and now the Workspace OS modules that
-- hide unfinished work. Found by supabase/tests/workspace-os-flags.sql.
--
-- A workspace-wide row has no organization to ask about, and "an admin of any
-- organization" is the check rls.sql forbids in policies. Nothing in the app
-- writes switches, so workspace-wide rows are now changed only where RLS does
-- not apply: the Supabase SQL editor or the service role, as the staging and
-- release runbooks already do. Organization rows keep app.is_org_admin.
-- Reading is unchanged.

drop policy if exists feature_flag_admin_write on public.feature_flag;
create policy feature_flag_admin_write on public.feature_flag
  for all to authenticated
  using (organization_id is not null and app.is_org_admin(organization_id))
  with check (organization_id is not null and app.is_org_admin(organization_id));
