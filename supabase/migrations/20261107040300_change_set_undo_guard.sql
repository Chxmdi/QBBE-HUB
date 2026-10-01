-- Workspace OS integration I1 follow-up: an undo must reverse the change set
-- it names (epic #199).
--
-- 20261107010100 lets a change set be anchored to an organization when it
-- names only records outside the object registry (a milestone, an approval
-- item). That opened the undo marking to any active member: record_change_set
-- checked p_undo_of for existence, age and "not yet undone", but never related
-- the new change set to the one it claims to reverse, and the capability check
-- only covers registered objects. So a member could record a change set that
-- names one made-up record, point p_undo_of at any change set in the
-- organization (an admin's bulk edit, a workflow's change) and have it marked
-- undone_at while nothing was reverted. The genuine undo was then refused as
-- "already undone", for good: idx_change_set_one_undo keeps one undo per
-- change set. Under M13 the forged set had to name a registered object the
-- caller could edit, which was the same hole with a higher bar.
--
-- app.record_change_set_for now requires, when p_undo_of is given, that
--
--   1. the new change set names every record of the original (the registry's
--      undo reverses the original's own changes, so it always does), which
--      puts the original's registered objects under the capability check; and
--   2. when the original names a record the registry cannot check, the caller
--      is the original's actor, the same rule app.can_read_change_set applies
--      to reading such a change set.
--
-- Everything else in the function is as 20261107010100 defined it.

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
    -- The undo reverses the original's own changes: it names each of its
    -- records, so the capability check above covered the registered ones.
    -- (v_touched holds a null for every change without a link target, so
    -- "= any" would answer unknown; the records are matched one by one.)
    if exists (
      select 1 from public.change_set_item i
      where i.change_set_id = p_undo_of
        and (not exists (select 1 from unnest(v_touched) t(id) where t.id = i.object_id)
             or (i.to_id is not null and not exists (select 1 from unnest(v_touched) t(id) where t.id = i.to_id)))
    ) then
      raise exception 'An undo must name every record of the change set it reverses.' using errcode = '22023';
    end if;
    -- A record the registry cannot check is its actor's alone to undo.
    if (v_original.actor_kind, v_original.actor_id) is distinct from (p_actor_kind, p_actor_id)
       and exists (
         select 1 from public.change_set_item i
         where i.change_set_id = p_undo_of
           and (not exists (select 1 from public.object o where o.id = i.object_id)
                or (i.to_id is not null and not exists (select 1 from public.object o where o.id = i.to_id)))
       ) then
      raise exception 'Only its actor can undo a change set of records the registry cannot check.' using errcode = '42501';
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
