-- ---------------------------------------------------------------------------
-- Agenda triage belongs to whoever runs the meeting.
--
-- P0-AGD-02 splits the agenda in two: invitees propose items, and the
-- organizer accepts, defers or declines them. The proposing half worked. The
-- deciding half had no command and no control anywhere in the product, so
-- `status` was written once at insert and never again — which is why every
-- item stayed in whatever state it was born in.
--
-- Two things had to be true in the database before a triage control could be
-- trusted, and neither was.
--
-- First, `status` is `text` and its permitted values lived in a trailing
-- comment. `-- proposed | accepted | deferred | declined | done` documents an
-- intention; it does not stop anything. Any string at all was accepted, so a
-- typo in a future command would have produced an item in a state no screen
-- knows how to draw, and nothing would have complained at the point of
-- writing it.
--
-- Second, and more seriously: `agenda_staff_update` permits an update when
-- `app.can_manage_meeting(meeting_id) OR proposed_by = auth.uid()`. The second
-- branch is there so somebody can correct the wording of their own proposal,
-- which is reasonable — but RLS grants rows, not columns, so it also let a
-- proposer set their own item's status. A volunteer could propose an item and
-- then accept it. That is not a triage process; it is a queue anybody can
-- promote themselves out of, and the requirement says the organizer decides.
--
-- Column-level permission is the wrong instrument here — it would mean
-- splitting grants across a table whose other columns are freely editable by
-- the proposer. A trigger states the rule exactly as the requirement states
-- it: the status may change only at the hand of someone who can manage the
-- meeting. Everything else about an item stays editable by whoever proposed
-- it.
-- ---------------------------------------------------------------------------

-- Any row already carrying a value outside the intended set would block the
-- constraint. There should be none, but a migration that assumes that and is
-- wrong fails in production rather than here.
update agenda_item
   set status = 'proposed'
 where status not in ('proposed', 'accepted', 'deferred', 'declined', 'done');

alter table agenda_item
  add constraint agenda_item_status_is_known
  check (status in ('proposed', 'accepted', 'deferred', 'declined', 'done'));

create or replace function app.agenda_status_is_the_organizers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and not app.can_manage_meeting(new.meeting_id) then
    raise exception 'Only the meeting organizer can triage agenda items.'
      using errcode = 'insufficient_privilege',
            hint = 'You can still edit the wording of an item you proposed.';
  end if;
  return new;
end;
$$;

-- BEFORE UPDATE so the refusal happens instead of the write rather than after
-- it, and only when the status actually moves — editing a title must not need
-- the organizer's authority.
drop trigger if exists trg_agenda_status_is_the_organizers on agenda_item;
create trigger trg_agenda_status_is_the_organizers
  before update on agenda_item
  for each row execute function app.agenda_status_is_the_organizers();
