create or replace function app.can_read_meeting(p_meeting uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from meeting m where m.id = p_meeting and (
    app.is_org_staff(m.organization_id) or (app.is_org_member(m.organization_id) and m.organizer_id = auth.uid())
    or (app.is_org_member(m.organization_id) and exists (select 1 from meeting_attendee a where a.meeting_id = m.id and a.user_id = auth.uid()))
  ));
$$;
create or replace function app.can_manage_meeting(p_meeting uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from meeting m where m.id = p_meeting and app.is_org_staff(m.organization_id));
$$;
create or replace function app.can_read_event(p_event uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from event e where e.id = p_event and app.is_org_member(e.organization_id) and (
    app.is_org_staff(e.organization_id) or exists (select 1 from event_assignment a where a.event_id = e.id and a.user_id = auth.uid())
  ));
$$;
create or replace function app.can_manage_event(p_event uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from event e where e.id = p_event and app.is_org_staff(e.organization_id));
$$;
revoke all on function app.can_manage_meeting(uuid), app.can_read_event(uuid), app.can_manage_event(uuid) from public;
grant execute on function app.can_manage_meeting(uuid), app.can_read_event(uuid), app.can_manage_event(uuid) to authenticated;

drop policy if exists meeting_staff_write on meeting;
create policy meeting_staff_write on meeting for all to authenticated using (app.is_org_staff(organization_id)) with check (app.is_org_staff(organization_id));
drop policy if exists meeting_attendee_staff_write on meeting_attendee;
create policy meeting_attendee_staff_write on meeting_attendee for all to authenticated using (app.can_manage_meeting(meeting_id)) with check (app.can_manage_meeting(meeting_id));
drop policy if exists agenda_member_insert on agenda_item;
create policy agenda_member_insert on agenda_item for insert to authenticated with check (app.can_read_meeting(meeting_id));
drop policy if exists agenda_staff_update on agenda_item;
create policy agenda_staff_update on agenda_item for update to authenticated using (app.can_manage_meeting(meeting_id) or proposed_by = auth.uid()) with check (app.can_read_meeting(meeting_id));
drop policy if exists agenda_staff_delete on agenda_item;
create policy agenda_staff_delete on agenda_item for delete to authenticated using (app.can_manage_meeting(meeting_id));
drop policy if exists decision_staff_write on decision;
create policy decision_staff_write on decision for all to authenticated using (app.is_org_staff(organization_id)) with check (app.is_org_staff(organization_id));
drop policy if exists meeting_action_staff_write on meeting_action;
create policy meeting_action_staff_write on meeting_action for all to authenticated using (app.can_manage_meeting(meeting_id)) with check (app.can_manage_meeting(meeting_id));

drop policy if exists event_read on event;
create policy event_read on event for select to authenticated using (app.can_read_event(id));
drop policy if exists event_staff_write on event;
create policy event_staff_write on event for all to authenticated using (app.is_org_staff(organization_id)) with check (app.is_org_staff(organization_id));
drop policy if exists event_assignment_read on event_assignment;
create policy event_assignment_read on event_assignment for select to authenticated using (app.can_read_event(event_id));
drop policy if exists event_assignment_staff_write on event_assignment;
create policy event_assignment_staff_write on event_assignment for all to authenticated using (app.can_manage_event(event_id)) with check (app.can_manage_event(event_id));
