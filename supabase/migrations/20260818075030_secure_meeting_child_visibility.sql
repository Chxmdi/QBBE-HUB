-- Meeting children inherit the parent meeting policy (staff, organizer, or
-- attendee). This prevents direct table reads from bypassing a private meeting.
drop policy if exists meeting_attendee_read on meeting_attendee;
create policy meeting_attendee_read on meeting_attendee
  for select to authenticated
  using (exists (select 1 from meeting m where m.id = meeting_id));

drop policy if exists agenda_read on agenda_item;
create policy agenda_read on agenda_item
  for select to authenticated
  using (exists (select 1 from meeting m where m.id = meeting_id));

drop policy if exists meeting_action_read on meeting_action;
create policy meeting_action_read on meeting_action
  for select to authenticated
  using (exists (select 1 from meeting m where m.id = meeting_id));

drop policy if exists decision_read on decision;
create policy decision_read on decision
  for select to authenticated
  using (
    (meeting_id is not null and exists (select 1 from meeting m where m.id = meeting_id))
    or (meeting_id is null and app.is_staff())
  );
