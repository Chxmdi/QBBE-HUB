-- Units 9–13: notification email, Gmail/VMS boundaries, saved views,
-- workflows, project templates, calendar overlay, recurrence.
-- Tables ship with indexes + RLS in this same file (REP-004 / DB-003).

-- ---------------------------------------------------------------------------
-- Additive columns on existing tables
-- ---------------------------------------------------------------------------
alter table user_profile
  add column if not exists vms_id text;

alter table task
  add column if not exists recurrence_rule text,
  add column if not exists recurrence_anchor date;

create index if not exists idx_user_profile_vms on user_profile (vms_id)
  where vms_id is not null;

-- ---------------------------------------------------------------------------
-- Notification email delivery (P0-NOT-03, NTF-002, JOB)
-- ---------------------------------------------------------------------------
create table notification_delivery (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notification (id) on delete cascade,
  channel text not null default 'email',
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (notification_id, channel),
  unique (dedupe_key)
);
create index idx_notification_delivery_pending
  on notification_delivery (status, created_at)
  where status in ('pending', 'failed');

alter table notification_delivery enable row level security;

-- Recipients can see their own delivery rows; inserts happen from the
-- cron job (service role) so there is no member INSERT policy.
create policy notification_delivery_own on notification_delivery
  for select using (
    exists (
      select 1 from notification n
      where n.id = notification_id and n.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Integration secrets (server-only tokens — no SELECT for authenticated)
-- ---------------------------------------------------------------------------
create table integration_secret (
  connection_id uuid primary key references integration_connection (id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  sync_cursor text,
  updated_at timestamptz not null default now()
);

alter table integration_secret enable row level security;

-- Authenticated users may write their own tokens (OAuth callback) but
-- cannot read them back. Service role bypasses RLS for the sync job.
create policy integration_secret_insert on integration_secret
  for insert with check (
    exists (
      select 1 from integration_connection c
      where c.id = connection_id and c.user_id = auth.uid()
    )
  );
create policy integration_secret_update on integration_secret
  for update using (
    exists (
      select 1 from integration_connection c
      where c.id = connection_id and c.user_id = auth.uid()
    )
  );

-- Per-user Gmail connections (admin policy already covers org-level rows).
create policy integration_own on integration_connection
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create unique index if not exists uq_integration_org_provider_null_user
  on integration_connection (organization_id, provider)
  where user_id is null;

-- ---------------------------------------------------------------------------
-- Gmail metadata (not full bodies — SEC-006)
-- ---------------------------------------------------------------------------
create table gmail_message (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  connection_id uuid not null references integration_connection (id) on delete cascade,
  external_id text not null,
  thread_id text,
  subject text,
  snippet text,
  from_address text,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);
create index idx_gmail_message_user on gmail_message (user_id, received_at desc);

alter table gmail_message enable row level security;

create policy gmail_message_own on gmail_message
  for select using (user_id = auth.uid());
create policy gmail_message_own_write on gmail_message
  for insert with check (user_id = auth.uid());
create policy gmail_message_own_delete on gmail_message
  for delete using (user_id = auth.uid() or app.is_admin());

-- ---------------------------------------------------------------------------
-- Google Calendar overlay references (P1-CAL-03) — links, not copies
-- ---------------------------------------------------------------------------
create table calendar_event_link (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  connection_id uuid not null references integration_connection (id) on delete cascade,
  external_id text not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  html_link text,
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);
create index idx_calendar_event_link_user on calendar_event_link (user_id, starts_at);

alter table calendar_event_link enable row level security;

create policy calendar_event_link_own on calendar_event_link
  for select using (user_id = auth.uid());
create policy calendar_event_link_own_write on calendar_event_link
  for insert with check (user_id = auth.uid());
create policy calendar_event_link_own_delete on calendar_event_link
  for delete using (user_id = auth.uid() or app.is_admin());

-- ---------------------------------------------------------------------------
-- Saved views (P1-UX-08)
-- ---------------------------------------------------------------------------
create table saved_view (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  name text not null,
  path text not null default '/my-work',
  query jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_saved_view_user on saved_view (user_id, path);

alter table saved_view enable row level security;

create policy saved_view_own on saved_view
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Workflow rules (P1-WF)
-- ---------------------------------------------------------------------------
create table workflow_rule (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  trigger_event text not null,
  condition jsonb not null default '{}'::jsonb,
  action jsonb not null default '{}'::jsonb,
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table workflow_rule enable row level security;

create policy workflow_rule_read on workflow_rule for select using (app.is_member());
create policy workflow_rule_admin_write on workflow_rule
  for all using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- Project intake templates (P1-PRJ-06/07)
-- ---------------------------------------------------------------------------
create table project_template (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  name text not null,
  outcome text,
  default_stage text not null default 'planning',
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now()
);

alter table project_template enable row level security;

create policy project_template_read on project_template for select using (app.is_member());
create policy project_template_staff_write on project_template
  for all using (app.is_staff()) with check (app.is_staff());

-- ---------------------------------------------------------------------------
-- Feature flags for gated integrations (honest disconnected until live)
-- ---------------------------------------------------------------------------
insert into feature_flag (key, enabled, description) values
  ('notification_email', true, 'Queue critical notifications for email delivery (Mailpit locally).'),
  ('gmail_inbox', false, 'Gmail OAuth + unified inbox. Enable only after Google credentials exist.'),
  ('google_calendar_overlay', false, 'Google Calendar overlay. Requires the same OAuth app as Gmail.'),
  ('volunteer_vms', false, 'Volunteer Management System identity/availability references.'),
  ('workflow_rules', true, 'Admin-defined workflow rules evaluated on Hub events.')
on conflict (key) do nothing;
