-- Workspace OS integration I5: meeting notes in the block editor (epic #199).
--
-- Session I4's exit test found that a task written in meeting notes did not
-- yet reach every screen as one object (tests/e2e/wos-regression-notes.md,
-- findings F1 to F5). Four database changes close that:
--
-- 1. A meeting's notes become an editor document (editor_document with
--    object_type 'meeting'), as pages and task descriptions are. Access
--    follows the meeting and never widens it: reading needs
--    app.can_read_meeting, writing needs app.can_manage_meeting, exactly the
--    rule the plain-text notes already had. meeting.notes stays as the plain
--    text copy the classic meeting page, search and the placeholder editor
--    read, kept in step both ways the way task.description is (M4d).
-- 2. A task may record a page as its source (M7b): the `/task` block and the
--    "Make a task" suggestion on a page create tasks that said `manual` until
--    now (F5).
-- 3. The meeting shows the task's due date and owner, never a stale copy (F3):
--    meeting_action.due_at/owner_id and an approved meeting_capture's
--    due_on/owner_id follow task.due_at/assignee_id through a trigger on the
--    task, whichever screen made the edit (the task drawer, a lens, the API).
-- 4. A reviewed capture stays final for everything except that: it may change
--    only to match the task it created.

-- 1. Meeting notes as an editor document ------------------------------------

alter table public.editor_document
  drop constraint if exists editor_document_object_type_check;
alter table public.editor_document
  add constraint editor_document_object_type_check
  check (object_type in ('page', 'task', 'meeting'));

