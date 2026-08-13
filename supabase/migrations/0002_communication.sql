-- QBBE Hub — communication domain: channels, membership, messages, threads,
-- reactions, mentions, DMs, announcements + acknowledgments, notifications.
-- Durable messaging model per Part IV §9 (MSG-001..MSG-010).

create type channel_type as enum (
  'organization', 'announcements', 'team', 'program', 'project',
  'event', 'operations', 'leadership', 'custom'
);
create type channel_privacy as enum ('public', 'private');
create type posting_policy as enum ('everyone', 'staff', 'admins');
create type reply_policy as enum ('normal', 'threads_only', 'disabled');
create type announcement_priority as enum ('normal', 'important', 'critical');
create type notification_urgency as enum ('low', 'normal', 'high', 'critical');

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------
create table channel (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  name text not null,
  slug text not null,
  type channel_type not null default 'custom',
  privacy channel_privacy not null default 'public',
  purpose text,
  topic text,
  owner_id uuid references user_profile (id),
  program_id uuid references program (id) on delete set null,
  project_id uuid references project (id) on delete set null,
  event_id uuid, -- FK added in 0003 after event table exists
  posting_policy posting_policy not null default 'everyone',
  reply_policy reply_policy not null default 'normal',
  is_mandatory boolean not null default false,
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, slug)
);
create index idx_channel_org on channel (organization_id, archived_at);

