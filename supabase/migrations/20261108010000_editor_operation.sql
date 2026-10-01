-- Workspace OS operation-based saves (wave 1, U3; plan A4, A10, A12).
--
-- The editor no longer sends "the whole document, please overwrite" and hopes
-- for the best. Each save is an operation batch appended to this log through
-- app-facing function public.append_editor_operations, which in one
-- transaction:
--   1. refuses when the caller may not edit the object (the same
--      app.can_editor_object check editor_document's policies make);
--   2. refuses with a 'conflict' (errcode 40001) when the batch was based on a
--      version other than the current one, so a stale window never overwrites
--      a newer save — the browser then asks the person what to do;
--   3. applies the operations to editor_document, so the version rises and
--      app.derive_blocks rebuilds the block rows exactly as before;
--   4. appends one editor_operation row with the next sequence number and
--      keeps only the last 200 rows per object.
--
-- Operation v1 shape, one per array element of `ops`:
--   {"kind": "replace", "content": <EditorContent>, "state": <base64 Yjs update or null>}
-- The log is the raw material for compare, undo across sessions and, later,
-- merging; today the browser only appends to it.

create table public.editor_operation (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null references public.editor_document (object_id) on delete cascade,
  object_type text not null check (object_type in ('page', 'task', 'meeting')),
  organization_id uuid not null references public.organization (id) on delete cascade,
  seq bigint not null check (seq > 0),
  base_version integer not null check (base_version >= 0),
  ops jsonb not null check (jsonb_typeof(ops) = 'array' and jsonb_array_length(ops) between 1 and 100),
  actor_id uuid references public.user_profile (id),
  created_at timestamptz not null default now(),
  unique (object_id, seq),
  constraint editor_operation_size check (pg_column_size(ops) <= 5 * 1024 * 1024)
);

comment on table public.editor_operation is
  'Append-only log of editor save operations per object (U3); the last 200 per object are kept.';

create index editor_operation_org_idx on public.editor_operation (organization_id, object_type, created_at desc);

-- Plain text of one block and its descendants, as src/features/editor/adapter/
-- content.ts computes it (blockText): the inline text, or the block's url when
-- it has no text, then each non-empty child on its own line.
create or replace function app.editor_block_text(p_block jsonb, p_depth integer default 0)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_own text;
  v_children text;
begin
  if p_block is null or jsonb_typeof(p_block) <> 'object' then
    return '';
  end if;
  v_own := coalesce(app.block_inline_text(p_block -> 'content'), '');
  if v_own = '' and jsonb_typeof(p_block -> 'props') = 'object' and jsonb_typeof(p_block -> 'props' -> 'url') = 'string' then
    v_own := p_block -> 'props' ->> 'url';
  end if;
  if p_depth >= 40 or jsonb_typeof(p_block -> 'children') <> 'array' then
    return v_own;
  end if;
  select string_agg(t, E'\n' order by n) into v_children
  from (
    select app.editor_block_text(c.value, p_depth + 1) as t, c.ordinality as n
    from jsonb_array_elements(p_block -> 'children') with ordinality as c(value, ordinality)
  ) parts
  where t <> '';
  if v_own = '' then
    return coalesce(v_children, '');
  end if;
  return v_own || coalesce(E'\n' || v_children, '');
end;
$$;

-- The whole document as plain text, one block per line, trailing blank lines
-- removed; the same as contentToPlainText in content.ts.
create or replace function app.editor_content_text(p_content jsonb)
returns text
language sql immutable
set search_path = ''
as $$
  select left(
    regexp_replace(
      coalesce((
        select string_agg(app.editor_block_text(b.value), E'\n' order by b.ordinality)
        from jsonb_array_elements(
          case when jsonb_typeof(p_content -> 'blocks') = 'array' then p_content -> 'blocks' else '[]'::jsonb end
        ) with ordinality as b(value, ordinality)
      ), ''),
      E'\n+$', ''),
    500000);
$$;

revoke all on function app.editor_block_text(jsonb, integer) from public, anon;
revoke all on function app.editor_content_text(jsonb) from public, anon;
grant execute on function app.editor_block_text(jsonb, integer) to authenticated, service_role;
grant execute on function app.editor_content_text(jsonb) to authenticated, service_role;

-- Runs as the function owner so it can prune the log, but every write is
-- gated by exactly the check editor_document's own policies make, as the
-- signed-in person (auth.uid()); nothing here widens who can save.
create or replace function public.append_editor_operations(
  p_object uuid,
  p_type text,
  p_base_version integer,
  p_ops jsonb
)
returns table (version integer, seq bigint)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_current integer;
  v_op jsonb;
  v_content jsonb;
  v_state text;
  v_seq bigint;
  v_version integer;
begin
  if v_actor is null then
    raise exception 'Sign in to save' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('page', 'task', 'meeting') then
    raise exception 'Unknown object type' using errcode = '22023';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'No operations to apply' using errcode = '22023';
  end if;
  if not app.can_editor_object(p_type, p_object, 'edit_content') then
    raise exception 'You cannot change this content' using errcode = '42501';
  end if;

  -- One append at a time per object: later callers wait on this lock and
  -- then see the version this one produced.
  select d.version into v_current
  from public.editor_document d
  where d.object_id = p_object
  for update;

  if v_current is distinct from p_base_version then
    raise exception 'conflict' using errcode = '40001', detail = coalesce(v_current::text, '0');
  end if;

  for v_op in select value from jsonb_array_elements(p_ops) loop
    if jsonb_typeof(v_op) <> 'object' or v_op ->> 'kind' <> 'replace' then
      raise exception 'Unknown operation' using errcode = '22023';
    end if;
    v_content := v_op -> 'content';
    if v_content is null or jsonb_typeof(v_content) <> 'object' or jsonb_typeof(v_content -> 'blocks') <> 'array' then
      raise exception 'Invalid content' using errcode = '22023';
    end if;
    v_state := case when jsonb_typeof(v_op -> 'state') = 'string' then v_op ->> 'state' else null end;
    if v_state is not null and v_state !~ '^[A-Za-z0-9+/]*={0,2}$' then
      raise exception 'Invalid state' using errcode = '22023';
    end if;
  end loop;

  -- Only the last operation of a batch decides the stored document: every
  -- operation today is a whole-document replace.
  v_content := p_ops -> (jsonb_array_length(p_ops) - 1) -> 'content';
  v_state := case
    when jsonb_typeof(p_ops -> (jsonb_array_length(p_ops) - 1) -> 'state') = 'string'
      then p_ops -> (jsonb_array_length(p_ops) - 1) ->> 'state'
    else null
  end;

  if v_current is null then
    insert into public.editor_document (object_id, object_type, organization_id, content, content_text, yjs_state, created_by)
    select p_object, p_type, o.organization_id, v_content, app.editor_content_text(v_content),
           case when v_state is null then null else decode(v_state, 'base64') end, v_actor
    from (
      select p.organization_id from public.page p where p.id = p_object and p_type = 'page'
      union all
      select t.organization_id from public.task t where t.id = p_object and p_type = 'task'
      union all
      select m.organization_id from public.meeting m where m.id = p_object and p_type = 'meeting'
    ) o
    returning editor_document.version, editor_document.organization_id into v_version, v_org;
    if v_version is null then
      raise exception 'No such object for this document' using errcode = '23503';
    end if;
  else
    update public.editor_document d
    set content = v_content,
        content_text = app.editor_content_text(v_content),
        yjs_state = case when v_state is null then d.yjs_state else decode(v_state, 'base64') end
    where d.object_id = p_object
    returning d.version, d.organization_id into v_version, v_org;
  end if;

  select coalesce(max(o.seq), 0) + 1 into v_seq from public.editor_operation o where o.object_id = p_object;

  insert into public.editor_operation (object_id, object_type, organization_id, seq, base_version, ops, actor_id)
  values (p_object, p_type, v_org, v_seq, coalesce(p_base_version, 0), p_ops, v_actor);

  -- Retention: the last 200 operations per object.
  delete from public.editor_operation o where o.object_id = p_object and o.seq <= v_seq - 200;

  version := v_version;
  seq := v_seq;
  return next;
end;
$$;

revoke all on function public.append_editor_operations(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.append_editor_operations(uuid, text, integer, jsonb) to authenticated, service_role;

alter table public.editor_operation enable row level security;

-- Reading the log follows reading the document; appending follows editing it,
-- as the signed-in person. Nothing is changed or removed through the API: the
-- function above is the only pruner.
create policy editor_operation_read on public.editor_operation
  for select to authenticated
  using (app.can_editor_object(object_type, object_id, 'view'));

create policy editor_operation_insert on public.editor_operation
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and app.can_editor_object(object_type, object_id, 'edit_content')
  );

revoke all on public.editor_operation from anon, authenticated;
grant select, insert on public.editor_operation to authenticated;
grant all on public.editor_operation to service_role;
