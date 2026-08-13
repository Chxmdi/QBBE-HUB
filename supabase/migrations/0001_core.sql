-- QBBE Hub — core schema: identity, programs, projects, work, activity, audit.
-- Conventions (DB-001..DB-007): UUID PKs, timestamptz in UTC, snake_case,
-- explicit FKs, RLS deny-by-default on every user-facing table.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type org_role as enum ('owner', 'admin', 'staff', 'volunteer', 'guest');
create type membership_status as enum ('active', 'invited', 'deactivated');
create type program_status as enum ('active', 'paused', 'archived');
create type project_stage as enum (
  'proposed', 'approved', 'planning', 'active', 'paused',
  'completed', 'cancelled', 'archived'
);
create type project_health as enum ('on_track', 'at_risk', 'off_track', 'paused', 'unknown');
create type task_status as enum (
  'not_started', 'ready', 'in_progress', 'waiting', 'blocked',
  'in_review', 'completed', 'cancelled'
);
create type task_priority as enum ('low', 'medium', 'high', 'critical');

-- ---------------------------------------------------------------------------
-- Identity & access
-- ---------------------------------------------------------------------------
create table organization (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/Toronto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_profile (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  avatar_url text,
  title text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organization_membership (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  role org_role not null default 'staff',
  status membership_status not null default 'active',
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index idx_org_membership_user on organization_membership (user_id, status);

create table invitation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  email text not null,
  intended_role org_role not null default 'staff',
  invited_by uuid not null references user_profile (id),
  token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_invitation_email on invitation (email);

create table team (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table team_member (
  team_id uuid not null references team (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Programs
-- ---------------------------------------------------------------------------
create table program (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  lead_id uuid references user_profile (id),
  status program_status not null default 'active',
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, slug)
);

create table program_membership (
  program_id uuid not null references program (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (program_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Projects & work
-- ---------------------------------------------------------------------------
create table project (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  program_id uuid references program (id) on delete set null,
  name text not null,
  outcome text,
  description text,
  owner_id uuid references user_profile (id),
  stage project_stage not null default 'proposed',
  health project_health not null default 'unknown',
  health_reason text,
  start_date date,
  target_date date,
  completed_at timestamptz,
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index idx_project_org_stage on project (organization_id, stage);
create index idx_project_program on project (program_id);

create table project_membership (
  project_id uuid not null references project (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table milestone (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id) on delete cascade,
  name text not null,
  due_date date,
  completed_at timestamptz,
  sort_key double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_milestone_project on milestone (project_id, due_date);

create table task (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  program_id uuid references program (id) on delete set null,
  project_id uuid references project (id) on delete cascade,
  milestone_id uuid references milestone (id) on delete set null,
  title text not null,
  description text,
  status task_status not null default 'not_started',
  priority task_priority not null default 'medium',
  assignee_id uuid references user_profile (id),
  requester_id uuid references user_profile (id),
  reviewer_id uuid references user_profile (id),
  start_at date,
  due_at date,
  estimate_hours numeric(6, 2),
  blocked_reason text,
  sort_key double precision not null default 0,
  source_message_id uuid, -- FK added after message table exists
  completed_at timestamptz,
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  -- Blocked work requires an explanation (business rule §19).
  constraint blocked_requires_reason
    check (status <> 'blocked' or blocked_reason is not null)
);
create index idx_task_org_assignee on task (organization_id, assignee_id, status, due_at);
create index idx_task_project on task (project_id, status, sort_key);
create index idx_task_due on task (organization_id, status, due_at);

create table task_dependency (
  blocking_task_id uuid not null references task (id) on delete cascade,
  blocked_task_id uuid not null references task (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocking_task_id, blocked_task_id),
  constraint no_self_dependency check (blocking_task_id <> blocked_task_id)
);

create table checklist_item (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task (id) on delete cascade,
  title text not null,
  completed_at timestamptz,
  sort_key double precision not null default 0,
  created_at timestamptz not null default now()
);

create table label (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  name text not null,
  color text not null default 'neutral',
  unique (organization_id, name)
);

create table task_label (
  task_id uuid not null references task (id) on delete cascade,
  label_id uuid not null references label (id) on delete cascade,
  primary key (task_id, label_id)
);

create table task_comment (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task (id) on delete cascade,
  author_id uuid not null references user_profile (id),
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index idx_task_comment_task on task_comment (task_id, created_at);

create table project_status_update (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id) on delete cascade,
  author_id uuid not null references user_profile (id),
  health project_health not null,
  progress_summary text not null,
  next_steps text,
  blockers text,
  decisions_needed text,
  help_requested text,
  created_at timestamptz not null default now()
);
create index idx_status_update_project on project_status_update (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Activity (user-facing history) and audit (security evidence) — kept
-- separate per DB-006.
-- ---------------------------------------------------------------------------
create table activity_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  actor_id uuid references user_profile (id),
  verb text not null, -- created | updated | completed | commented | ...
  source_type text not null, -- task | project | program | meeting | ...
  source_id uuid not null,
  project_id uuid references project (id) on delete cascade,
  program_id uuid references program (id) on delete cascade,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_activity_source on activity_event (source_type, source_id, created_at desc);
create index idx_activity_org on activity_event (organization_id, created_at desc);
create index idx_activity_project on activity_event (project_id, created_at desc);

create table audit_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organization (id) on delete cascade,
  actor_id uuid,
  actor_type text not null default 'user',
  event_type text not null,
  action text not null,
  result text not null default 'success',
  object_type text,
  object_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_org on audit_event (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'organization', 'user_profile', 'organization_membership', 'team',
    'program', 'project', 'milestone', 'task'
  ]
  loop
    execute format(
      'create trigger trg_%s_updated_at before update on %I
       for each row execute function set_updated_at()', t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Authorization helpers (AUTH-009): centralized predicates used by RLS.
-- SECURITY DEFINER avoids recursive policy evaluation; search_path pinned.
-- ---------------------------------------------------------------------------
create schema if not exists app;

create or replace function app.is_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_membership m
    where m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function app.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_membership m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function app.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_membership m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'staff')
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security — deny by default (DB-003). Read access for active
-- organization members on operational records; write access constrained to
-- staff and record owners; admin operations restricted to admins.
-- ---------------------------------------------------------------------------
alter table organization enable row level security;
alter table user_profile enable row level security;
alter table organization_membership enable row level security;
alter table invitation enable row level security;
alter table team enable row level security;
alter table team_member enable row level security;
alter table program enable row level security;
alter table program_membership enable row level security;
alter table project enable row level security;
alter table project_membership enable row level security;
alter table milestone enable row level security;
alter table task enable row level security;
alter table task_dependency enable row level security;
alter table checklist_item enable row level security;
alter table label enable row level security;
alter table task_label enable row level security;
alter table task_comment enable row level security;
alter table project_status_update enable row level security;
alter table activity_event enable row level security;
alter table audit_event enable row level security;

create policy org_read on organization for select using (app.is_member());
create policy org_admin_update on organization for update using (app.is_admin());

create policy profile_read on user_profile for select using (app.is_member() or id = auth.uid());
create policy profile_self_update on user_profile for update using (id = auth.uid());

create policy membership_read on organization_membership for select using (app.is_member());
create policy membership_admin_write on organization_membership
  for all using (app.is_admin()) with check (app.is_admin());

create policy invitation_admin on invitation
  for all using (app.is_admin()) with check (app.is_admin());

create policy team_read on team for select using (app.is_member());
create policy team_admin_write on team
  for all using (app.is_admin()) with check (app.is_admin());
create policy team_member_read on team_member for select using (app.is_member());
create policy team_member_admin_write on team_member
  for all using (app.is_admin()) with check (app.is_admin());

create policy program_read on program for select using (app.is_member());
create policy program_staff_insert on program for insert with check (app.is_staff());
create policy program_staff_update on program for update using (app.is_staff());
create policy program_admin_delete on program for delete using (app.is_admin());

create policy program_membership_read on program_membership for select using (app.is_member());
create policy program_membership_staff_write on program_membership
  for all using (app.is_staff()) with check (app.is_staff());

create policy project_read on project for select using (app.is_member());
create policy project_staff_insert on project for insert with check (app.is_staff());
create policy project_staff_update on project for update using (app.is_staff());
create policy project_admin_delete on project for delete using (app.is_admin());

create policy project_membership_read on project_membership for select using (app.is_member());
create policy project_membership_staff_write on project_membership
  for all using (app.is_staff()) with check (app.is_staff());

create policy milestone_read on milestone for select using (app.is_member());
create policy milestone_staff_write on milestone
  for all using (app.is_staff()) with check (app.is_staff());

-- Volunteers see only tasks assigned to them; staff see organization tasks.
create policy task_read on task for select using (
  app.is_staff() or assignee_id = auth.uid()
);
create policy task_member_insert on task for insert with check (app.is_member());
create policy task_update on task for update using (
  app.is_staff() or assignee_id = auth.uid()
);
create policy task_admin_delete on task for delete using (app.is_admin());

create policy task_dependency_read on task_dependency for select using (app.is_member());
create policy task_dependency_staff_write on task_dependency
  for all using (app.is_staff()) with check (app.is_staff());

create policy checklist_read on checklist_item for select using (app.is_member());
create policy checklist_member_write on checklist_item
  for all using (app.is_member()) with check (app.is_member());

create policy label_read on label for select using (app.is_member());
create policy label_staff_write on label
  for all using (app.is_staff()) with check (app.is_staff());
create policy task_label_read on task_label for select using (app.is_member());
create policy task_label_member_write on task_label
  for all using (app.is_member()) with check (app.is_member());

create policy task_comment_read on task_comment for select using (app.is_member());
create policy task_comment_insert on task_comment
  for insert with check (author_id = auth.uid() and app.is_member());
create policy task_comment_author_update on task_comment
  for update using (author_id = auth.uid());

create policy status_update_read on project_status_update for select using (app.is_member());
create policy status_update_staff_insert on project_status_update
  for insert with check (app.is_staff() and author_id = auth.uid());

create policy activity_read on activity_event for select using (app.is_member());
create policy activity_member_insert on activity_event
  for insert with check (app.is_member());

create policy audit_admin_read on audit_event for select using (app.is_admin());
create policy audit_member_insert on audit_event
  for insert with check (app.is_member());