create or replace function app.can_editor_object(p_object_type text, p_object_id uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_object_type
    when 'page' then app.can_page(p_object_id, p_capability)
    when 'task' then app.can(p_object_id, p_capability)
    -- Notes follow the meeting: anyone who can read the meeting reads them,
    -- only a meeting manager (organizer, project manager, admin) edits them.
    when 'meeting' then case p_capability
      when 'view' then app.can_read_meeting(p_object_id)
      when 'edit_content' then app.can_manage_meeting(p_object_id)
      else false
    end
    else false
  end;
$$;

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
  elsif new.object_type = 'meeting' then
    select m.organization_id into v_org from public.meeting m where m.id = new.object_id;
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

-- editor saves      -> meeting.notes is set to the document's text
-- notes change      -> an existing document is replaced by that text, one
--                      paragraph per line (the classic meeting page, the
--                      placeholder editor while wos_editor is off)
-- Both compare before writing, so neither triggers the other again. Both run
-- as the database (security definer): the save already passed the document's
-- rule, which is the meeting's own management rule, so the mirror opens
-- nothing new; and the classic page's notes update already passed the
-- meeting's RLS.
create or replace function app.sync_meeting_notes_from_document()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.object_type <> 'meeting' then
    return null;
  end if;
  update public.meeting m
  set notes = nullif(new.content_text, ''), updated_at = now()
  where m.id = new.object_id
    and coalesce(m.notes, '') is distinct from coalesce(new.content_text, '');
  return null;
end;
$$;

create or replace function app.sync_document_from_meeting_notes()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.editor_document d
  set content = app.plain_text_to_content(new.notes),
      content_text = coalesce(new.notes, ''),
      yjs_state = null
  where d.object_id = new.id
    and d.object_type = 'meeting'
    and d.content_text is distinct from coalesce(new.notes, '');
  return null;
end;
$$;

revoke all on function app.sync_meeting_notes_from_document() from public, anon, authenticated;
revoke all on function app.sync_document_from_meeting_notes() from public, anon, authenticated;

create trigger editor_document_sync_meeting_notes
  after insert or update of content_text on public.editor_document
  for each row
  when (new.object_type = 'meeting')
  execute function app.sync_meeting_notes_from_document();

create trigger meeting_sync_editor_document
  after update of notes on public.meeting
  for each row
  when (old.notes is distinct from new.notes)
  execute function app.sync_document_from_meeting_notes();

-- 2. A page as a task's source ---------------------------------------------
-- The list is the one in 20261105010001_task_source.sql plus `page`;
-- src/features/universal-tasks/sources.ts mirrors it and a test keeps them in
-- step.

alter table public.task
  drop constraint if exists task_source_type_check;
alter table public.task
  add constraint task_source_type_check check (source_type in (
    'manual',      -- typed into a task form
    'meeting',     -- a meeting action or a block in its notes (source_id: meeting)
    'document',    -- a document (source_id: document)
    'page',        -- a block in a page (source_id: page)
    'comment',     -- a comment on any record (source_id: record_comment or task_comment)
    'project',     -- a project template applied to a project (source_id: project)
    'message',     -- a chat message (source_id: message)
    'workflow',    -- a workflow run (source_id: workflow rule or run)
    'contact',     -- a CRM follow-up (source_id: crm_follow_up)
    'template',    -- the record-template catalogue (source_id: record_template)
    'recurrence',  -- a recurring task (source_id: previous occurrence or series)
    'capture',     -- the capture inbox (source_id: capture item)
    'command'      -- the command palette (no source row)
  ));

-- 3. The meeting follows the task -------------------------------------------
-- meeting_action and meeting_capture keep a due date and an owner because the
-- classic meeting page and the review read them without joining the task.
-- They are the task's values from now on: an edit to the task, from any
-- screen, lands here in the same transaction.

create or replace function app.sync_meeting_links_from_task()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.meeting_action a
  set due_at = new.due_at, owner_id = new.assignee_id
  where a.task_id = new.id
    and (a.due_at is distinct from new.due_at or a.owner_id is distinct from new.assignee_id);
  update public.meeting_capture c
  set due_on = new.due_at, owner_id = new.assignee_id
  where c.created_object_type = 'task'
    and c.created_object_id = new.id
    and (c.due_on is distinct from new.due_at or c.owner_id is distinct from new.assignee_id);
  return null;
end;
$$;

revoke all on function app.sync_meeting_links_from_task() from public, anon, authenticated;

create trigger task_sync_meeting_links
  after update of due_at, assignee_id on public.task
  for each row
  when (old.due_at is distinct from new.due_at or old.assignee_id is distinct from new.assignee_id)
  execute function app.sync_meeting_links_from_task();

-- 4. A reviewed capture may change only to follow its task -------------------
-- Otherwise identical to 20261105110100_meetings_v2_capture.sql.

create or replace function app.meeting_capture_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_task_due date;
  v_task_owner uuid;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    select m.organization_id into v_org from public.meeting m where m.id = new.meeting_id;
    if v_org is null then
      raise exception 'Meeting not found' using errcode = '23503';
    end if;
    new.organization_id := v_org;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    if new.status <> 'open' or new.created_object_id is not null then
      raise exception 'A new capture starts open' using errcode = '23514';
    end if;
  else
    new.organization_id := old.organization_id;
    new.meeting_id := old.meeting_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.status <> 'open' then
      -- Final, except that the due date and owner of an approved task capture
      -- are the task's: they may take the task's current values and nothing
      -- else (app.sync_meeting_links_from_task writes them; anyone else can
      -- only repeat the same values).
      if old.created_object_type = 'task' then
        select t.due_at, t.assignee_id into v_task_due, v_task_owner
        from public.task t where t.id = old.created_object_id;
      end if;
      if old.created_object_type = 'task'
         and new.status = old.status
         and new.kind = old.kind
         and new.body = old.body
         and new.detail is not distinct from old.detail
         and new.agenda_item_id is not distinct from old.agenda_item_id
         and new.created_object_type is not distinct from old.created_object_type
         and new.created_object_id is not distinct from old.created_object_id
         and new.due_on is not distinct from v_task_due
         and new.owner_id is not distinct from v_task_owner then
        new.reviewed_by := old.reviewed_by;
        new.reviewed_at := old.reviewed_at;
        return new;
      end if;
      raise exception 'A reviewed capture cannot be changed' using errcode = '42501';
    end if;
    if new.status <> 'open' then
      if not app.can_manage_meeting(new.meeting_id) then
        raise exception 'Only the meeting organizer can review captures' using errcode = '42501';
      end if;
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    else
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
  end if;

  if new.agenda_item_id is not null and not exists (
    select 1 from public.agenda_item a
    where a.id = new.agenda_item_id and a.meeting_id = new.meeting_id
  ) then
    raise exception 'The agenda item belongs to another meeting' using errcode = '23514';
  end if;

  -- A created object must be the one this capture produced: a task linked to
  -- this meeting through meeting_action, or a decision recorded in it.
  if new.created_object_type = 'task' and not exists (
    select 1 from public.meeting_action ma
    where ma.meeting_id = new.meeting_id and ma.task_id = new.created_object_id
  ) then
    raise exception 'The task was not created from this meeting' using errcode = '23514';
  end if;
  if new.created_object_type = 'decision' and not exists (
    select 1 from public.decision d
    where d.id = new.created_object_id and d.meeting_id = new.meeting_id
  ) then
    raise exception 'The decision was not recorded in this meeting' using errcode = '23514';
  end if;
  return new;
end;
$$;
