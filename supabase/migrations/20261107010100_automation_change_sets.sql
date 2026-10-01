-- Workspace OS integration I1: change sets and labelled events for automations
-- and integrations (epic #199, design note section 8).
--
-- M13 (20261101010800) records change sets for the signed-in person only, and
-- M9a (20261101010600) labels an object_event with the session's app.actor.
-- The workflow runner and the API act through the service role, so neither
-- path was open to them: their change sets could not be recorded and their
-- events were labelled 'system'. This migration adds:
--
--   app.is_service_role()               whether the request runs as the
--                                       service role
--   public.object_event_high_water()    now answers the service role too
--   public.record_change_set(...)       as before, plus p_organization for a
--                                       change set that names only records
--                                       outside the object registry
--   public.record_change_set_as(...)    the same, for the service role acting
--                                       as an automation or integration on a
--                                       named person's behalf
--   public.apply_task_update_as(...)    a task update whose object_event
--                                       carries the automation's identity
--
-- Records outside the registry. A change set may name a record whose type is
-- not an object type of the organization (a milestone, an approval item): the
-- registry cannot check it, so it is accepted as named, and the change set
-- must still be anchored to one organization, by a registered object it also
-- names or by p_organization. A record of a *registered* type must exist, as
-- before. app.can answers false for an unregistered record, so such a change
-- set is readable by its actor only (app.can_read_change_set).

-- ---------------------------------------------------------------------------
-- Who is asking
-- ---------------------------------------------------------------------------

create or replace function app.is_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('role', true), '') = 'service_role';
$$;

revoke all on function app.is_service_role() from public, anon, authenticated;
grant execute on function app.is_service_role() to service_role;

comment on function app.is_service_role() is
  'True when the request runs as the service role (the job runner, the API). Reads the role PostgREST set.';

create or replace function public.object_event_high_water()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null and not app.is_service_role() then null
    else app.object_event_high_water()
  end;
$$;

revoke all on function public.object_event_high_water() from public, anon;
grant execute on function public.object_event_high_water() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Recording, shared by the person path and the automation path
-- ---------------------------------------------------------------------------

