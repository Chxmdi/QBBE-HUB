-- Workspace OS V1-7: two-way relations, cardinality and rollups (epic #199,
-- design note section 5).
--
-- Two-way relations. public.create_two_way_relation makes one relation type
-- and a relation property on each side ("Tasks" on a grant, "Grant" on a
-- task), each pointing at the other. A link is one object_relation row, so
-- both sides always agree. Cardinality (one-to-one, one-to-many,
-- many-to-many) is enforced by the M3a guard; changing a relation type to a
-- stricter cardinality is refused while existing links break it.
--
-- Native links can be used too: a relation property may name a native
-- relation type (a project "contains" its tasks), read through
-- object_relation_all, but links of a native type are still changed on the
-- record itself.
--
-- Rollups. public.create_rollup_property adds a property that summarises a
-- property of the related objects (count, sum, average, min, max). The
-- result is STORED in property_value.value_number, so lenses sort and filter
-- on it like any number, and is refreshed by triggers when anything it
-- depends on changes: a link added or removed, a related object's custom
-- value, or a related native record (a task's estimate, a task moved to
-- another project). Refreshing is skipped entirely for organizations that
-- have no rollups.
--
-- Rollups are computed with definer rights across every related object, so
-- they count objects the viewer may not see individually, as a total does in
-- a report today. A rollup over a private property is refused.

create index if not exists idx_property_definition_rollups
  on public.property_definition (organization_id) where kind = 'rollup' and archived_at is null;

-- ---------------------------------------------------------------------------
-- Cardinality changes
-- ---------------------------------------------------------------------------

create or replace function app.guard_relation_type_cardinality()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cardinality is not distinct from old.cardinality then
    return new;
  end if;
  if new.cardinality in ('one_to_many', 'one_to_one') and exists (
    select 1 from public.object_relation r where r.relation_type_id = new.id
    group by r.to_id having count(*) > 1
  ) then
    raise exception 'Some items already have more than one "%" link.', new.reverse_name_en using errcode = '23514';
  end if;
  if new.cardinality = 'one_to_one' and exists (
    select 1 from public.object_relation r where r.relation_type_id = new.id
    group by r.from_id having count(*) > 1
  ) then
    raise exception 'Some items already have more than one "%" link.', new.name_en using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_relation_type_cardinality() from public, anon, authenticated;

create trigger relation_type_cardinality_guard
  before update of cardinality on public.relation_type
  for each row execute function app.guard_relation_type_cardinality();

-- ---------------------------------------------------------------------------
-- Two-way relation properties
-- ---------------------------------------------------------------------------

