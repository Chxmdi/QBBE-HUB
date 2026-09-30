-- Workspace OS M1a: the object registry (epic #199, design note section 3).
--
-- Two tables every later layer builds on:
--   object_type  one row per kind of object, per organization. The eleven
--                native types (task, project, meeting ...) are seeded here for
--                every organization, and for every new one by a trigger.
--   object       one row per record. A native record's object has the SAME id
--                as the native row, so a task's object id is the task id.
--
-- Plus the machinery M1b and M1c plug native tables into without new code:
--   app.native_object_map        which column is the title, owner, parent ...
--   app.upsert_native_object()   writes one object row from one native row
--   app.sync_object_from_native() the trigger function attached to each table
--
-- Reading an object asks public.can(id, 'view'), the Workspace OS access check.
-- Until M10c (stream S2) replaces the stand-in, that check knows tasks and
-- projects only, so other objects are invisible through the API even though
-- their rows exist. That is the safe direction: never more open than today.
--
-- Nobody writes `object` through the API. Native rows are written by the sync
-- trigger with definer rights; custom objects will be created by the action
-- layer (M13) through a security definer function. Custom object types are
-- managed by owners and admins (with two-step sign-in, via app.is_org_admin).

-- ---------------------------------------------------------------------------
-- object_type
-- ---------------------------------------------------------------------------

create table public.object_type (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  name_en text not null check (btrim(name_en) <> ''),
  name_fr text not null check (btrim(name_fr) <> ''),
  icon text,
  kind text not null check (kind in ('native', 'custom')),
  native_table text,
  default_lens text not null default 'document' check (default_lens in (
    'document', 'table', 'board', 'list', 'calendar', 'timeline', 'gallery',
    'feed', 'dashboard', 'graph', 'map'
  )),
  -- Templates arrive in V1-13; no foreign key until then.
  default_template_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, key),
  -- Target of object's composite foreign key.
  unique (id, organization_id),
  constraint object_type_native_table check (
    (kind = 'native') = (native_table is not null)
  )
);

comment on table public.object_type is
  'Workspace OS object types (M1a). Native types are seeded per organization by migrations; owners and admins manage custom types.';

create trigger object_type_updated_at before update on public.object_type
  for each row execute function public.set_updated_at();

alter table public.object_type enable row level security;

create policy object_type_read on public.object_type for select to authenticated
  using (app.is_org_member(organization_id));
-- Native rows are written by migrations only: the write policies exclude them.
create policy object_type_admin_insert on public.object_type for insert to authenticated
  with check (kind = 'custom' and app.is_org_admin(organization_id));
create policy object_type_admin_update on public.object_type for update to authenticated
  using (kind = 'custom' and app.is_org_admin(organization_id))
  with check (kind = 'custom' and app.is_org_admin(organization_id));
-- No delete policy: a custom type is archived so its objects keep a type.

revoke all on public.object_type from anon;
revoke delete, truncate on public.object_type from authenticated;

-- ---------------------------------------------------------------------------
-- object
-- ---------------------------------------------------------------------------

create table public.object (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  type_id uuid not null,
  -- References space once M10a (stream S2) creates it.
  space_id uuid,
  parent_object_id uuid references public.object (id) on delete set null,
  title text not null default '',
  icon text,
  cover text,
  owner_id uuid references public.user_profile (id) on delete set null,
  created_by uuid references public.user_profile (id) on delete set null,
  updated_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  search_vector tsvector generated always as (
    to_tsvector('english'::regconfig, title) || to_tsvector('french'::regconfig, title)
  ) stored,
  -- An object cannot use another organization's type.
  foreign key (type_id, organization_id)
    references public.object_type (id, organization_id),
  check (parent_object_id is null or parent_object_id <> id)
);

comment on table public.object is
  'Workspace OS objects (M1a). A native record''s object shares its id. Read through public.can(id, ''view''); written only by definer functions.';

create index idx_object_org_type_updated on public.object (organization_id, type_id, updated_at desc);
create index idx_object_parent on public.object (parent_object_id) where parent_object_id is not null;
create index idx_object_space on public.object (space_id) where space_id is not null;
create index idx_object_type on public.object (type_id);
create index idx_object_owner on public.object (owner_id) where owner_id is not null;
create index idx_object_live on public.object (organization_id) where deleted_at is null;
create index idx_object_search on public.object using gin (search_vector);

