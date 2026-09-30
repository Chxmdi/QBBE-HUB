-- Workspace OS saved lenses (M8d, epic #199, stream S4).
--
-- A lens is a saved way of looking at records: a kind (table, board, list,
-- and later calendar, timeline, gallery, feed, dashboard), a query spec the
-- engine runs (20261104010100), and a layout (columns, widths, grouping).
-- It is personal, or shared with the organization. Sharing a lens shares
-- the question, never the rows: whoever opens it sees only what their own
-- policies allow, because the engine runs as the viewer.
--
-- Existing saved views (saved_view, 0008 and 20260926010000) become lenses:
--   * every row is copied now, with its source id kept;
--   * a trigger keeps the copy in step while the old screens still write
--     saved_view (insert, rename, share, delete);
--   * the original query is kept in legacy_query, so nothing is lost, and
--     filters the engine cannot express yet are listed in
--     unsupported_filters rather than silently dropped.
--
-- Reversible, and add-only: saved_view is not changed. To undo:
--   select app.lens_unmigrate_saved_views();   -- removes the copies
--   drop trigger saved_view_to_lens on public.saved_view;
-- and app.lens_migrate_saved_views() copies them again (idempotent).

create table public.lens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  owner_id uuid not null references public.user_profile (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('table', 'board', 'list', 'calendar', 'timeline', 'gallery', 'feed', 'dashboard')),
  type_key text check (type_key is null or type_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  spec jsonb not null default '{}'::jsonb check (jsonb_typeof(spec) = 'object'),
  layout jsonb not null default '{}'::jsonb check (jsonb_typeof(layout) = 'object'),
  visibility text not null default 'personal' check (visibility in ('personal', 'shared')),
  -- The screen a lens belongs to (/board, /my-work, /projects), for lenses
  -- that came from a saved view or that a screen offers as a shortcut.
  path text check (path is null or path ~ '^/[a-z0-9/_-]{0,120}$'),
  legacy_query jsonb,
  unsupported_filters text[] not null default '{}'::text[],
  source_saved_view_id uuid unique references public.saved_view (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lens_owner_idx on public.lens (owner_id, kind);
create index lens_shared_idx on public.lens (organization_id, kind) where visibility = 'shared';
create index lens_path_idx on public.lens (organization_id, path) where path is not null;

alter table public.lens enable row level security;

-- Read: your own lenses, and the lenses shared in your organization, while
-- you are an active member of it.
create policy lens_read on public.lens
  for select to authenticated
  using (
    app.is_org_member(organization_id)
    and (owner_id = (select auth.uid()) or visibility = 'shared')
  );

-- Write: only your own, in your organization. Copies of saved views are
-- written by the sync trigger only (source_saved_view_id stays null here).
create policy lens_insert on public.lens
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and app.is_org_member(organization_id)
    and source_saved_view_id is null
  );

create policy lens_update on public.lens
  for update to authenticated
  using (owner_id = (select auth.uid()) and app.is_org_member(organization_id))
  with check (owner_id = (select auth.uid()) and app.is_org_member(organization_id));

create policy lens_delete on public.lens
  for delete to authenticated
  using (owner_id = (select auth.uid()) and app.is_org_member(organization_id));

revoke all on public.lens from anon;
grant select, insert, update, delete on public.lens to authenticated;
grant all on public.lens to service_role;

-- Ownership, organization and provenance never change after insert, and
-- updated_at follows every change.
create or replace function app.lens_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
     or new.organization_id is distinct from old.organization_id
     or new.source_saved_view_id is distinct from old.source_saved_view_id then
    raise exception 'A lens keeps its owner, organization and source.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger lens_guard
  before update on public.lens
  for each row execute function app.lens_guard();

-- ---------------------------------------------------------------------------
-- Saved view to lens conversion
-- ---------------------------------------------------------------------------

-- The engine spec for a saved view's URL filters. Only values that pass the
-- same checks as the screens' parsers are used (ids, enum members, short
-- text); anything else is reported as unsupported, never guessed.
create or replace function app.lens_spec_from_saved_view(
  p_path text,
  p_query jsonb,
  out kind text,
  out type_key text,
  out spec jsonb,
  out unsupported text[]
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_key text;
  v_value text;
  v_where jsonb := '[]'::jsonb;
  v_status text;
  v_blocked text;
  v_q jsonb := coalesce(p_query, '{}'::jsonb);
begin
  unsupported := array[]::text[];
  if jsonb_typeof(v_q) is distinct from 'object' then
    v_q := '{}'::jsonb;
  end if;

  if p_path = '/projects' then
    kind := 'table';
    type_key := 'project';
    for v_key, v_value in select k, v #>> '{}' from jsonb_each(v_q) as e(k, v) loop
      if v_key = 'program' and v_value ~ v_uuid then
        v_where := v_where || jsonb_build_object('property', 'program', 'operator', 'is', 'value', lower(v_value));
      elsif v_key = 'owner' and v_value ~ v_uuid then
        v_where := v_where || jsonb_build_object('property', 'owner', 'operator', 'contains', 'value', lower(v_value));
      elsif v_key = 'health' and v_value = any (enum_range(null::public.project_health)::text[]) then
        v_where := v_where || jsonb_build_object('property', 'health', 'operator', 'is', 'value', v_value);
      elsif v_key = 'stage' and v_value = any (enum_range(null::public.project_stage)::text[]) then
        v_where := v_where || jsonb_build_object('property', 'stage', 'operator', 'is', 'value', v_value);
      elsif v_key = 'priority' and v_value = any (enum_range(null::public.task_priority)::text[]) then
        v_where := v_where || jsonb_build_object('property', 'priority', 'operator', 'is', 'value', v_value);
      elsif v_key = 'view' then
        continue;
      else
        unsupported := unsupported || v_key;
      end if;
    end loop;
    spec := jsonb_build_object('version', 1, 'type', 'project',
      'sort', '[{"property":"title","direction":"asc"}]'::jsonb, 'limit', 1000)
      || case when jsonb_array_length(v_where) > 0 then jsonb_build_object('where', jsonb_build_object('and', v_where)) else '{}'::jsonb end;
    return;
  end if;

  kind := case p_path when '/board' then 'board' when '/my-work' then 'list' else 'table' end;
  type_key := 'task';
  v_status := v_q ->> 'status';
  if v_status is not null and not (v_status = any (enum_range(null::public.task_status)::text[])) then
    unsupported := unsupported || 'status'::text;
    v_status := null;
  end if;
  v_blocked := v_q ->> 'blocked';

  for v_key, v_value in select k, v #>> '{}' from jsonb_each(v_q) as e(k, v) loop
    if v_key in ('status', 'blocked') then
      continue;
    elsif v_key = 'program' and v_value ~ v_uuid then
      v_where := v_where || jsonb_build_object('property', 'program', 'operator', 'is', 'value', lower(v_value));
    elsif v_key = 'project' and v_value ~ v_uuid then
      v_where := v_where || jsonb_build_object('property', 'project', 'operator', 'contains', 'value', lower(v_value));
    elsif v_key = 'owner' and v_value ~ v_uuid then
      v_where := v_where || jsonb_build_object('property', 'assignee', 'operator', 'contains', 'value', lower(v_value));
    elsif v_key = 'milestone' and v_value ~ v_uuid then
      v_where := v_where || jsonb_build_object('property', 'milestone', 'operator', 'is', 'value', lower(v_value));
    elsif v_key = 'priority' and v_value = any (enum_range(null::public.task_priority)::text[]) then
      v_where := v_where || jsonb_build_object('property', 'priority', 'operator', 'is', 'value', v_value);
    elsif v_key = 'q' and v_value is not null and length(v_value) between 1 and 200 then
      v_where := v_where || jsonb_build_object('property', 'title', 'operator', 'contains', 'value', v_value);
    elsif v_key = 'due' and v_value in ('none', 'overdue', 'today', 'week', 'month') then
      v_where := v_where || case v_value
        when 'none' then '[{"property":"due","operator":"is_empty"}]'::jsonb
        when 'overdue' then '[{"property":"due","operator":"is_not_empty"},{"property":"due","operator":"before","value":{"relative":"today"}}]'::jsonb
        when 'today' then '[{"property":"due","operator":"is","value":{"relative":"today"}}]'::jsonb
        when 'week' then '[{"property":"due","operator":"is","value":{"relative":"next_7_days"}}]'::jsonb
        else '[{"property":"due","operator":"is","value":{"relative":"next_30_days"}}]'::jsonb
      end;
    elsif v_key = 'view' then
      continue;
    else
      unsupported := unsupported || v_key;
    end if;
  end loop;

  -- Status and blocked follow applyTaskFilters (src/features/tasks/filters.ts).
  if v_status is not null then
    v_where := jsonb_build_array(jsonb_build_object('property', 'status', 'operator', 'is', 'value', v_status)) || v_where;
  else
    v_where := '[{"property":"status","operator":"is_any_of","value":["not_started","ready","in_progress","waiting","blocked","in_review"]}]'::jsonb || v_where;
  end if;
  if v_blocked = 'yes' and v_status is distinct from 'blocked' then
    v_where := v_where || '[{"property":"status","operator":"is","value":"blocked"}]'::jsonb;
  elsif v_blocked = 'no' and (v_status is null or v_status = 'blocked') then
    v_where := v_where || '[{"property":"status","operator":"is_not","value":"blocked"}]'::jsonb;
  elsif v_blocked is not null and v_blocked not in ('yes', 'no') then
    unsupported := unsupported || 'blocked'::text;
  end if;
  if kind = 'list' then
    v_where := '[{"property":"assignee","operator":"contains","value":{"relative":"me"}}]'::jsonb || v_where;
  end if;

  spec := jsonb_build_object(
    'version', 1,
    'type', 'task',
    'where', jsonb_build_object('and', v_where),
    'sort', '[{"property":"due","direction":"asc"},{"property":"title","direction":"asc"}]'::jsonb,
    'select', '["status","priority","due","assignee","project","blocked_reason"]'::jsonb,
    'limit', 1000
  ) || case when kind = 'board' then '{"groupBy":{"property":"status"}}'::jsonb else '{}'::jsonb end;
end;
$$;

-- Copy one saved view into its lens (insert or refresh).
create or replace function app.lens_sync_saved_view(p_view public.saved_view)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from app.lens_spec_from_saved_view(p_view.path, p_view.query);
  insert into public.lens (organization_id, owner_id, name, kind, type_key, spec, visibility, path,
    legacy_query, unsupported_filters, source_saved_view_id, created_at)
  values (p_view.organization_id, p_view.user_id, left(coalesce(nullif(btrim(p_view.name), ''), 'Saved view'), 120),
    v.kind, v.type_key, v.spec, case when p_view.shared then 'shared' else 'personal' end, p_view.path,
    p_view.query, v.unsupported, p_view.id, p_view.created_at)
  on conflict (source_saved_view_id) do update set
    name = excluded.name,
    kind = excluded.kind,
    type_key = excluded.type_key,
    spec = excluded.spec,
    visibility = excluded.visibility,
    path = excluded.path,
    legacy_query = excluded.legacy_query,
    unsupported_filters = excluded.unsupported_filters;
end;
$$;

create or replace function app.saved_view_to_lens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.lens_sync_saved_view(new);
  return new;
end;
$$;

-- Deletes follow through the foreign key (on delete cascade).
create trigger saved_view_to_lens
  after insert or update on public.saved_view
  for each row execute function app.saved_view_to_lens();

-- Copy every saved view (idempotent), and the undo.
create or replace function app.lens_migrate_saved_views()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_view public.saved_view;
  v_count integer := 0;
begin
  for v_view in select * from public.saved_view loop
    perform app.lens_sync_saved_view(v_view);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function app.lens_unmigrate_saved_views()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.lens where source_saved_view_id is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.lens_guard() from public, anon, authenticated;
revoke all on function app.lens_spec_from_saved_view(text, jsonb) from public, anon, authenticated;
revoke all on function app.lens_sync_saved_view(public.saved_view) from public, anon, authenticated;
revoke all on function app.saved_view_to_lens() from public, anon, authenticated;
revoke all on function app.lens_migrate_saved_views() from public, anon, authenticated;
revoke all on function app.lens_unmigrate_saved_views() from public, anon, authenticated;
grant execute on function app.lens_migrate_saved_views() to service_role;
grant execute on function app.lens_unmigrate_saved_views() to service_role;

select app.lens_migrate_saved_views();

comment on table public.lens is
  'Workspace OS saved lenses (M8d): a kind, a query spec and a layout; personal or shared. '
  'Rows with source_saved_view_id are kept in step with saved_view by trigger.';