-- p_actor_kind / p_actor_id label the change set and pick which events since
-- p_since_seq belong to it. p_user is whose capabilities decide; with
-- p_assurance null the check is the live session's (app.can), otherwise it is
-- asked for p_user at that level (app.can_as, the workflow runner's rule).
create or replace function app.record_change_set_for(
  p_actor_kind text,
  p_actor_id text,
  p_user uuid,
  p_assurance text,
  p_action_key text,
  p_changes jsonb,
  p_since_seq bigint,
  p_undo_of uuid,
  p_organization uuid
)
returns public.change_set
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_orgs integer;
  v_set public.change_set;
  v_original public.change_set;
  v_change jsonb;
  v_position integer := 0;
  v_object uuid;
  v_to uuid;
  v_touched uuid[] := array[]::uuid[];
begin
  if p_user is null then
    raise exception 'Sign in to record a change set.' using errcode = '42501';
  end if;
  if p_actor_kind not in ('person', 'team', 'automation', 'integration', 'system') then
    raise exception 'Unknown actor kind %.', p_actor_kind using errcode = '22023';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'A change set needs at least one change.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 5000 then
    raise exception 'A change set holds at most 5000 changes.' using errcode = '22023';
  end if;

  -- Every change names its record(s).
  for v_change in select value from jsonb_array_elements(p_changes) loop
    if v_change ->> 'kind' in ('link', 'unlink') then
      v_object := app.jsonb_uuid(v_change -> 'relation' -> 'from', 'id');
      v_to := app.jsonb_uuid(v_change -> 'relation' -> 'to', 'id');
    else
      v_object := app.jsonb_uuid(v_change -> 'object', 'id');
      v_to := null;
    end if;
    if v_object is null or (v_change ->> 'kind' in ('link', 'unlink') and v_to is null) then
      raise exception 'Each change must name its object.' using errcode = '22023';
    end if;
    v_touched := v_touched || v_object || coalesce(array[v_to], array[]::uuid[]);
  end loop;

  -- One organization: the registered objects' (they must agree), or the one
  -- the caller names when the change set holds only unregistered records.
  select min(o.organization_id::text)::uuid, count(distinct o.organization_id)
  into v_org, v_orgs
  from public.object o where o.id = any (v_touched);
  if v_orgs > 1 or (v_org is not null and p_organization is not null and p_organization <> v_org) then
    raise exception 'Every object in a change set must exist in one organization.' using errcode = '22023';
  end if;
  v_org := coalesce(v_org, p_organization);
  if v_org is null then
    raise exception 'Every object in a change set must exist in one organization.' using errcode = '22023';
  end if;

  -- A record of a registered type must exist (unless a change deleted it); a
  -- record of a type the registry does not know is accepted as named.
  if exists (
    select 1
    from jsonb_array_elements(p_changes) c
    cross join lateral (values
      (app.jsonb_uuid(c -> 'object', 'id'), c -> 'object' ->> 'type'),
      (app.jsonb_uuid(c -> 'relation' -> 'from', 'id'), c -> 'relation' -> 'from' ->> 'type'),
      (app.jsonb_uuid(c -> 'relation' -> 'to', 'id'), c -> 'relation' -> 'to' ->> 'type')
    ) as r(id, type_key)
    where r.id is not null
      and c ->> 'kind' <> 'delete'
      and not exists (select 1 from public.object o where o.id = r.id)
      and (
        r.type_key is null
        or exists (select 1 from public.object_type t where t.organization_id = v_org and t.key = r.type_key)
      )
  ) then
    raise exception 'Every object in a change set must exist in one organization.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_org and m.user_id = p_user and m.status = 'active'
  ) then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(v_touched) t(id)
    where exists (select 1 from public.object o where o.id = t.id)
      and not case
        when p_assurance is null then app.can(t.id, 'edit_content')
        else app.can_as(p_user, t.id, 'edit_content', p_assurance)
      end
  ) then
    raise exception 'You cannot change every object in this change set.' using errcode = '42501';
  end if;

  if p_undo_of is not null then
    select * into v_original from public.change_set c where c.id = p_undo_of for update;
    if v_original.id is null or v_original.organization_id <> v_org then
      raise exception 'That change set does not exist.' using errcode = '22023';
    end if;
    if v_original.undone_at is not null then
      raise exception 'That change set was already undone.' using errcode = '23505';
    end if;
    if v_original.created_at < now() - interval '30 days' then
      raise exception 'Changes older than 30 days cannot be undone.' using errcode = '22023';
    end if;
    update public.change_set set undone_at = now() where id = p_undo_of;
  end if;

  insert into public.change_set (organization_id, action_key, actor_kind, actor_id, undo_of)
  values (v_org, p_action_key, p_actor_kind, p_actor_id, p_undo_of)
  returning * into v_set;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    if v_change ->> 'kind' in ('link', 'unlink') then
      insert into public.change_set_item
        (change_set_id, position, kind, object_id, object_type, relation_type_key, to_id, to_type)
      values (
        v_set.id, v_position, v_change ->> 'kind',
        app.jsonb_uuid(v_change -> 'relation' -> 'from', 'id'),
        coalesce(v_change -> 'relation' -> 'from' ->> 'type', ''),
        v_change -> 'relation' ->> 'relationTypeKey',
        app.jsonb_uuid(v_change -> 'relation' -> 'to', 'id'),
        v_change -> 'relation' -> 'to' ->> 'type'
      );
    elsif v_change ->> 'kind' = 'update' then
      insert into public.change_set_item
        (change_set_id, position, kind, object_id, object_type, property, before, after)
      values (
        v_set.id, v_position, 'update',
        app.jsonb_uuid(v_change -> 'object', 'id'),
        coalesce(v_change -> 'object' ->> 'type', ''),
        v_change ->> 'property',
        coalesce(v_change -> 'before', 'null'::jsonb),
        coalesce(v_change -> 'after', 'null'::jsonb)
      );
    elsif v_change ->> 'kind' in ('create', 'delete') then
      insert into public.change_set_item
        (change_set_id, position, kind, object_id, object_type, before, after)
      values (
        v_set.id, v_position, v_change ->> 'kind',
        app.jsonb_uuid(v_change -> 'object', 'id'),
        coalesce(v_change -> 'object' ->> 'type', ''),
        case when v_change ->> 'kind' = 'delete' then v_change -> 'values' end,
        case when v_change ->> 'kind' = 'create' then v_change -> 'values' end
      );
    else
      raise exception 'Unknown change kind %.', v_change ->> 'kind' using errcode = '22023';
    end if;
    v_position := v_position + 1;
  end loop;

  -- The actor's events on these objects since the action started belong to it.
  if p_since_seq is not null then
    update public.object_event e
    set change_set_id = v_set.id
    where e.seq > p_since_seq
      and e.change_set_id is null
      and e.actor_kind = p_actor_kind
      and e.actor_id = p_actor_id
      and e.object_id = any (v_touched);
  end if;

  return v_set;
end;
$$;

revoke all on function app.record_change_set_for(text, text, uuid, text, text, jsonb, bigint, uuid, uuid)
  from public, anon, authenticated, service_role;

-- The person path keeps its signature; M13's tests and callers see no change.
create or replace function app.record_change_set(
  p_action_key text,
  p_changes jsonb,
  p_since_seq bigint default null,
  p_undo_of uuid default null
)
returns public.change_set
language sql
volatile
security definer
set search_path = ''
as $$
  select app.record_change_set_for(
    'person', (select auth.uid())::text, (select auth.uid()), null,
    p_action_key, p_changes, p_since_seq, p_undo_of, null
  );
$$;

revoke all on function app.record_change_set(text, jsonb, bigint, uuid) from public, anon, authenticated;

-- The public wrapper gains p_organization. One function only, so a call that
-- leaves it out is never ambiguous for PostgREST.
drop function if exists public.record_change_set(text, jsonb, bigint, uuid);

