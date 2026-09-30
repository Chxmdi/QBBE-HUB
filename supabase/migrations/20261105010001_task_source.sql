-- Universal tasks: every task records where it came from (M7b, epic #199).
--
-- Tasks are created from many places: the task form, meeting actions, chat
-- messages, CRM follow-ups, project templates, the record-template catalogue,
-- recurring series and, with Workspace OS, documents, comments, workflows,
-- the capture inbox and the command palette. Until now only a message left a
-- trace (`source_message_id`); a meeting action was traceable only through
-- `meeting_action.task_id`, and everything else left nothing.
--
-- `source_type` names the kind of thing, `source_id` the row. The application
-- creates every task through one action (src/features/universal-tasks), which
-- sets both. Inserts that do not name a source get one derived here, so older
-- code paths and SQL functions still record the right origin:
--   * a `source_message_id`      is a message;
--   * a `recurrence_parent_id`   is the previous occurrence (recurrence);
--   * a `series_id`              is the recurring series (recurrence);
--   * anything else              is `manual` with no id.
--
-- The source is provenance: it is fixed at creation. An update may not change
-- it (task_source_fixed below); only the service role can correct one.
--
-- No new table, so no new policy: the two columns are read and written through
-- the task table's existing row-level security. Knowing a source id does not
-- open the source; the link back is resolved through that source's own RLS
-- (src/features/universal-tasks/source.queries.ts).

alter table public.task
  add column if not exists source_type text not null default 'manual',
  add column if not exists source_id uuid;

alter table public.task
  drop constraint if exists task_source_type_check;
alter table public.task
  add constraint task_source_type_check check (source_type in (
    'manual',      -- typed into a task form
    'meeting',     -- a meeting action (source_id: meeting)
    'document',    -- a document (source_id: document)
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

alter table public.task
  drop constraint if exists task_source_id_needs_type;
alter table public.task
  add constraint task_source_id_needs_type
  check (source_id is null or source_type <> 'manual');

create index if not exists idx_task_source
  on public.task (source_type, source_id)
  where source_id is not null;

comment on column public.task.source_type is
  'Where the task came from (M7b). Fixed at creation.';
comment on column public.task.source_id is
  'The row the task came from, of the kind named by source_type. Null for manual and command tasks.';

-- Backfill, most specific first. A meeting action's task is also the only
-- trace of its meeting, so it wins over anything else.
update public.task t
set source_type = 'meeting', source_id = ma.meeting_id
from public.meeting_action ma
where ma.task_id = t.id and t.source_type = 'manual';

update public.task
set source_type = 'message', source_id = source_message_id
where source_type = 'manual' and source_message_id is not null;

update public.task
set source_type = 'recurrence', source_id = recurrence_parent_id
where source_type = 'manual' and recurrence_parent_id is not null;

update public.task
set source_type = 'recurrence', source_id = series_id
where source_type = 'manual' and series_id is not null;

update public.task t
set source_type = 'contact', source_id = f.id
from public.crm_follow_up f
where f.task_id = t.id and t.source_type = 'manual';

-- Defaults for inserts that name no source.
-- Security invoker on purpose: it needs no privilege of its own, and inside a
-- definer function current_user would always be the owner, which would make
-- every caller look like the database owner to the check below.
create or replace function app.task_source_defaults()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.source_type = 'manual' and new.source_id is null then
      if new.source_message_id is not null then
        new.source_type := 'message';
        new.source_id := new.source_message_id;
      elsif new.recurrence_parent_id is not null then
        new.source_type := 'recurrence';
        new.source_id := new.recurrence_parent_id;
      elsif new.series_id is not null then
        new.source_type := 'recurrence';
        new.source_id := new.series_id;
      end if;
    end if;
    return new;
  end if;

  -- Updates: provenance is fixed. The service role (migrations, repairs) may
  -- still correct it.
  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    new.source_type := old.source_type;
    new.source_id := old.source_id;
  end if;
  return new;
end;
$$;

-- Triggers run whatever the caller's execute rights; nobody calls it directly.
revoke all on function app.task_source_defaults() from public, anon, authenticated;

drop trigger if exists task_source_defaults on public.task;
create trigger task_source_defaults
  before insert or update of source_type, source_id on public.task
  for each row execute function app.task_source_defaults();

-- Meeting actions go through the same provenance: the task names its meeting.
-- Otherwise unchanged from 20260914154109_atomic_meeting_completion.sql.
create or replace function public.create_meeting_action(
  p_meeting uuid, p_title text, p_owner uuid, p_due timestamptz default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare m public.meeting; v_task uuid;
begin
  if auth.uid() is null or not public.can_manage_meeting(p_meeting) then
    raise exception 'Meeting management access required' using errcode = '42501';
  end if;
  select * into m from public.meeting where id = p_meeting for update;
  if not found or m.status = 'cancelled' then raise exception 'Meeting is unavailable'; end if;
  if p_title is null or length(trim(p_title)) not between 1 and 300 then
    raise exception 'Action title is required';
  end if;
  insert into public.task (organization_id, project_id, title, description,
    assignee_id, requester_id, due_at, created_by, source_type, source_id)
    values (m.organization_id, m.project_id, trim(p_title), 'Action from meeting “' || m.title || '”.',
      coalesce(p_owner, auth.uid()), auth.uid(), p_due, auth.uid(), 'meeting', m.id) returning id into v_task;
  insert into public.meeting_action (meeting_id, task_id, title, owner_id, due_at)
    values (m.id, v_task, trim(p_title), coalesce(p_owner, auth.uid()), p_due);
  if coalesce(p_owner, auth.uid()) <> auth.uid() then
    insert into public.notification (user_id, organization_id, category, title, body,
      source_type, source_id, link, dedupe_key)
      values (p_owner, m.organization_id, 'assignment', 'Meeting action assigned: ' || trim(p_title),
        'From “' || m.title || '”', 'task', v_task, '/my-work', 'assign:' || v_task || ':' || p_owner);
  end if;
  return v_task;
end;
$$;
revoke all on function public.create_meeting_action(uuid,text,uuid,timestamptz) from public, anon;
grant execute on function public.create_meeting_action(uuid,text,uuid,timestamptz) to authenticated;
