-- W0-8 query engine spike: a minimal object layer with typed custom
-- properties, used only to measure and attack the lens query compiler.
--
-- NOT A MIGRATION. It lives outside supabase/migrations on purpose, so
-- `supabase db reset`, CI and every hosted project never see it. Apply it to
-- the LOCAL stack only, with:
--
--   node scripts/spikes/w0-8-query.mjs apply
--
-- Everything sits in its own schema, wos_spike, so `... drop` removes it in
-- one statement. The real tables arrive in Wave 1 (M1a, M2a, M2b, M3a).

begin;

drop schema if exists wos_spike cascade;
create schema wos_spike;

create extension if not exists pg_trgm with schema extensions;

-- One row per kind of object (Task, Project, ...). Scoped to an organization.
create table wos_spike.object_type (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  name_en text not null,
  name_fr text not null,
  unique (organization_id, key)
);

-- The allow-list the compiler reads. `key` is the only name a query spec can
-- use; the compiler never writes it into SQL (it binds `id` as a parameter).
create table wos_spike.property_definition (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references wos_spike.object_type (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  name_en text not null,
  name_fr text not null,
  kind text not null check (kind in (
    'text', 'number', 'date', 'select', 'multi_select', 'person', 'checkbox', 'relation'
  )),
  -- select / multi_select: [{"id": "todo", "en": "To do", "fr": "À faire"}, ...]
  options jsonb not null default '[]'::jsonb,
  -- relation: the type on the other end.
  target_type_id uuid references wos_spike.object_type (id) on delete cascade,
  position int not null default 0,
  unique (type_id, key),
  check ((kind = 'relation') = (target_type_id is not null))
);

-- The object registry (A1), reduced to what a lens needs.
create table wos_spike.object (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  type_id uuid not null references wos_spike.object_type (id) on delete cascade,
  space_id uuid references public.program (id) on delete set null,
  title text not null,
  owner_id uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index object_type_space_idx on wos_spike.object (type_id, space_id) where archived_at is null;
create index object_type_updated_idx on wos_spike.object (type_id, updated_at) where archived_at is null;
create index object_type_created_idx on wos_spike.object (type_id, created_at) where archived_at is null;
create index object_type_title_idx on wos_spike.object (type_id, title) where archived_at is null;
create index object_owner_idx on wos_spike.object (owner_id);
create index object_title_trgm_idx on wos_spike.object using gin (title extensions.gin_trgm_ops);

-- Custom property values (A2): one typed row per (object, property). Which
-- column holds the value depends on the property's kind:
--   text, select -> value_text      number -> value_number
--   date -> value_date              checkbox -> value_bool
--   multi_select, person -> value_json (a JSON array of option ids / user ids)
-- relation values live in object_relation, not here.
-- An empty value is a missing row, never an empty string or [].
create table wos_spike.property_value (
  object_id uuid not null references wos_spike.object (id) on delete cascade,
  property_id uuid not null references wos_spike.property_definition (id) on delete cascade,
  value_text text,
  value_number numeric,
  value_date date,
  value_bool boolean,
  value_json jsonb,
  primary key (object_id, property_id)
);

-- Per-kind indexes: each filter hits (property_id, typed value).
create index property_value_text_idx on wos_spike.property_value (property_id, value_text) where value_text is not null;
create index property_value_number_idx on wos_spike.property_value (property_id, value_number) where value_number is not null;
create index property_value_date_idx on wos_spike.property_value (property_id, value_date) where value_date is not null;
create index property_value_bool_idx on wos_spike.property_value (property_id, value_bool) where value_bool is not null;
create index property_value_json_idx on wos_spike.property_value using gin (value_json jsonb_path_ops) where value_json is not null;
create index property_value_text_trgm_idx on wos_spike.property_value using gin (value_text extensions.gin_trgm_ops) where value_text is not null;

-- Relation values (A3), keyed by the relation property.
create table wos_spike.object_relation (
  from_id uuid not null references wos_spike.object (id) on delete cascade,
  property_id uuid not null references wos_spike.property_definition (id) on delete cascade,
  to_id uuid not null references wos_spike.object (id) on delete cascade,
  primary key (from_id, property_id, to_id)
);
create index object_relation_to_idx on wos_spike.object_relation (to_id, property_id);

-- ---------------------------------------------------------------------------
-- Row-level security. The object policy is a stand-in for app.can (A6): the
-- same set-based helpers the task_read policy uses, applied to spaces
-- (programs). Values and relations are visible only with their object(s).
-- ---------------------------------------------------------------------------
alter table wos_spike.object_type enable row level security;
alter table wos_spike.property_definition enable row level security;
alter table wos_spike.object enable row level security;
alter table wos_spike.property_value enable row level security;
alter table wos_spike.object_relation enable row level security;

create policy object_type_read on wos_spike.object_type for select to authenticated
  using (organization_id = any ((select app.task_read_member_organizations())::uuid[]));

create policy property_definition_read on wos_spike.property_definition for select to authenticated
  using (exists (select 1 from wos_spike.object_type t where t.id = property_definition.type_id));

create policy object_read on wos_spike.object for select to authenticated
  using (
    organization_id = any ((select app.task_read_member_organizations())::uuid[])
    and (
      organization_id = any ((select app.task_read_organization_wide())::uuid[])
      or space_id = any ((select app.readable_program_ids())::uuid[])
      or owner_id = (select auth.uid())
    )
  );

create policy property_value_read on wos_spike.property_value for select to authenticated
  using (exists (select 1 from wos_spike.object o where o.id = property_value.object_id));

create policy object_relation_read on wos_spike.object_relation for select to authenticated
  using (
    exists (select 1 from wos_spike.object o where o.id = object_relation.from_id)
    and exists (select 1 from wos_spike.object o where o.id = object_relation.to_id)
  );

-- Read only: the spike never writes as a viewer.
grant usage on schema wos_spike to authenticated;
grant select on all tables in schema wos_spike to authenticated;

-- The login role the server-side runner connects as. It can become
-- `authenticated` and nothing else: no service_role, no table rights of its
-- own (NOINHERIT), so every query it runs is subject to RLS. The password is
-- set by the spike script at run time, never stored in the repo.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'wos_spike_lens_runner') then
    create role wos_spike_lens_runner login noinherit;
  end if;
end $$;
grant authenticated to wos_spike_lens_runner;

commit;
