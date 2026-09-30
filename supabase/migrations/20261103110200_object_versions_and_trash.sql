-- Workspace OS M16a: version snapshots and the 30-day trash (epic #199,
-- stream S3b; plan section A10).
--
-- Versions
--   A version is a snapshot of an object's content (the editor's blocks and,
--   once co-editing lands, its Yjs state) and of its property values, so
--   M16b can compare two versions and restore the whole object, one block or
--   one property. Snapshots are taken automatically at most once every ten
--   minutes while someone is editing (the editor calls save_object_version
--   with kind 'auto' on every autosave and this function decides), and on
--   demand ('manual'). Nobody edits or deletes a version through the API;
--   the nightly prune thins old automatic ones and never touches an object
--   under legal hold.
--
-- Trash
--   Deleting an object puts it in the trash for 30 days, during which the
--   person who deleted it or anyone who can manage it restores it. After 30
--   days the nightly purge removes it for good, unless it is under legal
--   hold (#146): a held object cannot be put in the trash at all, and one
--   placed on hold while in the trash is never purged.
--
-- The object registry (stream S1, M1a) owns `object.deleted_at`. Until that
-- table exists the trash is this ledger alone; once it exists, trashing,
-- restoring and purging also set, clear and delete the registry row.

-- Legal holds name a table (app.legal_hold_guard looks the record up in it).
-- Tasks and projects, the objects that exist today, become holdable; the
-- registry's `object` table joins when stream S1 creates it, and the checks
-- below already look for a hold under either name.
insert into public.retention_record_type (key, label)
values ('task', 'Task'), ('project', 'Project')
on conflict (key) do nothing;

-- Whether an object is under legal hold, under its own type or as `object`.
create or replace function app.object_is_held(p_organization uuid, p_type text, p_object uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.record_is_held(p_organization, 'object', p_object, null)
      or app.record_is_held(p_organization, p_type, p_object, null);
$$;

revoke all on function app.object_is_held(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Versions
-- ---------------------------------------------------------------------------

create table if not exists public.object_version (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  object_id uuid not null,
  object_type text not null,
  kind text not null,
  label text,
  content jsonb not null default '{}'::jsonb,
  properties jsonb not null default '{}'::jsonb,
  -- md5 of content and properties, so an unchanged automatic snapshot is skipped.
  content_hash text not null,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint object_version_kind_is_known check (kind in ('auto', 'manual', 'restore')),
  constraint object_version_type_key check (object_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint object_version_label_length
    check (label is null or length(btrim(label)) between 1 and 120),
  -- A snapshot is a document, not a dump: 2 MB of JSON is far beyond any page.
  constraint object_version_size check (pg_column_size(content) + pg_column_size(properties) < 2097152)
);

create index if not exists idx_object_version_object
  on public.object_version (object_id, created_at desc);
create index if not exists idx_object_version_org
  on public.object_version (organization_id, created_at);

alter table public.object_version enable row level security;

drop policy if exists object_version_read on public.object_version;
create policy object_version_read on public.object_version
  for select to authenticated
  using (app.is_org_member(organization_id) and public.can(object_id, 'view'));

revoke all on public.object_version from anon, authenticated;
grant select on public.object_version to authenticated;

-- The caller's organization. Objects carry theirs once the registry lands;
-- until then the author's active membership decides (QBBE has one).
create or replace function app.current_organization()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select om.organization_id
  from public.organization_membership om
  where om.user_id = (select auth.uid()) and om.status = 'active'
  order by om.created_at
  limit 1;
$$;

revoke all on function app.current_organization() from public, anon, authenticated;

-- Saves a snapshot and returns its id, or null when an automatic snapshot is
-- not due: the last version is under ten minutes old, or nothing changed.
create or replace function public.save_object_version(
  p_object uuid,
  p_type text,
  p_kind text,
  p_content jsonb,
  p_properties jsonb,
  p_label text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization();
  v_hash text := md5(coalesce(p_content, '{}'::jsonb)::text || coalesce(p_properties, '{}'::jsonb)::text);
  v_last public.object_version%rowtype;
  v_id uuid;
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'Sign in to save a version.' using errcode = '42501';
  end if;
  if p_kind not in ('auto', 'manual', 'restore') then
    raise exception 'Unknown kind of version: %.', p_kind using errcode = 'check_violation';
  end if;
  if not app.can(p_object, 'edit_content') then
    raise exception 'You cannot edit this object.' using errcode = '42501';
  end if;
  if exists (select 1 from public.object_trash t
             where t.object_id = p_object and t.restored_at is null and t.purged_at is null) then
    raise exception 'Restore this object from the trash before saving a version.'
      using errcode = '42501';
  end if;

  if p_kind = 'auto' then
    select * into v_last from public.object_version v
    where v.object_id = p_object
    order by v.created_at desc
    limit 1;
    if found and (v_last.created_at > now() - interval '10 minutes' or v_last.content_hash = v_hash) then
      return null;
    end if;
  end if;

  insert into public.object_version (
    organization_id, object_id, object_type, kind, label,
    content, properties, content_hash, created_by
  ) values (
    v_org, p_object, p_type, p_kind, nullif(btrim(coalesce(p_label, '')), ''),
    coalesce(p_content, '{}'::jsonb), coalesce(p_properties, '{}'::jsonb), v_hash,
    (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.save_object_version(uuid, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.save_object_version(uuid, text, text, jsonb, jsonb, text)
  to authenticated, service_role;

-- Keeps every named and restore version, every automatic one from the last
-- 30 days and the newest 50 per object; nothing at all for an object under
-- legal hold. Returns how many were removed.
create or replace function app.prune_object_versions()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with ranked as (
    select v.id, v.organization_id, v.object_id, v.object_type, v.kind, v.created_at,
           row_number() over (partition by v.object_id order by v.created_at desc) as newest
    from public.object_version v
  )
  delete from public.object_version v
  using ranked r
  where v.id = r.id
    and r.kind = 'auto'
    and r.created_at < now() - interval '30 days'
    and r.newest > 50
    and not app.object_is_held(r.organization_id, r.object_type, r.object_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.prune_object_versions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trash
-- ---------------------------------------------------------------------------

create table if not exists public.object_trash (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  object_id uuid not null,
  object_type text not null,
  title text not null,
  deleted_by uuid references public.user_profile (id) on delete set null,
  deleted_at timestamptz not null default now(),
  purge_after timestamptz not null,
  restored_by uuid references public.user_profile (id) on delete set null,
  restored_at timestamptz,
  purged_at timestamptz,
  constraint object_trash_type_key check (object_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint object_trash_title_length check (length(title) <= 500),
  constraint object_trash_one_outcome check (restored_at is null or purged_at is null)
);

-- An object is in the trash at most once at a time.
create unique index if not exists uq_object_trash_active
  on public.object_trash (object_id)
  where restored_at is null and purged_at is null;
create index if not exists idx_object_trash_org
  on public.object_trash (organization_id, deleted_at desc);

alter table public.object_trash enable row level security;

-- The person who deleted it sees it, and so does anyone who can still see
-- the object. Writes go through the functions below only.
drop policy if exists object_trash_read on public.object_trash;
create policy object_trash_read on public.object_trash
  for select to authenticated
  using (
    app.is_org_member(organization_id)
    and (deleted_by = (select auth.uid()) or public.can(object_id, 'view'))
  );

revoke all on public.object_trash from anon, authenticated;
grant select on public.object_trash to authenticated;

-- Runs one statement against the object registry when it exists.
create or replace function app.object_registry_exec(p_sql text, p_object uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.object') is not null then
    execute p_sql using p_object;
  end if;
end;
$$;

revoke all on function app.object_registry_exec(text, uuid) from public, anon, authenticated;

create or replace function public.trash_object(p_object uuid, p_type text, p_title text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization();
  v_id uuid;
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'Sign in to delete.' using errcode = '42501';
  end if;
  if not app.can(p_object, 'manage') then
    raise exception 'You cannot delete this object.' using errcode = '42501';
  end if;
  -- A hold stops the trash as it stops archiving: the record must stay put.
  if app.object_is_held(v_org, p_type, p_object) then
    raise exception 'This record is under legal hold and cannot be deleted until the hold is released.'
      using errcode = '42501';
  end if;

  insert into public.object_trash (
    organization_id, object_id, object_type, title, deleted_by, purge_after
  ) values (
    v_org, p_object, p_type, left(coalesce(p_title, ''), 500), (select auth.uid()),
    now() + interval '30 days'
  )
  returning id into v_id;

  perform app.object_registry_exec(
    'update public.object set deleted_at = now() where id = $1', p_object);
  return v_id;
exception
  when unique_violation then
    raise exception 'This object is already in the trash.' using errcode = '23505';
end;
$$;

revoke all on function public.trash_object(uuid, text, text) from public, anon;
grant execute on function public.trash_object(uuid, text, text) to authenticated, service_role;

create or replace function public.restore_object(p_object uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_entry public.object_trash%rowtype;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'Sign in to restore.' using errcode = '42501';
  end if;
  select * into v_entry from public.object_trash t
  where t.object_id = p_object and t.restored_at is null and t.purged_at is null
  for update;
  if not found or not app.is_org_member(v_entry.organization_id) then
    raise exception 'This object is not in the trash.' using errcode = 'P0002';
  end if;
  if v_entry.deleted_by is distinct from v_actor and not app.can(p_object, 'manage') then
    raise exception 'Only the person who deleted it or someone who manages it can restore it.'
      using errcode = '42501';
  end if;
  update public.object_trash
     set restored_at = now(), restored_by = v_actor
   where id = v_entry.id;
  perform app.object_registry_exec(
    'update public.object set deleted_at = null where id = $1', p_object);
  return v_entry.id;
end;
$$;

revoke all on function public.restore_object(uuid) from public, anon;
grant execute on function public.restore_object(uuid) to authenticated, service_role;

-- Permanently removes what has been in the trash for 30 days, except objects
-- under legal hold. Returns how many were purged.
create or replace function app.purge_object_trash()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_entry public.object_trash%rowtype;
  v_count integer := 0;
begin
  for v_entry in
    select * from public.object_trash t
    where t.restored_at is null and t.purged_at is null and t.purge_after <= now()
    for update skip locked
  loop
    continue when app.object_is_held(v_entry.organization_id, v_entry.object_type, v_entry.object_id);
    delete from public.object_version v where v.object_id = v_entry.object_id;
    perform app.object_registry_exec('delete from public.object where id = $1', v_entry.object_id);
    update public.object_trash set purged_at = now() where id = v_entry.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function app.purge_object_trash() from public, anon, authenticated;

-- Nightly, after the other maintenance jobs.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j
    where j.jobname in ('workspace-os-object-trash', 'workspace-os-version-prune');
    perform cron.schedule('workspace-os-object-trash', '20 6 * * *',
      'select app.purge_object_trash()');
    perform cron.schedule('workspace-os-version-prune', '25 6 * * *',
      'select app.prune_object_versions()');
  end if;
end;
$$;

comment on table public.object_version is
  'Workspace OS M16a: snapshots of an object''s content and properties. Written by save_object_version only.';
comment on table public.object_trash is
  'Workspace OS M16a: deleted objects, restorable for 30 days. Written by trash_object / restore_object only.';
