-- Workspace OS block editor content (M4b, stream S3, epic #199).
--
-- One row per object that has a body: a page now, a task description in M4d.
-- `content` is the editor's block tree as JSON (src/features/editor/adapter/
-- content.ts), the form the app reads, renders and searches. M4c adds the
-- live Yjs state beside it and derives `block` rows from it; neither changes
-- this row's key or its rules.
--
-- Access follows the object: a page's rule (app.can_page) for pages, and
-- app.can for everything else, which today means tasks through
-- has_task_capability. Reading needs `view`; writing needs `edit_content`.
-- `version` rises on every save so two tabs cannot silently overwrite each
-- other before co-editing (V1-17) arrives.

create table public.editor_document (
  object_id uuid primary key,
  object_type text not null check (object_type in ('page', 'task')),
  organization_id uuid not null references public.organization (id) on delete cascade,
  content jsonb not null default '{"version":1,"blocks":[]}'::jsonb
    check (jsonb_typeof(content) = 'object' and jsonb_typeof(content -> 'blocks') = 'array'),
  content_text text not null default '' check (char_length(content_text) <= 500000),
  version integer not null default 1 check (version > 0),
  created_by uuid not null default auth.uid() references public.user_profile (id),
  updated_by uuid references public.user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint editor_document_size check (pg_column_size(content) <= 5 * 1024 * 1024)
);

comment on table public.editor_document is
  'Block editor content per object (M4b): JSON block tree plus its plain text.';

create index editor_document_org_idx on public.editor_document (organization_id, object_type);

create or replace function app.can_editor_object(p_object_type text, p_object_id uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_object_type
    when 'page' then app.can_page(p_object_id, p_capability)
    when 'task' then app.can(p_object_id, p_capability)
    else false
  end;
$$;

revoke all on function app.can_editor_object(text, uuid, text) from public, anon;
grant execute on function app.can_editor_object(text, uuid, text) to authenticated, service_role;

-- The row takes its organization from the object and cannot be moved to
-- another object or type; version and timestamps are kept by the database.
create or replace function app.editor_document_before_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if tg_op = 'UPDATE' then
    if new.object_id <> old.object_id or new.object_type <> old.object_type then
      raise exception 'An editor document cannot move to another object' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;

  if new.object_type = 'page' then
    select p.organization_id into v_org from public.page p where p.id = new.object_id;
  elsif new.object_type = 'task' then
    select t.organization_id into v_org from public.task t where t.id = new.object_id;
  end if;
  if v_org is null then
    raise exception 'No such object for this document' using errcode = '23503';
  end if;
  new.organization_id := v_org;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

revoke all on function app.editor_document_before_write() from public, anon, authenticated;

create trigger editor_document_before_write
  before insert or update on public.editor_document
  for each row execute function app.editor_document_before_write();

alter table public.editor_document enable row level security;

create policy editor_document_read on public.editor_document
  for select to authenticated
  using (app.can_editor_object(object_type, object_id, 'view'));

create policy editor_document_insert on public.editor_document
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and app.can_editor_object(object_type, object_id, 'edit_content')
  );

create policy editor_document_update on public.editor_document
  for update to authenticated
  using (app.can_editor_object(object_type, object_id, 'edit_content'))
  with check (app.can_editor_object(object_type, object_id, 'edit_content'));

revoke all on public.editor_document from anon, authenticated;
grant select, insert, update on public.editor_document to authenticated;
grant all on public.editor_document to service_role;