create or replace function public.record_change_set(
  p_action_key text,
  p_changes jsonb,
  p_since_seq bigint default null,
  p_undo_of uuid default null,
  p_organization uuid default null
)
returns public.change_set
language sql
volatile
security definer
set search_path = ''
as $$
  select app.record_change_set_for(
    'person', (select auth.uid())::text, (select auth.uid()), null,
    p_action_key, p_changes, p_since_seq, p_undo_of, p_organization
  );
$$;

revoke all on function public.record_change_set(text, jsonb, bigint, uuid, uuid) from public, anon;
grant execute on function public.record_change_set(text, jsonb, bigint, uuid, uuid) to authenticated;

comment on function public.record_change_set(text, jsonb, bigint, uuid, uuid) is
  'Records what one action did as a change set for the signed-in person (M13). p_organization anchors a change set that names only records outside the object registry.';

-- ---------------------------------------------------------------------------
-- The automation path: service role only
-- ---------------------------------------------------------------------------

-- p_actor is 'automation:<workflow id>' or 'integration:<name>', the same
-- form app.record_object_event reads from app.actor. p_user is the person
-- whose permissions the automation acts with (the workflow's owner, the
-- token's person), checked at p_assurance as app.can_as does.
create or replace function public.record_change_set_as(
  p_actor text,
  p_user uuid,
  p_action_key text,
  p_changes jsonb,
  p_since_seq bigint default null,
  p_undo_of uuid default null,
  p_assurance text default 'aal1',
  p_organization uuid default null
)
returns public.change_set
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text := split_part(coalesce(p_actor, ''), ':', 1);
  v_id text := nullif(substr(coalesce(p_actor, ''), length(split_part(coalesce(p_actor, ''), ':', 1)) + 2), '');
begin
  if not app.is_service_role() then
    raise exception 'Only the service role records a change set for an automation.' using errcode = '42501';
  end if;
  if v_kind not in ('automation', 'integration') or v_id is null then
    raise exception 'The actor must be automation:<id> or integration:<name>.' using errcode = '22023';
  end if;
  if p_assurance is null or p_assurance not in ('aal1', 'aal2') then
    raise exception 'Unknown assurance level %.', p_assurance using errcode = '22023';
  end if;
  return app.record_change_set_for(
    v_kind, v_id, p_user, p_assurance,
    p_action_key, p_changes, p_since_seq, p_undo_of, p_organization
  );
end;
$$;

revoke all on function public.record_change_set_as(text, uuid, text, jsonb, bigint, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_change_set_as(text, uuid, text, jsonb, bigint, uuid, text, uuid) to service_role;

comment on function public.record_change_set_as(text, uuid, text, jsonb, bigint, uuid, text, uuid) is
  'record_change_set for the workflow runner and the API: the change set and its events are labelled with the automation or integration, and the capability is checked for the named person. Service role only.';

-- A task update made as an automation or integration: the row changes inside
-- this call with app.actor set, so the object_event the task trigger writes
-- carries that identity rather than 'system'. Only the columns the workflow
-- actions write. Returns the task id, or null when the task does not exist in
-- the organization.
create or replace function public.apply_task_update_as(
  p_actor text,
  p_organization uuid,
  p_task uuid,
  p_patch jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text := split_part(coalesce(p_actor, ''), ':', 1);
  v_previous text := current_setting('app.actor', true);
  v_id uuid;
  v_key text;
begin
  if not app.is_service_role() then
    raise exception 'Only the service role changes a task for an automation.' using errcode = '42501';
  end if;
  if v_kind not in ('automation', 'integration')
     or nullif(substr(coalesce(p_actor, ''), length(v_kind) + 2), '') is null then
    raise exception 'The actor must be automation:<id> or integration:<name>.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb then
    raise exception 'The patch must name at least one column.' using errcode = '22023';
  end if;
  for v_key in select key from jsonb_object_keys(p_patch) as k(key) loop
    if v_key not in ('status', 'priority', 'assignee_id', 'completed_at') then
      raise exception 'Column % cannot be changed this way.', v_key using errcode = '22023';
    end if;
  end loop;

  perform set_config('app.actor', p_actor, true);
  update public.task t
     set status = case when p_patch ? 'status' then (p_patch ->> 'status')::public.task_status else t.status end,
         priority = case when p_patch ? 'priority' then (p_patch ->> 'priority')::public.task_priority else t.priority end,
         assignee_id = case when p_patch ? 'assignee_id' then (p_patch ->> 'assignee_id')::uuid else t.assignee_id end,
         completed_at = case when p_patch ? 'completed_at' then (p_patch ->> 'completed_at')::timestamptz else t.completed_at end
   where t.id = p_task and t.organization_id = p_organization
  returning t.id into v_id;
  perform set_config('app.actor', coalesce(v_previous, ''), true);
  return v_id;
end;
$$;

revoke all on function public.apply_task_update_as(text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_task_update_as(text, uuid, uuid, jsonb) to service_role;

comment on function public.apply_task_update_as(text, uuid, uuid, jsonb) is
  'Changes a task''s status, priority, assignee or completed_at as an automation or integration, so its object_event names that actor. Service role only; the capability was checked with app.can_as first.';
