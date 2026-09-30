-- Workspace OS feature switches (W0-4, epic #199).
--
-- One switch per Workspace OS module, all off. Each module is merged into
-- `main` unfinished and stays invisible until its switch is turned on; turning
-- the switch back off is the rollback (workspace-os-plan.md section 2, rule 3).
--
-- They are organization-less rows, like the integration switches in
-- 0008_spec_delivery, so every signed-in member can read them and only
-- the SQL editor or the service role can change them (feature_flag_read,
-- 20261101000300_feature_flag_workspace_rows_locked).
--
-- Staging turns modules on without touching this table through the
-- WORKSPACE_OS_FLAGS environment variable (src/lib/feature-flags.ts,
-- docs/runbooks/staging-provisioning.md). Production never sets it.
--
-- `on conflict do nothing` keeps a switch somebody has already turned on.

insert into public.feature_flag (key, enabled, description) values
  ('wos_objects', false, 'Workspace OS: object registry, types, properties and relations.'),
  ('wos_spaces', false, 'Workspace OS: spaces, sharing and the unified access check.'),
  ('wos_pages', false, 'Workspace OS: pages and nested content.'),
  ('wos_editor', false, 'Workspace OS: block editor and semantic blocks.'),
  ('wos_lenses', false, 'Workspace OS: table, board, list and other lenses.'),
  ('wos_home', false, 'Workspace OS: Home, My World and attention.'),
  ('wos_capture', false, 'Workspace OS: capture inbox.'),
  ('wos_workflows_v2', false, 'Workspace OS: workflow engine with steps, branches and retries.'),
  ('wos_forms_v2', false, 'Workspace OS: forms that create objects of any type.'),
  ('wos_public_pages', false, 'Workspace OS: published read-only public pages.'),
  ('wos_offline', false, 'Workspace OS: offline changes synced when back online.')
on conflict (key) do nothing;