create trigger object_updated_at before update on public.object
  for each row execute function public.set_updated_at();

-- A parent must be in the same organization and must not be a descendant
-- (which would make a loop). Checked on insert and whenever the parent moves.
create or replace function app.guard_object_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_org uuid;
  v_cursor uuid;
  v_depth integer := 0;
begin
  if new.parent_object_id is null then
    return new;
  end if;

  select o.organization_id into v_parent_org
  from public.object o where o.id = new.parent_object_id;
  if v_parent_org is distinct from new.organization_id then
    raise exception 'An object''s parent must be in the same organization.'
      using errcode = '23514';
  end if;

  v_cursor := new.parent_object_id;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'An object cannot be nested inside itself.'
        using errcode = '23514';
    end if;
    v_depth := v_depth + 1;
    if v_depth > 1000 then
      raise exception 'Objects are nested too deeply.' using errcode = '23514';
    end if;
    select o.parent_object_id into v_cursor from public.object o where o.id = v_cursor;
  end loop;

  return new;
end;
$$;

create trigger object_parent_guard
  before insert or update of parent_object_id, organization_id on public.object
  for each row execute function app.guard_object_parent();

alter table public.object enable row level security;

create policy object_read on public.object for select to authenticated
  using (public.can(id, 'view'));
-- No insert, update or delete policy: see the header.

revoke all on public.object from anon;
revoke insert, update, delete, truncate on public.object from authenticated;

-- ---------------------------------------------------------------------------
-- Native types, seeded for every organization
-- ---------------------------------------------------------------------------

