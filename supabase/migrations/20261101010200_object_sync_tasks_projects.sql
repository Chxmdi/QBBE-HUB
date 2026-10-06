-- Workspace OS M1b: every task and project has its object (epic #199).
--
-- Registers the two tables in app.native_object_map, attaches the sync
-- trigger from M1a, and backfills existing rows in the same migration so
-- there is no moment when a record is missing its object. Projects go first
-- because a task's object points at its project's object as its parent.
--
-- The sync trigger now skips updates that change nothing it copies (a task's
-- sort_key moving on a board, say), so busy tables do not pay for it.

-- Only the columns an object is built from, so an update to anything else is
-- recognised as a no-op.
create or replace function app.native_object_fields(p_map app.native_object_map, p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'organization_id', p_row -> 'organization_id',
    'title', p_row -> p_map.title_column,
    'owner', case when p_map.owner_column is null then null else p_row -> p_map.owner_column end,
    'archived', case when p_map.archived_column is null then null else p_row -> p_map.archived_column end,
    'parents', coalesce(
      (select jsonb_agg(p_row -> c order by ord)
       from unnest(p_map.parent_columns) with ordinality as u(c, ord)),
      '[]'::jsonb
    )
  );
$$;

revoke all on function app.native_object_fields(app.native_object_map, jsonb) from public, anon, authenticated;

create or replace function app.sync_object_from_native()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map app.native_object_map;
begin
  if tg_op = 'DELETE' then
    delete from public.object o where o.id = old.id;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    select * into v_map from app.native_object_map m where m.native_table = tg_table_name;
    if found
      and app.native_object_fields(v_map, to_jsonb(old)) = app.native_object_fields(v_map, to_jsonb(new))
      and exists (select 1 from public.object o where o.id = new.id)
    then
      return new;
    end if;
  end if;

  perform app.upsert_native_object(tg_table_name, to_jsonb(new));
  return new;
end;
$$;

revoke all on function app.sync_object_from_native() from public, anon, authenticated;

insert into app.native_object_map
  (native_table, type_key, title_column, owner_column, created_by_column, parent_columns, archived_column)
values
  ('project', 'project', 'name', 'owner_id', 'created_by', '{}', 'archived_at'),
  ('task', 'task', 'title', 'assignee_id', 'created_by', '{project_id}', 'archived_at')
on conflict (native_table) do update set
  type_key = excluded.type_key,
  title_column = excluded.title_column,
  owner_column = excluded.owner_column,
  created_by_column = excluded.created_by_column,
  parent_columns = excluded.parent_columns,
  archived_column = excluded.archived_column,
  archived_values = excluded.archived_values;

create trigger project_object_sync
  after insert or update or delete on public.project
  for each row execute function app.sync_object_from_native();

create trigger task_object_sync
  after insert or update or delete on public.task
  for each row execute function app.sync_object_from_native();

-- Backfill: projects first, so tasks find their parent.
select app.upsert_native_object('project', to_jsonb(p)) from public.project p;
select app.upsert_native_object('task', to_jsonb(t)) from public.task t;
