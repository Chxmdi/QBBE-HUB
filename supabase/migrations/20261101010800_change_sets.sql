-- Workspace OS M13: change sets for actions and undo (epic #199, design note section 8).
--
-- Every action (a bulk edit, a command, a workflow step) records what it did
-- as one change set: an ordered list of items (create, delete, update, link,
-- unlink) with before and after values. Undo reads a change set, applies the
-- inverse through the same checked paths, and records a new change set that
-- points back with undo_of.
--
-- The action registry lives in code (src/features/objects/actions). The
-- database's part:
--   public.object_event_high_water()  the latest event number, taken before
--                                     an action runs
--   public.record_change_set(...)     stores the change set, and labels the
--                                     caller's events since that number on
--                                     the touched objects with its id
-- Only record_change_set writes these tables; it requires edit_content on
-- every object the change set names, so a change set cannot be forged for
-- objects the caller could not have changed.
--
-- Reading: the person who ran it, and anyone who can view every object it
-- touched. Undo is offered for 30 days, matching the trash.

create table public.change_set (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  action_key text not null check (action_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  actor_kind text not null check (actor_kind in ('person', 'team', 'automation', 'integration', 'system')),
  actor_id text,
  created_at timestamptz not null default now(),
  undo_of uuid references public.change_set (id) on delete set null,
  undone_at timestamptz
);

comment on table public.change_set is
  'Workspace OS change sets (M13): what one action did, for history and undo. Written only by public.record_change_set.';

create index idx_change_set_org_created on public.change_set (organization_id, created_at desc);
create index idx_change_set_actor on public.change_set (actor_id, created_at desc);
create unique index idx_change_set_one_undo on public.change_set (undo_of) where undo_of is not null;

create table public.change_set_item (
  change_set_id uuid not null references public.change_set (id) on delete cascade,
  position integer not null check (position >= 0),
  kind text not null check (kind in ('create', 'delete', 'update', 'link', 'unlink')),
  object_id uuid not null,
  object_type text not null,
  property text,
  before jsonb,
  after jsonb,
  relation_type_key text,
  to_id uuid,
  to_type text,
  primary key (change_set_id, position),
  check ((kind = 'update') = (property is not null)),
  check ((kind in ('link', 'unlink')) = (relation_type_key is not null and to_id is not null))
);

comment on table public.change_set_item is
  'One change in a change set (M13), in the order it was made.';

create index idx_change_set_item_object on public.change_set_item (object_id);
create index idx_change_set_item_to on public.change_set_item (to_id) where to_id is not null;

-- ---------------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------------

create or replace function app.object_event_high_water()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(e.seq), 0) from public.object_event e;
$$;

create or replace function public.object_event_high_water()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then null else app.object_event_high_water() end;
$$;

revoke all on function app.object_event_high_water() from public, anon, authenticated;
revoke all on function public.object_event_high_water() from public, anon;
grant execute on function public.object_event_high_water() to authenticated;

-- p_changes is the contract's Change[] as JSON:
--   {kind: update, object: {id, type}, property, before, after}
--   {kind: create|delete, object: {id, type}, values}
--   {kind: link|unlink, relation: {relationTypeKey, from: {id, type}, to: {id, type}}}
create or replace function app.record_change_set(
  p_action_key text,
  p_changes jsonb,
  p_since_seq bigint default null,
  p_undo_of uuid default null
)
returns public.change_set
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_set public.change_set;
  v_original public.change_set;
  v_change jsonb;
  v_position integer := 0;
  v_object uuid;
  v_to uuid;
  v_touched uuid[] := array[]::uuid[];
begin
  if v_actor is null then
    raise exception 'Sign in to record a change set.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'A change set needs at least one change.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 5000 then
    raise exception 'A change set holds at most 5000 changes.' using errcode = '22023';
  end if;

  -- Every object named must be in one organization and editable by the caller.
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

  -- One organization. Every object must still exist, except one a change
  -- deleted.
  select min(o.organization_id::text)::uuid, count(distinct o.organization_id)
  into v_org, v_position
  from public.object o where o.id = any (v_touched);
  if v_org is null or v_position <> 1 or exists (
    select 1 from jsonb_array_elements(p_changes) c
    where c ->> 'kind' <> 'delete'
      and exists (
        select 1 from unnest(array[
          app.jsonb_uuid(c -> 'object', 'id'),
          app.jsonb_uuid(c -> 'relation' -> 'from', 'id'),
          app.jsonb_uuid(c -> 'relation' -> 'to', 'id')
        ]) t(id)
        where t.id is not null and not exists (select 1 from public.object o where o.id = t.id)
      )
  ) then
    raise exception 'Every object in a change set must exist in one organization.' using errcode = '22023';
  end if;
  v_position := 0;
  if not app.is_org_member(v_org) then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(v_touched) t(id)
    where exists (select 1 from public.object o where o.id = t.id)
      and not app.can(t.id, 'edit_content')
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
  values (v_org, p_action_key, 'person', v_actor::text, p_undo_of)
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

  -- The caller's events on these objects since the action started belong to it.
  if p_since_seq is not null then
    update public.object_event e
    set change_set_id = v_set.id
    where e.seq > p_since_seq
      and e.change_set_id is null
      and e.actor_kind = 'person'
      and e.actor_id = v_actor::text
      and e.object_id = any (v_touched);
  end if;

  return v_set;
end;
$$;

create or replace function public.record_change_set(
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
  select app.record_change_set(p_action_key, p_changes, p_since_seq, p_undo_of);
$$;

revoke all on function app.record_change_set(text, jsonb, bigint, uuid) from public, anon, authenticated;
revoke all on function public.record_change_set(text, jsonb, bigint, uuid) from public, anon;
grant execute on function public.record_change_set(text, jsonb, bigint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- The actor, or someone who can view every object the change set touched.
create or replace function app.can_read_change_set(p_change_set uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.change_set c
    where c.id = p_change_set
      and app.is_org_member(c.organization_id)
      and (
        (c.actor_kind = 'person' and c.actor_id = (select auth.uid())::text)
        or not exists (
          select 1 from public.change_set_item i
          where i.change_set_id = c.id
            and (not app.can(i.object_id, 'view') or (i.to_id is not null and not app.can(i.to_id, 'view')))
        )
      )
  );
$$;

revoke all on function app.can_read_change_set(uuid) from public, anon;
grant execute on function app.can_read_change_set(uuid) to authenticated;

alter table public.change_set enable row level security;
alter table public.change_set_item enable row level security;

create policy change_set_read on public.change_set for select to authenticated
  using (app.can_read_change_set(id));
create policy change_set_item_read on public.change_set_item for select to authenticated
  using (app.can_read_change_set(change_set_id));

revoke all on public.change_set, public.change_set_item from anon;
revoke insert, update, delete, truncate on public.change_set, public.change_set_item from authenticated;