create or replace function app.create_two_way_relation(
  p_from_type uuid,
  p_to_type uuid,
  p_key text,
  p_name_en text,
  p_name_fr text,
  p_reverse_key text,
  p_reverse_name_en text,
  p_reverse_name_fr text,
  p_cardinality text default 'many_to_many'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.object_type;
  v_to public.object_type;
  v_relation uuid;
begin
  select * into v_from from public.object_type t where t.id = p_from_type;
  select * into v_to from public.object_type t where t.id = p_to_type;
  if v_from.id is null or v_to.id is null or v_from.organization_id <> v_to.organization_id then
    raise exception 'Both types must exist in one organization.' using errcode = '22023';
  end if;
  if not app.is_org_admin(v_from.organization_id) then
    raise exception 'Only owners and admins can add relations.' using errcode = '42501';
  end if;
  if p_from_type = p_to_type and p_key = p_reverse_key then
    raise exception 'The two sides of a relation need different keys.' using errcode = '22023';
  end if;

  insert into public.relation_type
    (organization_id, key, name_en, name_fr, reverse_name_en, reverse_name_fr, cardinality, from_type_id, to_type_id)
  values
    (v_from.organization_id, v_from.key || '_' || p_key, p_name_en, p_name_fr, p_reverse_name_en, p_reverse_name_fr,
     p_cardinality, p_from_type, p_to_type)
  returning id into v_relation;

  insert into public.property_definition
    (organization_id, type_id, key, name_en, name_fr, kind, options, position)
  values
    (v_from.organization_id, p_from_type, p_key, p_name_en, p_name_fr, 'relation',
     jsonb_build_object('relationTypeKey', v_from.key || '_' || p_key, 'direction', 'outgoing',
       'targetTypeKey', v_to.key, 'pairedKey', p_reverse_key),
     (select coalesce(max(p.position), 0) + 1 from public.property_definition p where p.type_id = p_from_type)),
    (v_from.organization_id, p_to_type, p_reverse_key, p_reverse_name_en, p_reverse_name_fr, 'relation',
     jsonb_build_object('relationTypeKey', v_from.key || '_' || p_key, 'direction', 'incoming',
       'targetTypeKey', v_from.key, 'pairedKey', p_key),
     (select coalesce(max(p.position), 0) + 1 from public.property_definition p where p.type_id = p_to_type));

  return v_relation;
end;
$$;

create or replace function public.create_two_way_relation(
  p_from_type uuid, p_to_type uuid, p_key text, p_name_en text, p_name_fr text,
  p_reverse_key text, p_reverse_name_en text, p_reverse_name_fr text, p_cardinality text default 'many_to_many'
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select app.create_two_way_relation(p_from_type, p_to_type, p_key, p_name_en, p_name_fr,
    p_reverse_key, p_reverse_name_en, p_reverse_name_fr, p_cardinality);
$$;

revoke all on function app.create_two_way_relation(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_two_way_relation(uuid, uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_two_way_relation(uuid, uuid, text, text, text, text, text, text, text) to authenticated;

-- A relation property over a native link (e.g. a project's tasks).
create or replace function app.create_native_relation_property(
  p_type uuid, p_key text, p_name_en text, p_name_fr text, p_relation_type_key text, p_direction text,
  p_target_type_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.object_type;
  v_id uuid;
begin
  select * into v_type from public.object_type t where t.id = p_type;
  if v_type.id is null or not app.is_org_admin(v_type.organization_id) then
    raise exception 'Only owners and admins can add relations.' using errcode = '42501';
  end if;
  if p_direction not in ('outgoing', 'incoming') or not exists (
    select 1 from public.relation_type r
    where r.organization_id = v_type.organization_id and r.key = p_relation_type_key
  ) or not exists (
    select 1 from public.object_type t
    where t.organization_id = v_type.organization_id and t.key = p_target_type_key
  ) then
    raise exception 'Unknown relation, direction or type.' using errcode = '22023';
  end if;
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, options, position)
  values (v_type.organization_id, p_type, p_key, p_name_en, p_name_fr, 'relation',
    jsonb_build_object('relationTypeKey', p_relation_type_key, 'direction', p_direction, 'targetTypeKey', p_target_type_key),
    (select coalesce(max(p.position), 0) + 1 from public.property_definition p where p.type_id = p_type))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_native_relation_property(
  p_type uuid, p_key text, p_name_en text, p_name_fr text, p_relation_type_key text, p_direction text,
  p_target_type_key text
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select app.create_native_relation_property(p_type, p_key, p_name_en, p_name_fr, p_relation_type_key, p_direction, p_target_type_key);
$$;

revoke all on function app.create_native_relation_property(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_native_relation_property(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_native_relation_property(uuid, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rollups
-- ---------------------------------------------------------------------------

create or replace function app.create_rollup_property(
  p_type uuid,
  p_key text,
  p_name_en text,
  p_name_fr text,
  p_relation_property text,
  p_target_property text,
  p_function text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.object_type;
  v_relation public.property_definition;
  v_target_type uuid;
  v_target public.property_definition;
  v_id uuid;
begin
  select * into v_type from public.object_type t where t.id = p_type;
  if v_type.id is null or not app.is_org_admin(v_type.organization_id) then
    raise exception 'Only owners and admins can add rollups.' using errcode = '42501';
  end if;
  if p_function not in ('count', 'sum', 'average', 'min', 'max') then
    raise exception 'A rollup counts, sums, averages or takes the minimum or maximum.' using errcode = '22023';
  end if;
  select * into v_relation from public.property_definition p
  where p.type_id = p_type and p.key = p_relation_property and p.kind = 'relation' and p.archived_at is null;
  if v_relation.id is null then
    raise exception 'A rollup needs a relation property on the same type.' using errcode = '22023';
  end if;

  if p_function <> 'count' then
    select t.id into v_target_type from public.object_type t
    where t.organization_id = v_type.organization_id and t.key = v_relation.options ->> 'targetTypeKey';
    select * into v_target from public.property_definition p
    where p.type_id = v_target_type and p.key = p_target_property and p.archived_at is null;
    if v_target.id is null
      or v_target.kind not in ('number', 'currency', 'duration', 'progress', 'rating', 'rollup') then
      raise exception 'A % needs a number property on the related items.', p_function using errcode = '22023';
    end if;
    if v_target.visible_to_roles is not null then
      raise exception 'A rollup cannot summarise a private property.' using errcode = '22023';
    end if;
  end if;

  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, options, position)
  values (v_type.organization_id, p_type, p_key, p_name_en, p_name_fr, 'rollup',
    jsonb_build_object('relationProperty', p_relation_property, 'targetProperty', p_target_property, 'function', p_function),
    (select coalesce(max(p.position), 0) + 1 from public.property_definition p where p.type_id = p_type))
  returning id into v_id;

  perform app.refresh_rollups_for_type(p_type);
  return v_id;
end;
$$;

create or replace function public.create_rollup_property(
  p_type uuid, p_key text, p_name_en text, p_name_fr text,
  p_relation_property text, p_target_property text, p_function text
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select app.create_rollup_property(p_type, p_key, p_name_en, p_name_fr, p_relation_property, p_target_property, p_function);
$$;

-- The objects at the other end of a relation property, native links included.
create or replace function app.related_object_ids(p_object uuid, p_relation_type_key text, p_direction text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_direction = 'outgoing' then r.to_id else r.from_id end
  from public.object_relation_all r
  where r.relation_type_key = p_relation_type_key
    and ((p_direction = 'outgoing' and r.from_id = p_object) or (p_direction = 'incoming' and r.to_id = p_object));
$$;

-- One number property's value for one object: native column or custom value.
create or replace function app.number_property_value(p_object uuid, p_property public.property_definition)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_value numeric;
begin
  if p_property.system_column is null then
    select v.value_number into v_value from public.property_value v
    where v.object_id = p_object and v.property_id = p_property.id;
    return v_value;
  end if;
  select t.native_table into v_table from public.object_type t where t.id = p_property.type_id;
  if v_table is null or p_property.system_column !~ '^[a-z][a-z0-9_]*$' then
    return null;
  end if;
  execute format('select (%I)::numeric from public.%I where id = $1', p_property.system_column, v_table)
    into v_value using p_object;
  return v_value;
exception when others then
  return null;
end;
$$;

-- Recalculates every rollup on one object.
create or replace function app.refresh_rollups_for(p_object uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object public.object;
  v_rollup public.property_definition;
  v_relation public.property_definition;
  v_target public.property_definition;
  v_function text;
  v_values numeric[];
  v_count bigint;
  v_result numeric;
begin
  select * into v_object from public.object o where o.id = p_object;
  if v_object.id is null then
    return;
  end if;

  for v_rollup in
    select * from public.property_definition p
    where p.type_id = v_object.type_id and p.kind = 'rollup' and p.archived_at is null
  loop
    select * into v_relation from public.property_definition p
    where p.type_id = v_object.type_id and p.key = v_rollup.options ->> 'relationProperty' and p.kind = 'relation';
    if v_relation.id is null then
      continue;
    end if;
    v_function := v_rollup.options ->> 'function';

    if v_function = 'count' then
      select count(*) into v_count
      from app.related_object_ids(p_object, v_relation.options ->> 'relationTypeKey', v_relation.options ->> 'direction');
      v_result := v_count;
    else
      select p.* into v_target from public.property_definition p
      join public.object_type t on t.id = p.type_id
      where t.organization_id = v_object.organization_id
        and t.key = v_relation.options ->> 'targetTypeKey'
        and p.key = v_rollup.options ->> 'targetProperty';
      if v_target.id is null then
        continue;
      end if;
      select array_agg(app.number_property_value(r.id, v_target)) filter (where app.number_property_value(r.id, v_target) is not null)
      into v_values
      from app.related_object_ids(p_object, v_relation.options ->> 'relationTypeKey', v_relation.options ->> 'direction') r(id);
      v_result := case v_function
        when 'sum' then coalesce((select sum(x) from unnest(v_values) x), 0)
        when 'average' then (select avg(x) from unnest(v_values) x)
        when 'min' then (select min(x) from unnest(v_values) x)
        when 'max' then (select max(x) from unnest(v_values) x)
      end;
    end if;

    if v_result is null then
      delete from public.property_value v where v.object_id = p_object and v.property_id = v_rollup.id;
    else
      insert into public.property_value (object_id, property_id, organization_id, value_number)
      values (p_object, v_rollup.id, v_object.organization_id, v_result)
      on conflict (object_id, property_id) do update set value_number = excluded.value_number
      where public.property_value.value_number is distinct from excluded.value_number;
    end if;
  end loop;
end;
$$;

create or replace function app.refresh_rollups_for_type(p_type uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.refresh_rollups_for(o.id) from public.object o where o.type_id = p_type;
$$;

-- Refreshes the rollups of everything linked to an object (both directions),
-- plus any extra objects named (a native link's old parent). Nothing happens
-- in an organization with no rollups.
create or replace function app.refresh_neighbour_rollups(p_object uuid, p_extra uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_neighbour uuid;
begin
  if pg_trigger_depth() > 6 then
    return;
  end if;
  select o.organization_id into v_org from public.object o where o.id = p_object;
  if v_org is null and cardinality(p_extra) > 0 then
    select o.organization_id into v_org from public.object o where o.id = any (p_extra) limit 1;
  end if;
  if v_org is null or not exists (
    select 1 from public.property_definition p
    where p.organization_id = v_org and p.kind = 'rollup' and p.archived_at is null
  ) then
    return;
  end if;
  for v_neighbour in
    select r.to_id from public.object_relation_all r where r.from_id = p_object
    union
    select r.from_id from public.object_relation_all r where r.to_id = p_object
    union
    select unnest(p_extra)
  loop
    if v_neighbour is not null and v_neighbour <> p_object then
      perform app.refresh_rollups_for(v_neighbour);
    end if;
  end loop;
end;
$$;

revoke all on function app.create_rollup_property(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_rollup_property(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_rollup_property(uuid, text, text, text, text, text, text) to authenticated;
revoke all on function app.related_object_ids(uuid, text, text) from public, anon, authenticated;
revoke all on function app.number_property_value(uuid, public.property_definition) from public, anon, authenticated;
revoke all on function app.refresh_rollups_for(uuid) from public, anon, authenticated;
revoke all on function app.refresh_rollups_for_type(uuid) from public, anon, authenticated;
revoke all on function app.refresh_neighbour_rollups(uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Refresh triggers
-- ---------------------------------------------------------------------------

create or replace function app.rollups_after_relation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.object_relation := case when tg_op = 'DELETE' then old else new end;
begin
  perform app.refresh_rollups_for(v_row.from_id);
  perform app.refresh_rollups_for(v_row.to_id);
  return null;
end;
$$;

create or replace function app.rollups_after_value_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object uuid := case when tg_op = 'DELETE' then old.object_id else new.object_id end;
begin
  perform app.refresh_neighbour_rollups(v_object);
  return null;
end;
$$;

-- Native records: their own links and number columns feed rollups too.
create or replace function app.rollups_after_native_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map app.native_object_map;
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_extra uuid[] := '{}';
  v_column text;
begin
  select * into v_map from app.native_object_map m where m.native_table = tg_table_name;
  if not found then
    return null;
  end if;
  foreach v_column in array v_map.parent_columns || array['project_id', 'program_id'] loop
    v_extra := v_extra || app.jsonb_uuid(v_row, v_column);
    if v_old is not null then
      v_extra := v_extra || app.jsonb_uuid(v_old, v_column);
    end if;
  end loop;
  perform app.refresh_neighbour_rollups(app.jsonb_uuid(v_row, 'id'), array_remove(v_extra, null));
  return null;
end;
$$;

revoke all on function app.guard_relation_type_cardinality() from public, anon, authenticated;
revoke all on function app.rollups_after_relation_change() from public, anon, authenticated;
revoke all on function app.rollups_after_value_change() from public, anon, authenticated;
revoke all on function app.rollups_after_native_change() from public, anon, authenticated;

create trigger object_relation_rollups
  after insert or delete on public.object_relation
  for each row execute function app.rollups_after_relation_change();

create trigger property_value_rollups
  after insert or update or delete on public.property_value
  for each row execute function app.rollups_after_value_change();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'task', 'project', 'meeting', 'decision', 'risk', 'outcome_metric', 'team', 'event', 'crm_contact', 'document'
  ] loop
    execute format(
      'create trigger %1$s_rollups after insert or update or delete on public.%1$I
         for each row execute function app.rollups_after_native_change()',
      v_table
    );
  end loop;
end;
$$;
