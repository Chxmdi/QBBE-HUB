-- QBBE Hub — meetings & agendas, events, CRM, reporting, integrations,
-- feature flags, bootstrap triggers, and permission-safe search.

create type meeting_status as enum ('scheduled', 'in_progress', 'completed', 'cancelled');
create type agenda_kind as enum ('information', 'discussion', 'decision');
create type event_status as enum ('planning', 'confirmed', 'in_progress', 'completed', 'cancelled');
create type interaction_type as enum ('meeting', 'call', 'email', 'message', 'note', 'other');
create type follow_up_status as enum ('open', 'done', 'cancelled');
create type report_status as enum ('draft', 'in_review', 'approved');

-- ---------------------------------------------------------------------------
-- Meetings & agendas (P0-MTG, P0-AGD)
-- ---------------------------------------------------------------------------
create table meeting (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  program_id uuid references program (id) on delete set null,
  project_id uuid references project (id) on delete set null,
  title text not null,
  purpose text,
  organizer_id uuid not null references user_profile (id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  meeting_link text, -- provider-agnostic (CAL-005)
  status meeting_status not null default 'scheduled',
  notes text,
  summary_posted_at timestamptz,
  channel_id uuid references channel (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_meeting_org_time on meeting (organization_id, starts_at);

create table meeting_attendee (
  meeting_id uuid not null references meeting (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  attended boolean,
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

create table agenda_item (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meeting (id) on delete cascade,
  title text not null,
  kind agenda_kind not null default 'discussion',
  owner_id uuid references user_profile (id),
  desired_outcome text,
  time_box_minutes smallint,
  sort_key double precision not null default 0,
  status text not null default 'proposed', -- proposed | accepted | deferred | declined | done
  proposed_by uuid references user_profile (id),
  source_message_id uuid references message (id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_agenda_meeting on agenda_item (meeting_id, sort_key);

create table decision (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  project_id uuid references project (id) on delete set null,
  meeting_id uuid references meeting (id) on delete set null,
  title text not null,
  detail text,
  decided_by uuid references user_profile (id),
  decided_at timestamptz not null default now(),
  source_message_id uuid references message (id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_decision_org on decision (organization_id, decided_at desc);

create table meeting_action (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meeting (id) on delete cascade,
  agenda_item_id uuid references agenda_item (id) on delete set null,
  task_id uuid references task (id) on delete set null,
  title text not null,
  owner_id uuid references user_profile (id),
  due_at date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Events (P0-EVT)
-- ---------------------------------------------------------------------------
create table event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  program_id uuid references program (id) on delete set null,
  project_id uuid references project (id) on delete set null,
  name text not null,
  description text,
  owner_id uuid references user_profile (id),
  event_type text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  status event_status not null default 'planning',
  volunteer_need smallint,
  channel_id uuid references channel (id) on delete set null,
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_event_org_time on event (organization_id, starts_at);

alter table channel
  add constraint fk_channel_event
  foreign key (event_id) references event (id) on delete set null;

create table event_assignment (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references event (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  role text not null, -- logistics | communications | volunteers | venue | content | registration | follow_up
  created_at timestamptz not null default now(),
  unique (event_id, user_id, role)
);

-- ---------------------------------------------------------------------------
-- Relationship CRM (P1-CRM-01..06)
-- ---------------------------------------------------------------------------
create table crm_organization (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  name text not null,
  category text not null default 'community', -- funder | sponsor | school | university | community | government | vendor | media | donor | association
  website text,
  owner_id uuid references user_profile (id),
  status text not null default 'active',
  notes text,
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_crm_org on crm_organization (organization_id, name);

create table crm_contact (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  crm_organization_id uuid references crm_organization (id) on delete set null,
  full_name text not null,
  role_title text,
  email text,
  phone text,
  preferred_channel text,
  owner_id uuid references user_profile (id),
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_crm_contact_org on crm_contact (organization_id, full_name);

create table crm_interaction (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  crm_organization_id uuid references crm_organization (id) on delete cascade,
  contact_id uuid references crm_contact (id) on delete set null,
  interaction_type interaction_type not null default 'note',
  occurred_at timestamptz not null default now(),
  owner_id uuid not null references user_profile (id),
  summary text not null,
  next_steps text,
  created_at timestamptz not null default now()
);
create index idx_crm_interaction on crm_interaction (crm_organization_id, occurred_at desc);

create table crm_follow_up (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  crm_organization_id uuid references crm_organization (id) on delete cascade,
  contact_id uuid references crm_contact (id) on delete set null,
  owner_id uuid not null references user_profile (id),
  title text not null,
  due_at date not null,
  status follow_up_status not null default 'open',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_crm_follow_up_owner on crm_follow_up (owner_id, due_at, status);

-- ---------------------------------------------------------------------------
-- Reporting — versioned snapshots (RPT-001)
-- ---------------------------------------------------------------------------
create table report_instance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  report_type text not null, -- quarterly | project | program | activity
  title text not null,
  program_id uuid references program (id) on delete set null,
  project_id uuid references project (id) on delete set null,
  period_start date,
  period_end date,
  snapshot jsonb not null default '{}'::jsonb,
  status report_status not null default 'draft',
  generated_by uuid not null references user_profile (id),
  approved_by uuid references user_profile (id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_report_org on report_instance (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Integrations & admin
-- ---------------------------------------------------------------------------
create table integration_connection (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  user_id uuid references user_profile (id) on delete cascade,
  provider text not null, -- gmail | google_calendar | google_drive | volunteer_system | email
  external_account_id text,
  scopes text[],
  status text not null default 'disconnected', -- connected | disconnected | error
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, user_id)
);

create table feature_flag (
  key text primary key,
  organization_id uuid references organization (id) on delete cascade,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

-- updated_at triggers for new tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'meeting', 'event', 'crm_organization', 'crm_contact', 'integration_connection'
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
-- RLS
-- ---------------------------------------------------------------------------
alter table meeting enable row level security;
alter table meeting_attendee enable row level security;
alter table agenda_item enable row level security;
alter table decision enable row level security;
alter table meeting_action enable row level security;
alter table event enable row level security;
alter table event_assignment enable row level security;
alter table crm_organization enable row level security;
alter table crm_contact enable row level security;
alter table crm_interaction enable row level security;
alter table crm_follow_up enable row level security;
alter table report_instance enable row level security;
alter table integration_connection enable row level security;
alter table feature_flag enable row level security;

-- Meetings/events: readable to members; volunteers see items they attend/are
-- assigned to via the member read (kept simple at pilot scale; tighten with
-- program scoping when adopted).
create policy meeting_read on meeting for select using (
  app.is_staff()
  or organizer_id = auth.uid()
  or exists (select 1 from meeting_attendee a where a.meeting_id = id and a.user_id = auth.uid())
);
create policy meeting_staff_write on meeting
  for all using (app.is_staff()) with check (app.is_staff());

create policy meeting_attendee_read on meeting_attendee for select using (app.is_member());
create policy meeting_attendee_staff_write on meeting_attendee
  for all using (app.is_staff()) with check (app.is_staff());

create policy agenda_read on agenda_item for select using (app.is_member());
create policy agenda_member_insert on agenda_item for insert with check (app.is_member());
create policy agenda_staff_update on agenda_item for update using (
  app.is_staff() or proposed_by = auth.uid()
);
create policy agenda_staff_delete on agenda_item for delete using (app.is_staff());

create policy decision_read on decision for select using (app.is_member());
create policy decision_staff_write on decision
  for all using (app.is_staff()) with check (app.is_staff());

create policy meeting_action_read on meeting_action for select using (app.is_member());
create policy meeting_action_staff_write on meeting_action
  for all using (app.is_staff()) with check (app.is_staff());

create policy event_read on event for select using (
  app.is_staff()
  or exists (select 1 from event_assignment ea where ea.event_id = id and ea.user_id = auth.uid())
);
create policy event_staff_write on event
  for all using (app.is_staff()) with check (app.is_staff());

create policy event_assignment_read on event_assignment for select using (app.is_member());
create policy event_assignment_staff_write on event_assignment
  for all using (app.is_staff()) with check (app.is_staff());

-- CRM is staff-only: volunteers never see relationship records (P0-VOL-02).
create policy crm_org_staff on crm_organization
  for all using (app.is_staff()) with check (app.is_staff());
create policy crm_contact_staff on crm_contact
  for all using (app.is_staff()) with check (app.is_staff());
create policy crm_interaction_staff on crm_interaction
  for all using (app.is_staff()) with check (app.is_staff());
create policy crm_follow_up_staff on crm_follow_up
  for all using (app.is_staff()) with check (app.is_staff());

create policy report_staff_read on report_instance for select using (app.is_staff());
create policy report_staff_insert on report_instance for insert with check (
  app.is_staff() and generated_by = auth.uid()
);
create policy report_admin_update on report_instance for update using (app.is_admin());

create policy integration_admin on integration_connection
  for all using (app.is_admin()) with check (app.is_admin());

create policy feature_flag_read on feature_flag for select using (app.is_member());
create policy feature_flag_admin_write on feature_flag
  for all using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- Bootstrap: first sign-up provisions the organization, default channels,
-- profile, and membership. Later sign-ups join as staff pending admin review
-- (production deployments should disable open self-serve signup and rely on
-- invitations — see docs/runbooks/deployment.md).
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role org_role := 'staff';
  v_channel record;
begin
  insert into user_profile (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  select id into v_org from organization limit 1;

  if v_org is null then
    -- First user bootstraps the workspace and becomes Primary Owner.
    v_role := 'owner';
    insert into organization (name, slug)
    values ('Quebec Board of Black Educators', 'qbbe')
    returning id into v_org;

    insert into channel (organization_id, name, slug, type, privacy, purpose,
                         posting_policy, reply_policy, is_mandatory, owner_id, created_by)
    values
      (v_org, 'Announcements', 'announcements', 'announcements', 'public',
       'Official organization-wide announcements. Posting is restricted to leadership and admins.',
       'admins', 'threads_only', true, new.id, new.id),
      (v_org, 'General', 'general', 'organization', 'public',
       'Non-critical organization-wide conversation.', 'everyone', 'normal', true, new.id, new.id);
  end if;

  -- Invitation-aware role assignment.
  select intended_role into v_role
  from invitation
  where email = new.email and accepted_at is null and revoked_at is null
    and expires_at > now()
  order by created_at desc limit 1;
  if not found then
    select case when exists (select 1 from organization_membership) then 'staff'::org_role else 'owner'::org_role end
      into v_role;
  else
    update invitation set accepted_at = now() where email = new.email and accepted_at is null;
  end if;

  insert into organization_membership (organization_id, user_id, role, status)
  values (v_org, new.id, v_role, 'active')
  on conflict (organization_id, user_id) do nothing;

  -- Auto-enroll into mandatory channels (P0-ANN-01).
  for v_channel in select id from channel where organization_id = v_org and is_mandatory
  loop
    insert into channel_member (channel_id, user_id, membership_source)
    values (v_channel.id, new.id, 'mandatory')
    on conflict do nothing;
  end loop;

  insert into audit_event (organization_id, actor_id, event_type, action, object_type, object_id)
  values (v_org, new.id, 'auth', 'user_provisioned', 'user_profile', new.id);

  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Permission-safe global search (P0-SRC-01/02), exposed via PostgREST as
-- rpc/global_search. SECURITY INVOKER on purpose:
-- RLS on the underlying tables filters every result for the caller, so this
-- function can never leak titles or snippets of unauthorized records.
-- ---------------------------------------------------------------------------
create or replace function public.global_search(p_query text, p_limit int default 20)
returns table (
  result_type text,
  id uuid,
  title text,
  snippet text,
  href text
)
language sql stable security invoker
set search_path = public
as $$
  with q as (select '%' || trim(p_query) || '%' as pattern)
  (
    select 'task', t.id, t.title, coalesce(left(t.description, 120), ''),
           '/tasks?task=' || t.id
    from task t, q where t.title ilike q.pattern and t.archived_at is null
    limit p_limit
  )
  union all
  (
    select 'project', p.id, p.name, coalesce(left(p.outcome, 120), ''),
           '/projects/' || p.id
    from project p, q where p.name ilike q.pattern and p.archived_at is null
    limit p_limit
  )
  union all
  (
    select 'program', pr.id, pr.name, coalesce(left(pr.description, 120), ''),
           '/programs/' || pr.id
    from program pr, q where pr.name ilike q.pattern and pr.archived_at is null
    limit p_limit
  )
  union all
  (
    select 'channel', c.id, '#' || c.slug, coalesce(c.purpose, ''),
           '/channels/' || c.id
    from channel c, q where (c.name ilike q.pattern or c.slug ilike q.pattern)
      and c.archived_at is null
    limit p_limit
  )
  union all
  (
    select 'message', m.id,
           left(m.body, 80),
           'in conversation',
           case when m.channel_id is not null
             then '/channels/' || m.channel_id || '?message=' || m.id
             else '/messages/' || m.conversation_id end
    from message m, q
    where m.body ilike q.pattern and m.deleted_at is null
    order by m.created_at desc
    limit p_limit
  )
  union all
  (
    select 'person', u.id, u.full_name, coalesce(u.title, ''),
           '/people?person=' || u.id
    from user_profile u, q where u.full_name ilike q.pattern
    limit p_limit
  )
  union all
  (
    select 'meeting', mt.id, mt.title, to_char(mt.starts_at, 'YYYY-MM-DD HH24:MI'),
           '/meetings/' || mt.id
    from meeting mt, q where mt.title ilike q.pattern
    limit p_limit
  )
  union all
  (
    select 'crm', co.id, co.name, co.category, '/crm/' || co.id
    from crm_organization co, q where co.name ilike q.pattern
    limit p_limit
  )
  limit p_limit;
$$;
