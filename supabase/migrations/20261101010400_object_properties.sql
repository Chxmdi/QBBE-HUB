-- Workspace OS M2a + M2b: properties (epic #199, design note section 4).
--
-- property_definition  the properties of each object type. Native columns are
--                      exposed as SYSTEM properties (system_column set): their
--                      values stay in the native table and are written there.
--                      Custom properties are added by owners and admins.
-- property_value       custom property values, one typed column per kind, with
--                      an index per kind so filters stay fast.
--
-- Property-level privacy: a custom property can be limited to some
-- organization roles (visible_to_roles). Its values are then absent, in RLS,
-- for everyone else, even people who can see the object. System properties
-- cannot be made private (their column is already readable through the native
-- table's own rules), so the check constraint refuses it.
--
-- Multi-select values are option KEYS (contracts.ts: SelectOption.key is a
-- string), so they are stored as a JSON array in value_json, not value_uuids.

-- ---------------------------------------------------------------------------
-- property_definition (M2a)
-- ---------------------------------------------------------------------------

create table public.property_definition (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  type_id uuid not null,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  name_en text not null check (btrim(name_en) <> ''),
  name_fr text not null check (btrim(name_fr) <> ''),
  kind text not null check (kind in (
    'text', 'number', 'currency', 'date', 'date_range', 'duration', 'status',
    'select', 'multi_select', 'person', 'relation', 'formula', 'location',
    'progress', 'rating', 'file', 'url', 'email', 'phone', 'checkbox',
    'created_by', 'created_time', 'edited_by', 'edited_time', 'rollup'
  )),
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  system_column text,
  visible_to_roles public.org_role[],
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (type_id, key),
  unique (id, organization_id),
  foreign key (type_id, organization_id) references public.object_type (id, organization_id) on delete cascade,
  -- Privacy only on custom properties (section 4, "System properties").
  constraint property_definition_private_custom_only check (
    system_column is null or visible_to_roles is null
  ),
  constraint property_definition_roles_not_empty check (
    visible_to_roles is null or cardinality(visible_to_roles) > 0
  )
);

comment on table public.property_definition is
  'Workspace OS properties (M2a). system_column set = a native column exposed as a system property; otherwise values live in property_value.';

create index idx_property_definition_type on public.property_definition (type_id, position);
create index idx_property_definition_org on public.property_definition (organization_id);

create trigger property_definition_updated_at before update on public.property_definition
  for each row execute function public.set_updated_at();

-- A system property must belong to a native type, and its kind and column
-- cannot be changed once created.
create or replace function app.guard_property_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.system_column is not null and not exists (
    select 1 from public.object_type t where t.id = new.type_id and t.kind = 'native'
  ) then
    raise exception 'Only native types have system properties.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
    new.kind is distinct from old.kind
    or new.system_column is distinct from old.system_column
    or new.type_id is distinct from old.type_id
    or new.organization_id is distinct from old.organization_id
    or new.key is distinct from old.key
  ) then
    raise exception 'A property''s key, kind, type and column cannot change.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_property_definition() from public, anon, authenticated;

create trigger property_definition_guard
  before insert or update on public.property_definition
  for each row execute function app.guard_property_definition();

alter table public.property_definition enable row level security;

create policy property_definition_read on public.property_definition for select to authenticated
  using (app.is_org_member(organization_id));
-- Owners and admins (two-step sign-in) add and edit custom properties only.
-- Derived kinds are computed by the system, and relation properties arrive
-- with V1-7, so neither can be added here yet.
create policy property_definition_admin_insert on public.property_definition for insert to authenticated
  with check (
    system_column is null
    and kind not in ('created_by', 'created_time', 'edited_by', 'edited_time', 'relation', 'rollup', 'formula')
    and app.is_org_admin(organization_id)
  );
create policy property_definition_admin_update on public.property_definition for update to authenticated
  using (system_column is null and app.is_org_admin(organization_id))
  with check (system_column is null and app.is_org_admin(organization_id));
-- No delete policy: a property is archived so history keeps its name.

revoke all on public.property_definition from anon;
revoke delete, truncate on public.property_definition from authenticated;

-- ---------------------------------------------------------------------------
-- System properties, seeded for every organization
-- ---------------------------------------------------------------------------

create or replace function app.seed_system_properties(p_organization uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with choice(set_key, key, en, fr, position) as (
    values
      ('task_status', 'not_started', 'Not started', 'Pas commencée', 1),
      ('task_status', 'ready', 'Ready', 'Prête', 2),
      ('task_status', 'in_progress', 'In progress', 'En cours', 3),
      ('task_status', 'waiting', 'Waiting', 'En attente', 4),
      ('task_status', 'blocked', 'Blocked', 'Bloquée', 5),
      ('task_status', 'in_review', 'In review', 'En révision', 6),
      ('task_status', 'completed', 'Completed', 'Terminée', 7),
      ('task_status', 'cancelled', 'Cancelled', 'Annulée', 8),
      ('priority', 'low', 'Low', 'Basse', 1),
      ('priority', 'medium', 'Medium', 'Moyenne', 2),
      ('priority', 'high', 'High', 'Haute', 3),
      ('priority', 'critical', 'Critical', 'Critique', 4),
      ('project_stage', 'proposed', 'Proposed', 'Proposé', 1),
      ('project_stage', 'approved', 'Approved', 'Approuvé', 2),
      ('project_stage', 'planning', 'Planning', 'Planification', 3),
      ('project_stage', 'active', 'Active', 'Actif', 4),
      ('project_stage', 'paused', 'Paused', 'En pause', 5),
      ('project_stage', 'completed', 'Completed', 'Terminé', 6),
      ('project_stage', 'cancelled', 'Cancelled', 'Annulé', 7),
      ('project_stage', 'archived', 'Archived', 'Archivé', 8),
      ('project_health', 'on_track', 'On track', 'En bonne voie', 1),
      ('project_health', 'at_risk', 'At risk', 'À risque', 2),
      ('project_health', 'off_track', 'Off track', 'En retard', 3),
      ('project_health', 'paused', 'Paused', 'En pause', 4),
      ('project_health', 'unknown', 'Unknown', 'Inconnu', 5)
  ),
  choices as (
    select set_key, jsonb_build_object('choices', jsonb_agg(
      jsonb_build_object('key', key, 'label', jsonb_build_object('en', en, 'fr', fr), 'color', null)
      order by position)) as options
    from choice group by set_key
  ),
  prop(type_key, key, en, fr, kind, system_column, choice_set, position) as (
    values
      ('task', 'title', 'Title', 'Titre', 'text', 'title', null, 1),
      ('task', 'status', 'Status', 'Statut', 'status', 'status', 'task_status', 2),
      ('task', 'priority', 'Priority', 'Priorité', 'select', 'priority', 'priority', 3),
      ('task', 'assignee', 'Assignee', 'Responsable', 'person', 'assignee_id', null, 4),
      ('task', 'requester', 'Requester', 'Demandeur', 'person', 'requester_id', null, 5),
      ('task', 'reviewer', 'Reviewer', 'Réviseur', 'person', 'reviewer_id', null, 6),
      ('task', 'start', 'Start', 'Début', 'date', 'start_at', null, 7),
      ('task', 'due', 'Due', 'Échéance', 'date', 'due_at', null, 8),
      ('task', 'estimate', 'Estimate (hours)', 'Estimation (heures)', 'number', 'estimate_hours', null, 9),
      ('task', 'project', 'Project', 'Projet', 'relation', 'project_id', null, 10),
      ('task', 'program', 'Program', 'Programme', 'relation', 'program_id', null, 11),
      ('task', 'completed_time', 'Completed', 'Terminée le', 'date', 'completed_at', null, 12),
      ('task', 'created_by', 'Created by', 'Créée par', 'created_by', 'created_by', null, 13),
      ('task', 'created_time', 'Created', 'Créée le', 'created_time', 'created_at', null, 14),
      ('task', 'edited_time', 'Edited', 'Modifiée le', 'edited_time', 'updated_at', null, 15),
      ('project', 'title', 'Name', 'Nom', 'text', 'name', null, 1),
      ('project', 'stage', 'Stage', 'Étape', 'status', 'stage', 'project_stage', 2),
      ('project', 'health', 'Health', 'Santé', 'select', 'health', 'project_health', 3),
      ('project', 'priority', 'Priority', 'Priorité', 'select', 'priority', 'priority', 4),
      ('project', 'owner', 'Owner', 'Responsable', 'person', 'owner_id', null, 5),
      ('project', 'sponsor', 'Sponsor', 'Parrain', 'person', 'sponsor_id', null, 6),
      ('project', 'start', 'Start', 'Début', 'date', 'start_date', null, 7),
      ('project', 'target', 'Target', 'Date cible', 'date', 'target_date', null, 8),
      ('project', 'program', 'Program', 'Programme', 'relation', 'program_id', null, 9),
      ('project', 'completed_time', 'Completed', 'Terminé le', 'date', 'completed_at', null, 10),
      ('project', 'created_by', 'Created by', 'Créé par', 'created_by', 'created_by', null, 11),
      ('project', 'created_time', 'Created', 'Créé le', 'created_time', 'created_at', null, 12),
      ('project', 'edited_time', 'Edited', 'Modifié le', 'edited_time', 'updated_at', null, 13),
      ('meeting', 'title', 'Title', 'Titre', 'text', 'title', null, 1),
      ('meeting', 'organizer', 'Organizer', 'Organisateur', 'person', 'organizer_id', null, 2),
      ('meeting', 'starts', 'Starts', 'Début', 'date', 'starts_at', null, 3),
      ('meeting', 'ends', 'Ends', 'Fin', 'date', 'ends_at', null, 4),
      ('meeting', 'location', 'Location', 'Lieu', 'text', 'location', null, 5),
      ('decision', 'title', 'Title', 'Titre', 'text', 'title', null, 1),
      ('decision', 'decided_by', 'Decided by', 'Décidée par', 'person', 'decided_by', null, 2),
      ('decision', 'decided_time', 'Decided', 'Décidée le', 'date', 'decided_at', null, 3),
      ('risk', 'title', 'Title', 'Titre', 'text', 'title', null, 1),
      ('risk', 'owner', 'Owner', 'Responsable', 'person', 'owner_id', null, 2),
      ('risk', 'score', 'Score', 'Cote', 'number', 'score', null, 3),
      ('risk', 'review', 'Review', 'Révision', 'date', 'review_at', null, 4),
      ('outcome_metric', 'title', 'Name', 'Nom', 'text', 'name', null, 1),
      ('outcome_metric', 'owner', 'Owner', 'Responsable', 'person', 'owner_id', null, 2),
      ('outcome_metric', 'baseline', 'Baseline', 'Point de départ', 'number', 'baseline', null, 3),
      ('outcome_metric', 'target', 'Target', 'Cible', 'number', 'target', null, 4),
      ('person', 'title', 'Name', 'Nom', 'text', 'full_name', null, 1),
      ('person', 'email', 'Email', 'Courriel', 'email', 'email', null, 2),
      ('person', 'job_title', 'Job title', 'Poste', 'text', 'title', null, 3),
      ('team', 'title', 'Name', 'Nom', 'text', 'name', null, 1),
      ('team', 'owner', 'Owner', 'Responsable', 'person', 'owner_id', null, 2),
      ('event', 'title', 'Name', 'Nom', 'text', 'name', null, 1),
      ('event', 'owner', 'Owner', 'Responsable', 'person', 'owner_id', null, 2),
      ('event', 'starts', 'Starts', 'Début', 'date', 'starts_at', null, 3),
      ('event', 'ends', 'Ends', 'Fin', 'date', 'ends_at', null, 4),
      ('event', 'location', 'Location', 'Lieu', 'text', 'location', null, 5),
      ('contact', 'title', 'Name', 'Nom', 'text', 'full_name', null, 1),
      ('contact', 'owner', 'Owner', 'Responsable', 'person', 'owner_id', null, 2),
      ('contact', 'next_action', 'Next action', 'Prochaine action', 'date', 'next_action_at', null, 3),
      ('document', 'title', 'Title', 'Titre', 'text', 'title', null, 1),
      ('document', 'owner', 'Owner', 'Responsable', 'person', 'owner_id', null, 2),
      ('document', 'created_time', 'Created', 'Créé le', 'created_time', 'created_at', null, 3),
      ('document', 'edited_time', 'Edited', 'Modifié le', 'edited_time', 'updated_at', null, 4)
  )
  insert into public.property_definition
    (organization_id, type_id, key, name_en, name_fr, kind, options, system_column, position)
  select p_organization, t.id, p.key, p.en, p.fr, p.kind,
         coalesce(c.options, '{}'::jsonb)
           || case when p.kind = 'relation' then jsonb_build_object('relationTypeKey', 'contains') else '{}'::jsonb end,
         p.system_column, p.position
  from prop p
  join public.object_type t on t.organization_id = p_organization and t.key = p.type_key
  left join choices c on c.set_key = p.choice_set
  on conflict (type_id, key) do nothing;
$$;

revoke all on function app.seed_system_properties(uuid) from public, anon, authenticated;

-- New organizations get their system properties right after their types.
create or replace function app.seed_native_object_types_for_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_native_object_types(new.id);
  perform app.seed_system_properties(new.id);
  return new;
end;
$$;

select app.seed_system_properties(o.id) from public.organization o;

-- ---------------------------------------------------------------------------
-- property_value (M2b)
-- ---------------------------------------------------------------------------

create table public.property_value (
  object_id uuid not null references public.object (id) on delete cascade,
  property_id uuid not null references public.property_definition (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  value_text text,
  value_number numeric,
  value_date date,
  value_date_end date,
  value_bool boolean,
  value_uuids uuid[],
  value_json jsonb,
  updated_by uuid references public.user_profile (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (object_id, property_id),
  check (value_date_end is null or value_date is not null),
  check (value_date_end is null or value_date_end >= value_date)
);

comment on table public.property_value is
  'Workspace OS custom property values (M2b). One typed column per kind; relation values live in object_relation, system values in their native column.';

create index idx_property_value_text on public.property_value (property_id, value_text) include (object_id)
  where value_text is not null;
create index idx_property_value_number on public.property_value (property_id, value_number) include (object_id)
  where value_number is not null;
create index idx_property_value_date on public.property_value (property_id, value_date) include (object_id)
  where value_date is not null;
create index idx_property_value_bool on public.property_value (property_id, value_bool) include (object_id)
  where value_bool is not null;
create index idx_property_value_uuids on public.property_value using gin (value_uuids)
  where value_uuids is not null;
create index idx_property_value_json on public.property_value using gin (value_json jsonb_path_ops)
  where value_json is not null;
create index idx_property_value_org on public.property_value (organization_id);
create index idx_property_value_property on public.property_value (property_id);

-- Which typed columns each kind may fill. Anything else must be null.
create or replace function app.property_value_columns(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('text', 'url', 'email', 'phone', 'select', 'status') then array['value_text']
    when p_kind in ('number', 'currency', 'duration', 'progress', 'rating', 'rollup') then array['value_number']
    when p_kind = 'date' then array['value_date']
    when p_kind = 'date_range' then array['value_date', 'value_date_end']
    when p_kind = 'checkbox' then array['value_bool']
    when p_kind in ('person', 'file') then array['value_uuids']
    when p_kind in ('multi_select', 'location', 'formula') then array['value_json']
    else array[]::text[]
  end;
$$;

revoke all on function app.property_value_columns(text) from public, anon;

-- The property must be a custom property of this object's type, in its
-- organization, and the value must use exactly the kind's columns.
create or replace function app.guard_property_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property public.property_definition;
  v_object public.object;
  v_allowed text[];
  v_row jsonb;
  v_column text;
begin
  select * into v_property from public.property_definition p where p.id = new.property_id;
  select * into v_object from public.object o where o.id = new.object_id;

  if v_property.id is null or v_object.id is null
    or v_property.type_id <> v_object.type_id
    or v_property.organization_id <> v_object.organization_id
  then
    raise exception 'This property does not belong to this object''s type.' using errcode = '23514';
  end if;
  if v_property.system_column is not null then
    raise exception 'A system property is stored in its native column.' using errcode = '23514';
  end if;
  if v_property.archived_at is not null then
    raise exception 'This property is archived.' using errcode = '23514';
  end if;

  new.organization_id := v_object.organization_id;
  v_allowed := app.property_value_columns(v_property.kind);
  if cardinality(v_allowed) = 0 then
    raise exception 'Values of kind % are not stored here.', v_property.kind using errcode = '23514';
  end if;

  v_row := to_jsonb(new);
  foreach v_column in array array[
    'value_text', 'value_number', 'value_date', 'value_date_end', 'value_bool', 'value_uuids', 'value_json'
  ] loop
    if v_row -> v_column <> 'null'::jsonb and not (v_column = any (v_allowed)) then
      raise exception 'A % property cannot hold %.', v_property.kind, v_column using errcode = '23514';
    end if;
  end loop;

  if v_property.kind = 'multi_select' and new.value_json is not null
    and jsonb_typeof(new.value_json) <> 'array' then
    raise exception 'A multi-select value is a list of option keys.' using errcode = '23514';
  end if;
  if v_property.kind = 'location' and new.value_json is not null and not (
    jsonb_typeof(new.value_json -> 'lat') = 'number' and jsonb_typeof(new.value_json -> 'lng') = 'number'
  ) then
    raise exception 'A location needs a latitude and a longitude.' using errcode = '23514';
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(
    (select u.id from public.user_profile u where u.id = (select auth.uid())),
    case when tg_op = 'UPDATE' then old.updated_by end
  );
  return new;
end;
$$;

revoke all on function app.guard_property_value() from public, anon, authenticated;

create trigger property_value_guard
  before insert or update on public.property_value
  for each row execute function app.guard_property_value();

-- Property-level privacy: true when the property is not restricted, or the
-- caller's active role in its organization is one of the allowed roles.
create or replace function app.can_view_property(p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.property_definition p
    where p.id = p_property
      and (
        p.visible_to_roles is null
        or exists (
          select 1 from public.organization_membership m
          where m.organization_id = p.organization_id
            and m.user_id = (select auth.uid())
            and m.status = 'active'
            and m.role = any (p.visible_to_roles)
        )
      )
  );
$$;

-- Users write only kinds they enter by hand; rollups and formulas are
-- computed by the system (V1-7, V1-8).
create or replace function app.can_write_property(p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_view_property(p_property) and exists (
    select 1 from public.property_definition p
    where p.id = p_property
      and p.system_column is null
      and p.archived_at is null
      and p.kind not in ('rollup', 'formula', 'relation', 'created_by', 'created_time', 'edited_by', 'edited_time')
  );
$$;

revoke all on function app.can_view_property(uuid) from public, anon;
revoke all on function app.can_write_property(uuid) from public, anon;
grant execute on function app.can_view_property(uuid) to authenticated;
grant execute on function app.can_write_property(uuid) to authenticated;

alter table public.property_value enable row level security;

create policy property_value_read on public.property_value for select to authenticated
  using (public.can(object_id, 'view') and app.can_view_property(property_id));
create policy property_value_insert on public.property_value for insert to authenticated
  with check (public.can(object_id, 'edit_content') and app.can_write_property(property_id));
create policy property_value_update on public.property_value for update to authenticated
  using (public.can(object_id, 'edit_content') and app.can_write_property(property_id))
  with check (public.can(object_id, 'edit_content') and app.can_write_property(property_id));
create policy property_value_delete on public.property_value for delete to authenticated
  using (public.can(object_id, 'edit_content') and app.can_write_property(property_id));

revoke all on public.property_value from anon;
revoke truncate on public.property_value from authenticated;
