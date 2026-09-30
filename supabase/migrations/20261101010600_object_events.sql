-- Workspace OS M9a: object_event, written by triggers (epic #199, design note section 6).
--
-- Every change to a native record, a custom property value, a stored relation
-- or a custom object becomes one row in object_event: who (actor), what
-- (verb), which properties changed (before and after, by system property key,
-- never by column name) and, when an action made it, which change set.
--
-- Written by triggers only, never by the application. The actor is the
-- signed-in person unless the session says otherwise with
--   set_config('app.actor', 'automation:<workflow id>', true)
-- (or integration:<name>, team:<id>, system), which the workflow runner and
-- integrations use so their changes are not labelled with a person. The
-- action layer (M13) sets app.change_set_id the same way.
--
-- Only system properties are compared, so noise columns (sort_key,
-- search_text) never create events.
--
-- Reading: whoever can view the object, or an owner/admin of its
-- organization (so deletions stay visible to them), and only when every
-- property in the event's changes is visible to them. An event touching a
-- private property is absent, not masked, for everyone else.
--
-- object_event_cursor keeps each consumer's position (the outbox). It has no
-- API access; the job runner uses the service role.

create table public.object_event (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  organization_id uuid not null references public.organization (id) on delete cascade,
  -- No foreign key: events outlive a deleted object (history and audit).
  object_id uuid not null,
  object_type text not null,
  actor_kind text not null check (actor_kind in ('person', 'team', 'automation', 'integration', 'system')),
  actor_id text,
  verb text not null check (verb in (
    'created', 'updated', 'archived', 'restored', 'deleted', 'linked', 'unlinked', 'commented'
  )),
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  change_set_id uuid,
  occurred_at timestamptz not null default now(),
  unique (seq)
);

comment on table public.object_event is
  'Workspace OS event log (M9a). Written by triggers only; read with view on the object and every changed property.';

create index idx_object_event_object on public.object_event (object_id, occurred_at desc);
create index idx_object_event_org_seq on public.object_event (organization_id, seq);
create index idx_object_event_change_set on public.object_event (change_set_id) where change_set_id is not null;

create table public.object_event_cursor (
  consumer text primary key check (consumer ~ '^[a-z][a-z0-9_]{0,62}$'),
  last_seq bigint not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.object_event_cursor is
  'Each object_event consumer''s position (outbox). Service role only.';

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

-- Inserts one event, labelled with the session's actor and change set.
create or replace function app.record_object_event(
  p_organization uuid,
  p_object uuid,
  p_type text,
  p_verb text,
  p_changes jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := nullif(current_setting('app.actor', true), '');
  v_kind text;
  v_id text;
  v_change_set uuid;
begin
  if p_organization is null or p_object is null then
    return;
  end if;

  if v_actor is not null then
    v_kind := split_part(v_actor, ':', 1);
    v_id := nullif(substr(v_actor, length(v_kind) + 2), '');
    if v_kind not in ('person', 'team', 'automation', 'integration', 'system') then
      v_kind := 'system';
      v_id := null;
    end if;
  elsif (select auth.uid()) is not null then
    v_kind := 'person';
    v_id := (select auth.uid())::text;
  else
    v_kind := 'system';
  end if;

  begin
    v_change_set := nullif(current_setting('app.change_set_id', true), '')::uuid;
  exception when invalid_text_representation then
    v_change_set := null;
  end;

  insert into public.object_event
    (organization_id, object_id, object_type, actor_kind, actor_id, verb, changes, change_set_id)
  values
    (p_organization, p_object, p_type, v_kind, v_id, p_verb, coalesce(p_changes, '[]'::jsonb), v_change_set);
end;
$$;

revoke all on function app.record_object_event(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- Before/after of every system property of the row's type that changed.
create or replace function app.system_property_changes(
  p_organization uuid,
  p_type text,
  p_old jsonb,
  p_new jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'property', p.key,
      'before', coalesce(p_old -> p.system_column, 'null'::jsonb),
      'after', coalesce(p_new -> p.system_column, 'null'::jsonb)
    ) order by p.position
  ), '[]'::jsonb)
  from public.property_definition p
  join public.object_type t on t.id = p.type_id
  where t.organization_id = p_organization
    and t.key = p_type
    and p.system_column is not null
    and (p_old -> p.system_column) is distinct from (p_new -> p.system_column);
$$;

revoke all on function app.system_property_changes(uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- Whether a row counts as archived, by the native map's rule.
create or replace function app.native_row_archived(p_map app.native_object_map, p_row jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_map.archived_column is null then false
    when p_map.archived_values is not null then coalesce((p_row ->> p_map.archived_column) = any (p_map.archived_values), false)
    else p_row ->> p_map.archived_column is not null
  end;
$$;

revoke all on function app.native_row_archived(app.native_object_map, jsonb) from public, anon, authenticated;

-- Attached to every native table in app.native_object_map (except
-- user_profile, whose people are handled from organization_membership).
create or replace function app.object_event_from_native()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map app.native_object_map;
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
  v_was boolean;
  v_is boolean;
begin
  select * into v_map from app.native_object_map m where m.native_table = tg_table_name;
  if not found then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform app.record_object_event(new.organization_id, new.id, v_map.type_key, 'created');
    return null;
  end if;
  if tg_op = 'DELETE' then
    perform app.record_object_event(old.organization_id, old.id, v_map.type_key, 'deleted');
    return null;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  v_changes := app.system_property_changes(new.organization_id, v_map.type_key, v_old, v_new);
  v_was := app.native_row_archived(v_map, v_old);
  v_is := app.native_row_archived(v_map, v_new);

  if v_is and not v_was then
    perform app.record_object_event(new.organization_id, new.id, v_map.type_key, 'archived', v_changes);
  elsif v_was and not v_is then
    perform app.record_object_event(new.organization_id, new.id, v_map.type_key, 'restored', v_changes);
  elsif jsonb_array_length(v_changes) > 0 then
    perform app.record_object_event(new.organization_id, new.id, v_map.type_key, 'updated', v_changes);
  end if;
  return null;
end;
$$;

revoke all on function app.object_event_from_native() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'task', 'project', 'meeting', 'decision', 'risk', 'outcome_metric', 'team', 'event', 'crm_contact', 'document'
  ] loop
    execute format(
      'create trigger %1$s_object_event after insert or update or delete on public.%1$I
         for each row execute function app.object_event_from_native()',
      v_table
    );
  end loop;
end;
$$;

-- People: joining, leaving, deactivation and reactivation.
create or replace function app.object_event_from_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.record_object_event(new.organization_id, new.user_id, 'person', 'created');
  elsif tg_op = 'DELETE' then
    perform app.record_object_event(old.organization_id, old.user_id, 'person', 'deleted');
  elsif new.status is distinct from old.status then
    perform app.record_object_event(
      new.organization_id, new.user_id, 'person',
      case when new.status = 'active' then 'restored' else 'archived' end,
      jsonb_build_array(jsonb_build_object('property', 'status', 'before', to_jsonb(old.status::text), 'after', to_jsonb(new.status::text)))
    );
  end if;
  return null;
end;
$$;

revoke all on function app.object_event_from_membership() from public, anon, authenticated;

create trigger organization_membership_object_event
  after insert or update or delete on public.organization_membership
  for each row execute function app.object_event_from_membership();

-- People: a profile change is an update of the person in each organization.
create or replace function app.object_event_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_changes jsonb;
begin
  for v_org in
    select m.organization_id from public.organization_membership m where m.user_id = new.id
  loop
    v_changes := app.system_property_changes(v_org, 'person', to_jsonb(old), to_jsonb(new));
    if jsonb_array_length(v_changes) > 0 then
      perform app.record_object_event(v_org, new.id, 'person', 'updated', v_changes);
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function app.object_event_from_profile() from public, anon, authenticated;

create trigger user_profile_object_event
  after update on public.user_profile
  for each row execute function app.object_event_from_profile();

-- Custom property values. The change names the property by key and carries
-- its id, so privacy can be enforced when the event is read.
create or replace function app.object_event_from_property_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.property_value;
  v_property public.property_definition;
  v_type text;
  v_before jsonb;
  v_after jsonb;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  select * into v_property from public.property_definition p where p.id = v_row.property_id;
  select t.key into v_type from public.object o join public.object_type t on t.id = o.type_id
  where o.id = v_row.object_id;
  if v_property.id is null or v_type is null then
    return null;
  end if;

  if tg_op <> 'INSERT' then
    v_before := jsonb_strip_nulls(to_jsonb(old) - array['object_id', 'property_id', 'organization_id', 'updated_by', 'updated_at']);
  end if;
  if tg_op <> 'DELETE' then
    v_after := jsonb_strip_nulls(to_jsonb(new) - array['object_id', 'property_id', 'organization_id', 'updated_by', 'updated_at']);
  end if;
  if v_before is not distinct from v_after then
    return null;
  end if;

  perform app.record_object_event(
    v_row.organization_id, v_row.object_id, v_type, 'updated',
    jsonb_build_array(jsonb_build_object(
      'property', v_property.key,
      'property_id', v_property.id,
      'before', coalesce(v_before, 'null'::jsonb),
      'after', coalesce(v_after, 'null'::jsonb)
    ))
  );
  return null;
end;
$$;

revoke all on function app.object_event_from_property_value() from public, anon, authenticated;

create trigger property_value_object_event
  after insert or update or delete on public.property_value
  for each row execute function app.object_event_from_property_value();

-- Stored relations: linked / unlinked, recorded on both ends.
create or replace function app.object_event_from_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.object_relation;
  v_key text;
  v_from_type text;
  v_to_type text;
  v_verb text := case when tg_op = 'DELETE' then 'unlinked' else 'linked' end;
begin
  if tg_op = 'UPDATE' then
    return null;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  select rt.key into v_key from public.relation_type rt where rt.id = v_row.relation_type_id;
  select t.key into v_from_type from public.object o join public.object_type t on t.id = o.type_id where o.id = v_row.from_id;
  select t.key into v_to_type from public.object o join public.object_type t on t.id = o.type_id where o.id = v_row.to_id;

  if v_from_type is not null then
    perform app.record_object_event(v_row.organization_id, v_row.from_id, v_from_type, v_verb,
      jsonb_build_array(jsonb_build_object('relation', v_key, 'direction', 'outgoing',
        'other', v_row.to_id, 'other_type', v_to_type)));
  end if;
  if v_to_type is not null then
    perform app.record_object_event(v_row.organization_id, v_row.to_id, v_to_type, v_verb,
      jsonb_build_array(jsonb_build_object('relation', v_key, 'direction', 'incoming',
        'other', v_row.from_id, 'other_type', v_from_type)));
  end if;
  return null;
end;
$$;

revoke all on function app.object_event_from_relation() from public, anon, authenticated;

create trigger object_relation_object_event
  after insert or delete on public.object_relation
  for each row execute function app.object_event_from_relation();

-- Custom objects (native ones are covered by their table's trigger).
create or replace function app.object_event_from_custom_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.object := case when tg_op = 'DELETE' then old else new end;
  v_type public.object_type;
  v_changes jsonb := '[]'::jsonb;
begin
  select * into v_type from public.object_type t where t.id = v_row.type_id;
  if v_type.kind is distinct from 'custom' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform app.record_object_event(new.organization_id, new.id, v_type.key, 'created');
  elsif tg_op = 'DELETE' then
    perform app.record_object_event(old.organization_id, old.id, v_type.key, 'deleted');
  else
    select coalesce(jsonb_agg(jsonb_build_object('property', f.key, 'before', f.b, 'after', f.a)), '[]'::jsonb)
    into v_changes
    from (values
      ('title', to_jsonb(old.title), to_jsonb(new.title)),
      ('owner', to_jsonb(old.owner_id), to_jsonb(new.owner_id)),
      ('parent', to_jsonb(old.parent_object_id), to_jsonb(new.parent_object_id)),
      ('icon', to_jsonb(old.icon), to_jsonb(new.icon))
    ) as f(key, b, a)
    where f.b is distinct from f.a;

    if new.archived_at is not null and old.archived_at is null then
      perform app.record_object_event(new.organization_id, new.id, v_type.key, 'archived', v_changes);
    elsif new.archived_at is null and old.archived_at is not null then
      perform app.record_object_event(new.organization_id, new.id, v_type.key, 'restored', v_changes);
    elsif new.deleted_at is not null and old.deleted_at is null then
      perform app.record_object_event(new.organization_id, new.id, v_type.key, 'deleted', v_changes);
    elsif new.deleted_at is null and old.deleted_at is not null then
      perform app.record_object_event(new.organization_id, new.id, v_type.key, 'restored', v_changes);
    elsif jsonb_array_length(v_changes) > 0 then
      perform app.record_object_event(new.organization_id, new.id, v_type.key, 'updated', v_changes);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function app.object_event_from_custom_object() from public, anon, authenticated;

create trigger object_custom_object_event
  after insert or update or delete on public.object
  for each row execute function app.object_event_from_custom_object();

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- True when the caller may see every custom property named in the changes.
create or replace function app.can_view_event_changes(p_changes jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(p_changes) = 'array' then p_changes else '[]'::jsonb end) c
    where c ? 'property_id'
      and not app.can_view_property(app.jsonb_uuid(c, 'property_id'))
  );
$$;

revoke all on function app.can_view_event_changes(jsonb) from public, anon;
grant execute on function app.can_view_event_changes(jsonb) to authenticated;

alter table public.object_event enable row level security;
alter table public.object_event_cursor enable row level security;

create policy object_event_read on public.object_event for select to authenticated
  using (
    (public.can(object_id, 'view') or app.is_org_admin(organization_id))
    and app.can_view_event_changes(changes)
  );
-- No write policies: triggers write with definer rights.

revoke all on public.object_event from anon;
revoke insert, update, delete, truncate on public.object_event from authenticated;
revoke all on public.object_event_cursor from anon, authenticated;
