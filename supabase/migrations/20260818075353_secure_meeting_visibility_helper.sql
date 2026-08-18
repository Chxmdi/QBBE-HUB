-- Use one narrowly scoped SECURITY DEFINER predicate so parent and child
-- meeting policies can share visibility rules without recursively evaluating
-- meeting <-> meeting_attendee RLS policies.
create or replace function app.can_read_meeting(p_meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from meeting m
    where m.id = p_meeting
      and (
        app.is_staff()
        or m.organizer_id = auth.uid()
        or exists (
          select 1
          from meeting_attendee a
          where a.meeting_id = m.id
            and a.user_id = auth.uid()
        )
      )
  );
$$;

revoke all on function app.can_read_meeting(uuid) from public;
grant execute on function app.can_read_meeting(uuid) to authenticated;

drop policy if exists meeting_read on meeting;
create policy meeting_read on meeting
  for select to authenticated
  using (app.can_read_meeting(id));

drop policy if exists meeting_attendee_read on meeting_attendee;
create policy meeting_attendee_read on meeting_attendee
  for select to authenticated
  using (app.can_read_meeting(meeting_id));

drop policy if exists agenda_read on agenda_item;
create policy agenda_read on agenda_item
  for select to authenticated
  using (app.can_read_meeting(meeting_id));

drop policy if exists meeting_action_read on meeting_action;
create policy meeting_action_read on meeting_action
  for select to authenticated
  using (app.can_read_meeting(meeting_id));

drop policy if exists decision_read on decision;
create policy decision_read on decision
  for select to authenticated
  using (
    (meeting_id is not null and app.can_read_meeting(meeting_id))
    or (meeting_id is null and app.is_staff())
  );
