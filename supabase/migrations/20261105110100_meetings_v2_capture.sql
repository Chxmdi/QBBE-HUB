-- Workspace OS V1-9: meetings as objects (stream S5b, epic #199).
--
-- A meeting already has an agenda (agenda_item), attendees, notes, decisions
-- and actions. What it lacked is a place to capture things *during* the
-- meeting without committing them yet: a decision someone voiced, a task, an
-- open question, a follow-up. They are held here as captures until the
-- end-of-meeting review, where the organizer approves or dismisses each one.
-- Approved tasks and follow-ups become real tasks through the shared
-- create-task action, approved decisions become `decision` rows, approved
-- questions stay on the meeting's record. Nothing here is generated: every
-- capture is typed by a person (no transcript, no AI).
--
-- Access follows the meeting and never widens it:
--   read     anyone who can read the meeting (app.can_read_meeting)
--   capture  anyone who can read the meeting, as themselves
--   edit     the author while the capture is still open, or a meeting manager
--   review   a meeting manager (app.can_manage_meeting) only
--   delete   the author while open, or a meeting manager
--
-- The module is hidden behind the `wos_meetings_v2` switch until sign-off
-- (20261105110000_s5b_feature_switches).

create table public.meeting_capture (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  meeting_id uuid not null references public.meeting (id) on delete cascade,
  agenda_item_id uuid references public.agenda_item (id) on delete set null,
  kind text not null check (kind in ('decision', 'task', 'question', 'follow_up')),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  detail text check (detail is null or char_length(detail) <= 4000),
  owner_id uuid references public.user_profile (id) on delete set null,
  due_on date,
  status text not null default 'open'
    check (status in ('open', 'approved', 'dismissed')),
  created_object_type text check (created_object_type is null or created_object_type in ('task', 'decision')),
  created_object_id uuid,
  created_by uuid not null references public.user_profile (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references public.user_profile (id),
  reviewed_at timestamptz,
  constraint meeting_capture_review_recorded
    check ((status = 'open') = (reviewed_at is null)),
  constraint meeting_capture_object_pair
    check ((created_object_type is null) = (created_object_id is null)),
  constraint meeting_capture_object_only_when_approved
    check (created_object_id is null or status = 'approved')
);

create index idx_meeting_capture_meeting on public.meeting_capture (meeting_id, created_at);
create index idx_meeting_capture_open on public.meeting_capture (meeting_id) where status = 'open';

comment on table public.meeting_capture is
  'Decisions, tasks, questions and follow-ups captured during a meeting, held until the end-of-meeting review (Workspace OS V1-9).';

-- Keeps the row honest whoever writes it: organization and meeting come from
-- the meeting, the author cannot be forged, a reviewed capture is final, and
-- the agenda item (if any) belongs to the same meeting.
create or replace function app.meeting_capture_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
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
revoke all on function app.meeting_capture_guard() from public, anon, authenticated;

create trigger meeting_capture_guard
  before insert or update on public.meeting_capture
  for each row execute function app.meeting_capture_guard();

alter table public.meeting_capture enable row level security;

create policy meeting_capture_read on public.meeting_capture
  for select to authenticated
  using (app.can_read_meeting(meeting_id));

create policy meeting_capture_insert on public.meeting_capture
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and app.can_read_meeting(meeting_id)
  );

create policy meeting_capture_update on public.meeting_capture
  for update to authenticated
  using (
    app.can_manage_meeting(meeting_id)
    or (created_by = (select auth.uid()) and status = 'open')
  )
  with check (app.can_read_meeting(meeting_id));

create policy meeting_capture_delete on public.meeting_capture
  for delete to authenticated
  using (
    app.can_manage_meeting(meeting_id)
    or (created_by = (select auth.uid()) and status = 'open')
  );

revoke all on public.meeting_capture from anon, authenticated;
grant select, insert, update, delete on public.meeting_capture to authenticated;
grant all on public.meeting_capture to service_role;