create or replace function app.seed_native_object_types(p_organization uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.object_type
    (organization_id, key, name_en, name_fr, icon, kind, native_table, default_lens)
  values
    (p_organization, 'task', 'Task', 'Tâche', 'check-square', 'native', 'task', 'table'),
    (p_organization, 'project', 'Project', 'Projet', 'folder-kanban', 'native', 'project', 'document'),
    (p_organization, 'meeting', 'Meeting', 'Réunion', 'calendar-clock', 'native', 'meeting', 'document'),
    (p_organization, 'decision', 'Decision', 'Décision', 'gavel', 'native', 'decision', 'document'),
    (p_organization, 'risk', 'Risk', 'Risque', 'triangle-alert', 'native', 'risk', 'table'),
    (p_organization, 'outcome_metric', 'Outcome metric', 'Indicateur de résultat', 'target', 'native', 'outcome_metric', 'table'),
    (p_organization, 'person', 'Person', 'Personne', 'user', 'native', 'user_profile', 'document'),
    (p_organization, 'team', 'Team', 'Équipe', 'users', 'native', 'team', 'document'),
    (p_organization, 'event', 'Event', 'Événement', 'calendar', 'native', 'event', 'document'),
    (p_organization, 'contact', 'Contact', 'Contact', 'contact', 'native', 'crm_contact', 'document'),
    (p_organization, 'document', 'Document', 'Document', 'file-text', 'native', 'document', 'document')
  on conflict (organization_id, key) do nothing;
$$;

revoke all on function app.seed_native_object_types(uuid) from public, anon, authenticated;

create or replace function app.seed_native_object_types_for_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_native_object_types(new.id);
  return new;
end;
$$;

revoke all on function app.seed_native_object_types_for_new_organization() from public, anon, authenticated;

create trigger organization_object_types_seed after insert on public.organization
  for each row execute function app.seed_native_object_types_for_new_organization();

select app.seed_native_object_types(o.id) from public.organization o;

-- ---------------------------------------------------------------------------
-- Native table mapping and the sync trigger (used by M1b, M1c)
-- ---------------------------------------------------------------------------

-- One row per native table. Column names are read from the row as JSON, so
-- registering a table is a row here plus a trigger, never new code.
create table app.native_object_map (
  native_table text primary key,
  type_key text not null,
  title_column text not null,
  owner_column text,
  created_by_column text,
  -- The first of these columns that names an existing object in the same
  -- organization becomes the parent.
  parent_columns text[] not null default '{}',
  -- Archived when this column is not null, or, when archived_values is set,
  -- when its value is one of them.
  archived_column text,
  archived_values text[]
);

comment on table app.native_object_map is
  'Which native column feeds each object field (M1a). Rows are added by the M1b/M1c migrations.';

alter table app.native_object_map enable row level security;
revoke all on app.native_object_map from public, anon, authenticated;

-- A uuid from a JSON field, or null when it is missing or not a uuid.
create or replace function app.jsonb_uuid(p_row jsonb, p_key text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_key is null or p_row ->> p_key is null then
    return null;
  end if;
  return (p_row ->> p_key)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function app.jsonb_uuid(jsonb, text) from public, anon, authenticated;

-- Writes (inserts or refreshes) the object row for one native row.
create or replace function app.upsert_native_object(p_table text, p_row jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map app.native_object_map;
  v_id uuid := app.jsonb_uuid(p_row, 'id');
  v_org uuid := app.jsonb_uuid(p_row, 'organization_id');
  v_type uuid;
  v_parent uuid;
  v_candidate uuid;
  v_column text;
  v_owner uuid;
  v_created_by uuid;
  v_actor uuid := (select auth.uid());
  v_archived_raw text;
  v_archived timestamptz;
  v_existing_archived timestamptz;
begin
  select * into v_map from app.native_object_map m where m.native_table = p_table;
  if not found or v_id is null or v_org is null then
    return;
  end if;

  select t.id into v_type from public.object_type t
  where t.organization_id = v_org and t.key = v_map.type_key;
  if v_type is null then
    perform app.seed_native_object_types(v_org);
    select t.id into v_type from public.object_type t
    where t.organization_id = v_org and t.key = v_map.type_key;
  end if;

  foreach v_column in array v_map.parent_columns loop
    v_candidate := app.jsonb_uuid(p_row, v_column);
    if v_candidate is not null and v_candidate <> v_id and exists (
      select 1 from public.object o
      where o.id = v_candidate and o.organization_id = v_org
    ) then
      v_parent := v_candidate;
      exit;
    end if;
  end loop;

  v_owner := app.jsonb_uuid(p_row, v_map.owner_column);
  if v_owner is not null and not exists (select 1 from public.user_profile u where u.id = v_owner) then
    v_owner := null;
  end if;
  v_created_by := app.jsonb_uuid(p_row, v_map.created_by_column);
  if v_created_by is not null and not exists (select 1 from public.user_profile u where u.id = v_created_by) then
    v_created_by := null;
  end if;
  if v_actor is not null and not exists (select 1 from public.user_profile u where u.id = v_actor) then
    v_actor := null;
  end if;

  select o.archived_at into v_existing_archived from public.object o where o.id = v_id;
  if v_map.archived_column is not null then
    v_archived_raw := p_row ->> v_map.archived_column;
    if v_map.archived_values is not null then
      if v_archived_raw = any (v_map.archived_values) then
        v_archived := coalesce(v_existing_archived, now());
      end if;
    elsif v_archived_raw is not null then
      begin
        v_archived := v_archived_raw::timestamptz;
      exception when others then
        v_archived := coalesce(v_existing_archived, now());
      end;
    end if;
  end if;

  insert into public.object as o (
    id, organization_id, type_id, parent_object_id, title, owner_id,
    created_by, updated_by, created_at, updated_at, archived_at
  ) values (
    v_id, v_org, v_type, v_parent,
    coalesce(p_row ->> v_map.title_column, ''),
    v_owner, coalesce(v_created_by, v_actor), coalesce(v_actor, v_created_by),
    coalesce((p_row ->> 'created_at')::timestamptz, now()),
    coalesce((p_row ->> 'updated_at')::timestamptz, now()),
    v_archived
  )
  on conflict (id) do update set
    parent_object_id = excluded.parent_object_id,
    title = excluded.title,
    owner_id = excluded.owner_id,
    updated_by = coalesce(v_actor, o.updated_by),
    archived_at = excluded.archived_at
  where o.organization_id = excluded.organization_id and o.type_id = excluded.type_id;
end;
$$;

revoke all on function app.upsert_native_object(text, jsonb) from public, anon, authenticated;

-- Attached `after insert or update or delete` on each registered native table.
-- Deleting the native row deletes its object (events outlive it, M9a).
create or replace function app.sync_object_from_native()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.object o where o.id = old.id;
    return old;
  end if;
  perform app.upsert_native_object(tg_table_name, to_jsonb(new));
  return new;
end;
$$;

revoke all on function app.sync_object_from_native() from public, anon, authenticated;
