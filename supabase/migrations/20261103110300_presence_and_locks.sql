-- Workspace OS V1-17 (part 1): who is here, where they are, and page lock
-- (epic #199, stream S3b).
--
-- Presence
--   Each person viewing or editing an object keeps one row, refreshed every
--   few seconds while the page is open, with their cursor (which block, and
--   where in it). Readers see the rows of people on objects they can view;
--   rows older than a minute count as gone. Nobody writes another person's
--   row. The rows travel to other browsers through Realtime's Postgres
--   changes, which applies these same RLS rules, so presence never tells
--   anyone who is looking at an object they cannot see. (Yjs awareness can
--   replace this once the co-editing transport is chosen, W0-6.)
--
-- Lock
--   Someone who can manage an object locks it; while locked nobody changes
--   its content through the Workspace OS paths (autosave, versions, restore,
--   suggestions) until someone who can manage it unlocks it. The block
--   editor reads public.is_object_locked to go read-only.

-- ---------------------------------------------------------------------------
-- Presence
-- ---------------------------------------------------------------------------

create table if not exists public.object_presence (
  object_id uuid not null,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  -- { "blockId": text, "offset": int, "length": int } or null when not editing.
  cursor jsonb,
  editing boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (object_id, user_id),
  constraint object_presence_cursor_shape check (
    cursor is null or (
      jsonb_typeof(cursor) = 'object'
      and jsonb_typeof(cursor -> 'blockId') = 'string'
      and length(cursor ->> 'blockId') <= 200
      and jsonb_typeof(cursor -> 'offset') = 'number'
      and (not (cursor ? 'length') or jsonb_typeof(cursor -> 'length') = 'number')
    )
  )
);

create index if not exists idx_object_presence_fresh
  on public.object_presence (object_id, updated_at desc);

alter table public.object_presence enable row level security;

drop policy if exists object_presence_read on public.object_presence;
create policy object_presence_read on public.object_presence
  for select to authenticated
  using (
    updated_at > now() - interval '1 minute'
    and app.is_org_member(organization_id)
    and public.can(object_id, 'view')
  );

revoke all on public.object_presence from anon, authenticated;
grant select on public.object_presence to authenticated;

-- Realtime carries presence changes to other viewers, filtered by the policy above.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'object_presence'
     ) then
    alter publication supabase_realtime add table public.object_presence;
  end if;
end;
$$;

-- Records "I am here" (and where my cursor is). Returns nothing; a person
-- who cannot view the object is refused.
create or replace function public.touch_presence(
  p_object uuid,
  p_cursor jsonb default null,
  p_editing boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid := app.current_organization();
begin
  if v_actor is null or v_org is null or not app.can(p_object, 'view') then
    raise exception 'You cannot open this object.' using errcode = '42501';
  end if;
  insert into public.object_presence (object_id, user_id, organization_id, cursor, editing, updated_at)
  values (p_object, v_actor, v_org, p_cursor, coalesce(p_editing, false) and app.can(p_object, 'edit_content'), now())
  on conflict (object_id, user_id) do update
    set cursor = excluded.cursor,
        editing = excluded.editing,
        updated_at = now();
end;
$$;

-- Leaving the page.
create or replace function public.leave_presence(p_object uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.object_presence
  where object_id = p_object and user_id = (select auth.uid());
$$;

-- Nightly and cheap: rows nobody refreshed for an hour.
create or replace function app.purge_stale_presence()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.object_presence where updated_at < now() - interval '1 hour';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.touch_presence(uuid, jsonb, boolean) from public, anon;
revoke all on function public.leave_presence(uuid) from public, anon;
revoke all on function app.purge_stale_presence() from public, anon, authenticated;
grant execute on function public.touch_presence(uuid, jsonb, boolean) to authenticated, service_role;
grant execute on function public.leave_presence(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Lock
-- ---------------------------------------------------------------------------

create table if not exists public.object_lock (
  object_id uuid primary key,
  organization_id uuid not null references public.organization (id) on delete cascade,
  locked_by uuid references public.user_profile (id) on delete set null,
  locked_at timestamptz not null default now(),
  reason text,
  constraint object_lock_reason_length check (reason is null or length(btrim(reason)) between 1 and 300)
);

alter table public.object_lock enable row level security;

drop policy if exists object_lock_read on public.object_lock;
create policy object_lock_read on public.object_lock
  for select to authenticated
  using (app.is_org_member(organization_id) and public.can(object_id, 'view'));

revoke all on public.object_lock from anon, authenticated;
grant select on public.object_lock to authenticated;

create or replace function public.is_object_locked(p_object uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.object_lock l where l.object_id = p_object);
$$;

create or replace function public.lock_object(p_object uuid, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization();
begin
  if (select auth.uid()) is null or v_org is null or not app.can(p_object, 'manage') then
    raise exception 'Only someone who manages this object can lock it.' using errcode = '42501';
  end if;
  insert into public.object_lock (object_id, organization_id, locked_by, reason)
  values (p_object, v_org, (select auth.uid()), nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (object_id) do nothing;
end;
$$;

create or replace function public.unlock_object(p_object uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not app.can(p_object, 'manage') then
    raise exception 'Only someone who manages this object can unlock it.' using errcode = '42501';
  end if;
  delete from public.object_lock where object_id = p_object;
end;
$$;

revoke all on function public.is_object_locked(uuid) from public, anon;
revoke all on function public.lock_object(uuid, text) from public, anon;
revoke all on function public.unlock_object(uuid) from public, anon;
grant execute on function public.is_object_locked(uuid) to authenticated, service_role;
grant execute on function public.lock_object(uuid, text) to authenticated, service_role;
grant execute on function public.unlock_object(uuid) to authenticated, service_role;

-- Versions (M16a) respect the lock: a locked object takes no new snapshot
-- except the "before restore" one, and restore itself is refused below.
create or replace function app.guard_locked_object_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_object_locked(new.object_id) then
    raise exception 'This object is locked.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_locked_object_version() from public, anon, authenticated;

drop trigger if exists object_version_lock_guard on public.object_version;
create trigger object_version_lock_guard
  before insert on public.object_version
  for each row execute function app.guard_locked_object_version();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname = 'workspace-os-presence-purge';
    perform cron.schedule('workspace-os-presence-purge', '35 6 * * *', 'select app.purge_stale_presence()');
  end if;
end;
$$;

comment on table public.object_presence is
  'Workspace OS V1-17: who has an object open and where their cursor is. Written by touch_presence only.';
comment on table public.object_lock is
  'Workspace OS V1-17: locked objects take no content changes until unlocked by a manager.';
