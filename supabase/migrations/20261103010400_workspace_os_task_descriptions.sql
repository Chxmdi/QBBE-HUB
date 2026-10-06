-- Workspace OS: task descriptions in the block editor (M4d, stream S3, #199).
--
-- A task's description becomes an editor document (editor_document with
-- object_type 'task'). task.description stays: notifications, search,
-- exports, reports and the existing task screens read it, so it is kept as
-- the plain-text copy of the document.
--
--   editor saves        -> task.description is set to the document's text
--   description changes -> an existing document is replaced by that text,
--                          one paragraph per line (the old task form, the API,
--                          recurring copies)
--
-- Both directions compare before writing, so neither triggers the other
-- again. Both run with the caller's own rights (not security definer), so a
-- save still passes the task's RLS and enforce_scoped_task_update, and a
-- document change still passes editor_document's RLS. Changing a description
-- and editing the document need the same capability (manage or collaborate),
-- so neither path opens anything new.
--
-- Existing descriptions are converted below. A task without a document is
-- converted on read by the app (plainTextToContent), with the same rules as
-- app.plain_text_to_content.

-- One paragraph per line; blank lines kept as empty paragraphs; trailing
-- line breaks dropped. Mirrors plainTextToContent in
-- src/features/editor/adapter/content.ts.
create or replace function app.plain_text_to_content(p_text text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case
    when p_text is null or btrim(replace(replace(p_text, E'\r', ''), E'\n', '')) = ''
      then '{"version":1,"blocks":[]}'::jsonb
    else jsonb_build_object(
      'version', 1,
      'blocks', (
        select jsonb_agg(
          jsonb_build_object(
            'type', 'paragraph',
            'content', case when line = '' then '[]'::jsonb
                            else jsonb_build_array(jsonb_build_object('type', 'text', 'text', line)) end
          ) order by n)
        from unnest(string_to_array(
          regexp_replace(replace(replace(p_text, E'\r\n', E'\n'), E'\r', E'\n'), E'\n+$', ''),
          E'\n'
        )) with ordinality as lines(line, n)
      )
    )
  end;
$$;

revoke all on function app.plain_text_to_content(text) from public, anon;
grant execute on function app.plain_text_to_content(text) to authenticated, service_role;

-- The text a task description should hold for a document's text. The task
-- form limits descriptions to 5,000 characters.
create or replace function app.description_from_document_text(p_text text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(left(coalesce(p_text, ''), 5000), '');
$$;

revoke all on function app.description_from_document_text(text) from public, anon;
grant execute on function app.description_from_document_text(text) to authenticated, service_role;

create or replace function app.sync_task_description_from_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.object_type <> 'task' then
    return null;
  end if;
  -- Written out rather than calling app.description_from_document_text: this
  -- runs as the signed-in person, who cannot use the app schema.
  update public.task t
  set description = nullif(left(coalesce(new.content_text, ''), 5000), '')
  where t.id = new.object_id
    -- Unchanged text, or a long legacy description whose first 5,000
    -- characters already match, is left alone.
    and left(coalesce(t.description, ''), 5000) is distinct from left(coalesce(new.content_text, ''), 5000);
  return null;
end;
$$;

create or replace function app.sync_document_from_task_description()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The same conversion as app.plain_text_to_content, written out because
  -- this runs as the signed-in person, who cannot use the app schema.
  update public.editor_document d
  set content = case
        when new.description is null
          or btrim(replace(replace(new.description, E'\r', ''), E'\n', '')) = ''
          then '{"version":1,"blocks":[]}'::jsonb
        else jsonb_build_object('version', 1, 'blocks', (
          select jsonb_agg(jsonb_build_object(
            'type', 'paragraph',
            'content', case when line = '' then '[]'::jsonb
                            else jsonb_build_array(jsonb_build_object('type', 'text', 'text', line)) end
          ) order by n)
          from unnest(string_to_array(
            regexp_replace(replace(replace(new.description, E'\r\n', E'\n'), E'\r', E'\n'), E'\n+$', ''),
            E'\n'
          )) with ordinality as lines(line, n)))
      end,
      content_text = coalesce(new.description, ''),
      yjs_state = null
  where d.object_id = new.id
    and d.object_type = 'task'
    and left(d.content_text, 5000) is distinct from left(coalesce(new.description, ''), 5000);
  return null;
end;
$$;

revoke all on function app.sync_task_description_from_document() from public, anon;
revoke all on function app.sync_document_from_task_description() from public, anon;
grant execute on function app.sync_task_description_from_document() to authenticated, service_role;
grant execute on function app.sync_document_from_task_description() to authenticated, service_role;

-- Convert what exists today, before the triggers exist.
insert into public.editor_document (object_id, object_type, organization_id, created_by, content, content_text)
select t.id, 'task', t.organization_id, t.created_by,
       app.plain_text_to_content(t.description),
       left(regexp_replace(replace(replace(t.description, E'\r\n', E'\n'), E'\r', E'\n'), E'\n+$', ''), 500000)
from public.task t
where t.description is not null
  and btrim(t.description) <> ''
  and t.created_by is not null
on conflict (object_id) do nothing;

create trigger editor_document_sync_task_description
  after insert or update of content_text on public.editor_document
  for each row
  when (new.object_type = 'task')
  execute function app.sync_task_description_from_document();

create trigger task_sync_editor_document
  after update of description on public.task
  for each row
  when (old.description is distinct from new.description)
  execute function app.sync_document_from_task_description();
