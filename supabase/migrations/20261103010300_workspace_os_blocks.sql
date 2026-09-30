-- Workspace OS editor persistence (M4c, stream S3, epic #199).
--
-- 1. The live Yjs document state for each object is kept beside its JSON
--    content in editor_document. The editor runs on a Yjs document, so live
--    co-editing (V1-17) can later sync the same state without a migration.
--    Saves still carry editor_document.version, so a stale window cannot
--    overwrite a newer one.
-- 2. `block` holds one row per block of every document: id, object, type,
--    position, text and the object it points at. Search, backlinks and
--    queries read it. It is rebuilt by a trigger from the saved JSON on every
--    save, inside the same transaction, so it can never disagree with the
--    content; nobody writes it through the API.

alter table public.editor_document
  add column yjs_state bytea
    check (yjs_state is null or octet_length(yjs_state) <= 8 * 1024 * 1024);

comment on column public.editor_document.yjs_state is
  'Yjs document state (Y.encodeStateAsUpdate) for the editor; null until the editor first saves one.';

create table public.block (
  object_id uuid not null references public.editor_document (object_id) on delete cascade,
  block_id text not null check (char_length(block_id) between 1 and 100),
  organization_id uuid not null references public.organization (id) on delete cascade,
  object_type text not null,
  parent_block_id text,
  type text not null check (char_length(type) between 1 and 60),
  position integer not null check (position > 0),
  depth integer not null check (depth >= 0),
  text text not null default '',
  props jsonb not null default '{}'::jsonb,
  referenced_object_id uuid,
  referenced_kind text check (referenced_kind in ('object', 'document')),
  search_vector tsvector generated always as (
    to_tsvector('english'::regconfig, text) || to_tsvector('french'::regconfig, text)
  ) stored,
  updated_at timestamptz not null default now(),
  primary key (object_id, block_id),
  check ((referenced_object_id is null) = (referenced_kind is null))
);

comment on table public.block is
  'One row per editor block (M4c), derived from editor_document.content by trigger. Read-only through the API.';

create index block_object_position_idx on public.block (object_id, position);
create index block_reference_idx on public.block (organization_id, referenced_object_id)
  where referenced_object_id is not null;
create index block_type_idx on public.block (organization_id, type);
create index block_search_idx on public.block using gin (search_vector);

-- Text of a block's inline content: text runs and link text, in order; for
-- tables, cells joined by tabs and rows by new lines.
create or replace function app.block_inline_text(p_content jsonb)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_content is null then ''
    when jsonb_typeof(p_content) = 'string' then p_content #>> '{}'
    when jsonb_typeof(p_content) = 'array' then coalesce((
      select string_agg(
        coalesce(
          item ->> 'text',
          (select string_agg(part ->> 'text', '' order by n)
           from jsonb_array_elements(
             case when jsonb_typeof(item -> 'content') = 'array' then item -> 'content' else '[]'::jsonb end
           ) with ordinality as parts(part, n)),
          ''
        ), '' order by ord)
      from jsonb_array_elements(p_content) with ordinality as items(item, ord)
    ), '')
    when jsonb_typeof(p_content) = 'object' and jsonb_typeof(p_content -> 'rows') = 'array' then coalesce((
      select string_agg(
        (select string_agg(
           app.block_inline_text(case when jsonb_typeof(cell) = 'array' then cell else cell -> 'content' end),
           E'\t' order by c)
         from jsonb_array_elements(
           case when jsonb_typeof(r -> 'cells') = 'array' then r -> 'cells' else '[]'::jsonb end
         ) with ordinality as cells(cell, c)),
        E'\n' order by rn)
      from jsonb_array_elements(p_content -> 'rows') with ordinality as rows(r, rn)
    ), '')
    else ''
  end;
$$;

-- The object or library document a block points at: `props.objectId` for the
-- semantic blocks of M5, or a `qbbe-document:<id>` file reference.
create or replace function app.block_reference(p_props jsonb, out referenced_object_id uuid, out referenced_kind text)
language plpgsql immutable
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_value text;
begin
  v_value := p_props ->> 'objectId';
  if v_value ~ v_uuid then
    referenced_object_id := v_value::uuid;
    referenced_kind := 'object';
    return;
  end if;
  v_value := p_props ->> 'url';
  if v_value like 'qbbe-document:%' and substr(v_value, 15) ~ v_uuid then
    referenced_object_id := substr(v_value, 15)::uuid;
    referenced_kind := 'document';
  end if;
end;
$$;

create or replace function app.derive_blocks()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.block where object_id = new.object_id;

  insert into public.block (
    object_id, block_id, organization_id, object_type, parent_block_id, type,
    position, depth, text, props, referenced_object_id, referenced_kind
  )
  with recursive walk as (
    select b.value as blk,
           null::text as parent_id,
           0 as depth,
           lpad(b.ordinality::text, 6, '0') as path
    from jsonb_array_elements(
      case when jsonb_typeof(new.content -> 'blocks') = 'array' then new.content -> 'blocks' else '[]'::jsonb end
    ) with ordinality as b(value, ordinality)
    union all
    select c.value,
           coalesce(w.blk ->> 'id', md5(new.object_id::text || w.path)),
           w.depth + 1,
           w.path || '.' || lpad(c.ordinality::text, 6, '0')
    from walk w,
         jsonb_array_elements(
           case when jsonb_typeof(w.blk -> 'children') = 'array' then w.blk -> 'children' else '[]'::jsonb end
         ) with ordinality as c(value, ordinality)
    where w.depth < 40
  )
  select new.object_id,
         left(coalesce(nullif(w.blk ->> 'id', ''), md5(new.object_id::text || w.path)), 100),
         new.organization_id,
         new.object_type,
         w.parent_id,
         left(coalesce(nullif(w.blk ->> 'type', ''), 'paragraph'), 60),
         (row_number() over (order by w.path))::integer,
         w.depth,
         left(app.block_inline_text(w.blk -> 'content'), 20000),
         case when jsonb_typeof(w.blk -> 'props') = 'object' then w.blk -> 'props' else '{}'::jsonb end,
         (app.block_reference(w.blk -> 'props')).referenced_object_id,
         (app.block_reference(w.blk -> 'props')).referenced_kind
  from walk w
  where jsonb_typeof(w.blk) = 'object'
  on conflict (object_id, block_id) do nothing;

  return null;
end;
$$;

create trigger editor_document_derive_blocks
  after insert or update of content on public.editor_document
  for each row execute function app.derive_blocks();

revoke all on function app.derive_blocks() from public, anon, authenticated;
revoke all on function app.block_inline_text(jsonb) from public, anon;
revoke all on function app.block_reference(jsonb) from public, anon;
grant execute on function app.block_inline_text(jsonb) to authenticated, service_role;
grant execute on function app.block_reference(jsonb) to authenticated, service_role;

-- Documents saved before this migration get their blocks now.
update public.editor_document set content = content;

alter table public.block enable row level security;

create policy block_read on public.block
  for select to authenticated
  using (app.can_editor_object(object_type, object_id, 'view'));

revoke all on public.block from anon, authenticated;
grant select on public.block to authenticated;
grant all on public.block to service_role;
