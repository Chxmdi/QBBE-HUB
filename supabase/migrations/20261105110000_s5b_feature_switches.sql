-- Workspace OS stream S5b (native objects): one switch per module, all off
-- (epic #199). Same shape and rules as 20261101000100: organization-less rows
-- every member can read and nobody signed in can change
-- (20261101000300_feature_flag_workspace_rows_locked). Each module stays
-- hidden until its switch is turned on; turning it off is the rollback.
--
-- `on conflict do nothing` keeps a switch somebody has already turned on.

insert into public.feature_flag (key, enabled, description) values
  ('wos_meetings_v2', false, 'Workspace OS: meetings as objects with captures and an end-of-meeting review.'),
  ('wos_decisions_v2', false, 'Workspace OS: decisions with the full record, revisit reminders and a decision trail.'),
  ('wos_goals', false, 'Workspace OS: goals linked to projects and outcome metrics.'),
  ('wos_mobile', false, 'Workspace OS: phone screens (capture, today, inbox, tasks, search, approvals).'),
  ('wos_object_approvals', false, 'Workspace OS: approvals on any object.')
on conflict (key) do nothing;