create table channel_member (
  channel_id uuid not null references channel (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  role text not null default 'member', -- member | manager
  membership_source text not null default 'manual', -- manual | mandatory | program | project | event
  muted_level text not null default 'all', -- all | mentions | muted
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index idx_channel_member_user on channel_member (user_id);

-- ---------------------------------------------------------------------------
-- Direct / group conversations
-- ---------------------------------------------------------------------------
create table conversation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  is_group boolean not null default false,
  title text,
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now()
);

create table conversation_member (
  conversation_id uuid not null references conversation (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index idx_conversation_member_user on conversation_member (user_id);

-- ---------------------------------------------------------------------------
-- Messages — persisted in Postgres before treated as sent (MSG-001);
-- threads via thread_root_id (MSG-002); plain-text body sanitized
-- server-side, rendered with a safe renderer (MSG-003).
-- ---------------------------------------------------------------------------
create table message (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  channel_id uuid references channel (id) on delete cascade,
  conversation_id uuid references conversation (id) on delete cascade,
  thread_root_id uuid references message (id) on delete cascade,
  author_id uuid not null references user_profile (id),
  body text not null,
  is_system boolean not null default false,
  source_record_type text,
  source_record_id uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint message_has_container
    check ((channel_id is not null) or (conversation_id is not null))
);
create index idx_message_channel on message (channel_id, created_at desc);
create index idx_message_conversation on message (conversation_id, created_at desc);
create index idx_message_thread on message (thread_root_id, created_at);
create index idx_message_search on message using gin (to_tsvector('english', body));

-- Deferred FK from task to message (message → task conversion, P0-LINK-02).
alter table task
  add constraint fk_task_source_message
  foreign key (source_message_id) references message (id) on delete set null;

create table message_reaction (
  message_id uuid not null references message (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  -- Unique constraint prevents duplicate toggles (MSG-006).
  primary key (message_id, user_id, emoji)
);

create table message_mention (
  message_id uuid not null references message (id) on delete cascade,
  mentioned_user_id uuid not null references user_profile (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, mentioned_user_id)
);

create table saved_message (
  user_id uuid not null references user_profile (id) on delete cascade,
  message_id uuid not null references message (id) on delete cascade,
  remind_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create table pinned_resource (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channel (id) on delete cascade,
  message_id uuid references message (id) on delete cascade,
  title text not null,
  url text,
  pinned_by uuid references user_profile (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Announcements — separate posting vs reading permissions; explicit durable
-- acknowledgment records (ANN-001..ANN-004).
-- ---------------------------------------------------------------------------
create table announcement (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references message (id) on delete cascade,
  organization_id uuid not null references organization (id) on delete cascade,
  title text not null,
  priority announcement_priority not null default 'normal',
  requires_ack boolean not null default false,
  ack_deadline timestamptz,
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  pinned_until timestamptz,
  created_by uuid not null references user_profile (id),
  created_at timestamptz not null default now()
);
create index idx_announcement_org on announcement (organization_id, publish_at desc);

create table announcement_acknowledgment (
  announcement_id uuid not null references announcement (id) on delete cascade,
  user_id uuid not null references user_profile (id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  method text not null default 'click',
  primary key (announcement_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Notifications — durable records with dedupe keys (NTF-001).
-- ---------------------------------------------------------------------------
create table notification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profile (id) on delete cascade,
  organization_id uuid not null references organization (id) on delete cascade,
  category text not null, -- assignment | mention | reply | announcement | due_date | approval | system
  title text not null,
  body text,
  source_type text,
  source_id uuid,
  link text,
  urgency notification_urgency not null default 'normal',
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notification_user on notification (user_id, read_at, created_at desc);
-- One event never produces duplicate alerts for the same person (P0-NOT-04).
create unique index uq_notification_dedupe
  on notification (user_id, dedupe_key) where dedupe_key is not null;

create table notification_preference (
  user_id uuid primary key references user_profile (id) on delete cascade,
  email_critical boolean not null default true,
  email_digest boolean not null default false,
  quiet_hours_start smallint,
  quiet_hours_end smallint,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Authorization helpers for communication scopes
-- ---------------------------------------------------------------------------
create or replace function app.is_channel_member(p_channel uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from channel_member cm
    where cm.channel_id = p_channel and cm.user_id = auth.uid()
  );
$$;

create or replace function app.can_read_channel(p_channel uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from channel c
    where c.id = p_channel
      and (
        (c.privacy = 'public' and app.is_member())
        or app.is_channel_member(p_channel)
      )
  );
$$;

create or replace function app.can_post_in_channel(p_channel uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from channel c
    where c.id = p_channel
      and c.archived_at is null
      and app.is_channel_member(p_channel)
      and case c.posting_policy
        when 'everyone' then app.is_member()
        when 'staff' then app.is_staff()
        when 'admins' then app.is_admin()
      end
  );
$$;

-- Thread replies follow reply_policy separately from top-level posting
-- (P0-ANN-03): members may reply in threads_only/normal channels even when
-- top-level posting is restricted.
create or replace function app.can_reply_in_channel(p_channel uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from channel c
    where c.id = p_channel
      and c.archived_at is null
      and c.reply_policy <> 'disabled'
      and app.is_channel_member(p_channel)
  );
$$;

create or replace function app.is_conversation_member(p_conversation uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from conversation_member cm
    where cm.conversation_id = p_conversation and cm.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table channel enable row level security;
alter table channel_member enable row level security;
alter table conversation enable row level security;
alter table conversation_member enable row level security;
alter table message enable row level security;
alter table message_reaction enable row level security;
alter table message_mention enable row level security;
alter table saved_message enable row level security;
alter table pinned_resource enable row level security;
alter table announcement enable row level security;
alter table announcement_acknowledgment enable row level security;
alter table notification enable row level security;
alter table notification_preference enable row level security;

-- Channels: public channels are discoverable by members; private channels
-- exist only for their members (P0-SRC-02 — no existence leaks).
create policy channel_read on channel for select using (
  (privacy = 'public' and app.is_member()) or app.is_channel_member(id)
);
create policy channel_staff_insert on channel for insert with check (app.is_staff());
create policy channel_manage on channel for update using (
  app.is_admin() or owner_id = auth.uid()
);
create policy channel_admin_delete on channel for delete using (app.is_admin());

create policy channel_member_read on channel_member for select using (
  app.can_read_channel(channel_id)
);
create policy channel_member_join on channel_member for insert with check (
  -- Self-join public channels; admins/owners can add members anywhere they manage.
  (user_id = auth.uid() and app.is_member()
    and exists (select 1 from channel c where c.id = channel_id and c.privacy = 'public'))
  or app.is_admin()
  or exists (select 1 from channel c where c.id = channel_id and c.owner_id = auth.uid())
);
create policy channel_member_update_self on channel_member for update using (
  user_id = auth.uid() or app.is_admin()
);
create policy channel_member_leave on channel_member for delete using (
  -- Mandatory channels cannot be left by ordinary members (P0-ANN-01).
  (user_id = auth.uid()
    and not exists (select 1 from channel c where c.id = channel_id and c.is_mandatory))
  or app.is_admin()
);

create policy conversation_read on conversation for select using (
  app.is_conversation_member(id)
);
create policy conversation_create on conversation for insert with check (
  app.is_member() and created_by = auth.uid()
);

create policy conversation_member_read on conversation_member for select using (
  app.is_conversation_member(conversation_id)
);
create policy conversation_member_insert on conversation_member for insert with check (
  -- Creator composes the participant list; members can be added by members.
  app.is_member() and (
    user_id = auth.uid() or app.is_conversation_member(conversation_id)
    or exists (select 1 from conversation c where c.id = conversation_id and c.created_by = auth.uid())
  )
);
create policy conversation_member_update_self on conversation_member for update using (
  user_id = auth.uid()
);
create policy conversation_member_leave on conversation_member for delete using (
  user_id = auth.uid()
);

create policy message_read on message for select using (
  (channel_id is not null and app.can_read_channel(channel_id))
  or (conversation_id is not null and app.is_conversation_member(conversation_id))
);
create policy message_insert on message for insert with check (
  author_id = auth.uid() and (
    (channel_id is not null and (
      app.can_post_in_channel(channel_id)
      or (thread_root_id is not null and app.can_reply_in_channel(channel_id))
    ))
    or (conversation_id is not null and app.is_conversation_member(conversation_id))
  )
);
create policy message_author_update on message for update using (
  author_id = auth.uid() or app.is_admin()
);

create policy reaction_read on message_reaction for select using (
  exists (select 1 from message m where m.id = message_id) -- visibility via message RLS on join
  and app.is_member()
);
create policy reaction_write on message_reaction for insert with check (user_id = auth.uid());
create policy reaction_delete on message_reaction for delete using (user_id = auth.uid());

create policy mention_read on message_mention for select using (
  mentioned_user_id = auth.uid() or app.is_member()
);
create policy mention_insert on message_mention for insert with check (app.is_member());

create policy saved_message_all on saved_message
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy pinned_read on pinned_resource for select using (
  app.can_read_channel(channel_id)
);
create policy pinned_write on pinned_resource for insert with check (
  app.is_channel_member(channel_id) and app.is_staff()
);
create policy pinned_delete on pinned_resource for delete using (
  app.is_staff() and app.is_channel_member(channel_id)
);

create policy announcement_read on announcement for select using (app.is_member());
create policy announcement_admin_insert on announcement for insert with check (
  app.is_admin() and created_by = auth.uid()
);

create policy ack_read on announcement_acknowledgment for select using (
  user_id = auth.uid() or app.is_admin()
);
create policy ack_insert on announcement_acknowledgment for insert with check (
  user_id = auth.uid()
);

create policy notification_own on notification
  for select using (user_id = auth.uid());
create policy notification_update_own on notification
  for update using (user_id = auth.uid());
create policy notification_insert on notification
  for insert with check (app.is_member());

create policy notification_pref_own on notification_preference
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime: broadcast new-message signals; clients refetch by cursor.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table message;
alter publication supabase_realtime add table notification;
