-- Workspace OS Google objects (V1-15, migration 20261106110400): a person
-- forwards only their own mail into their own capture inbox, turns only their
-- own calendar events into meetings, and only as the meeting rules allow.
-- Roles: owner, admin, staff, volunteer, guest, signed-out (org_role has no
-- separate "member" or "accountant"). Run after qa-users.sql and rls.sql.
-- All mutations roll back. Nothing here reaches Google.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_staff_conn uuid;
  v_owner_conn uuid;
  v_staff_mail uuid;
  v_owner_mail uuid;
  v_owner_event uuid;
  v_meeting uuid;
  v_capture uuid;
  v_ok boolean;
  v_n integer;
  v_text text;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_admin, v_guest);

  insert into public.integration_connection (organization_id, user_id, provider, status)
  values (v_org, v_staff, 'gmail', 'connected') returning id into v_staff_conn;
  insert into public.integration_connection (organization_id, user_id, provider, status)
  values (v_org, v_owner, 'google_calendar', 'connected') returning id into v_owner_conn;
  insert into public.gmail_message (organization_id, user_id, connection_id, external_id, subject, snippet, from_address, received_at)
  values (v_org, v_staff, v_staff_conn, 'm-staff', 'Venue quote', 'The hall is free on the 12th', 'venue@example.com', now())
  returning id into v_staff_mail;
  insert into public.gmail_message (organization_id, user_id, connection_id, external_id, subject)
  values (v_org, v_owner, v_staff_conn, 'm-owner', 'Owner mail')
  returning id into v_owner_mail;
  insert into public.calendar_event_link (organization_id, user_id, connection_id, external_id, title, starts_at)
  values (v_org, v_owner, v_owner_conn, 'ev-1', 'Board prep', now() + interval '2 days')
  returning id into v_owner_event;

  -- ---------------------------------------------------------- Gmail to capture
  perform tests.authenticate(v_staff);
  insert into public.capture_forward (organization_id, source, source_id, title, body)
  values (v_org, 'gmail', v_staff_mail, 'Forged title', 'Forged body')
  returning id into v_capture;
  select title || '|' || sender into v_text from public.capture_forward where id = v_capture;
  perform tests.ok(v_text = 'Venue quote|venue@example.com', 'staff forward their own mail; the copy comes from the message, not the request');
  begin
    insert into public.capture_forward (organization_id, source, source_id, title)
    values (v_org, 'gmail', v_owner_mail, 'x');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'nobody forwards someone else''s mail');
  update public.capture_forward set status = 'triaged' where id = v_capture;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 1, 'the person triages their own captured item');
  begin
    update public.capture_forward set title = 'Edited' where id = v_capture;
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'only the status of a captured item changes');
  reset role;

  for r in select * from (values (v_owner, 'the owner'), (v_admin, 'an admin'), (v_volunteer, 'a volunteer'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    select count(*) into v_n from public.capture_forward where id = v_capture;
    update public.capture_forward set status = 'dismissed' where id = v_capture;
    get diagnostics v_ok = row_count;
    reset role;
    perform tests.ok(v_n = 0 and not v_ok, format('%s cannot read or change someone else''s capture', r.who));
  end loop;

  perform tests.authenticate(v_volunteer);
  begin
    insert into public.capture_forward (organization_id, source, source_id, title)
    values (v_org, 'gmail', v_staff_mail, 'x');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a volunteer cannot forward staff mail');
  reset role;

  -- ---------------------------------------------------------- Calendar to meetings
  perform tests.authenticate(v_owner);
  -- The id is chosen first: the meeting read rule cannot see a row inside
  -- the statement that inserts it, so RETURNING is refused (as the app does it).
  v_meeting := gen_random_uuid();
  insert into public.meeting (id, organization_id, title, organizer_id, starts_at)
  values (v_meeting, v_org, 'Board prep', v_owner, now() + interval '2 days');
  perform public.google_link_event_meeting(v_owner_event, v_meeting);
  select count(*) into v_n from public.calendar_event_link where id = v_owner_event and meeting_id = v_meeting;
  perform tests.ok(v_n = 1, 'the owner turns their own event into a meeting');
  begin
    perform public.google_link_event_meeting(v_owner_event, v_meeting);
    v_ok := false;
  exception when unique_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'an event becomes a meeting only once');
  reset role;
  update public.calendar_event_link set meeting_id = null where id = v_owner_event;

  for r in select * from (values (v_staff, 'staff'), (v_admin, 'an admin'), (v_volunteer, 'a volunteer'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    begin
      perform public.google_link_event_meeting(v_owner_event, v_meeting);
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    reset role;
    perform tests.ok(v_ok, format('%s cannot use someone else''s calendar event', r.who));
  end loop;

  -- A volunteer with their own event still cannot make an organization-wide
  -- meeting: the meeting table's own rule refuses first.
  insert into public.calendar_event_link (organization_id, user_id, connection_id, external_id, title, starts_at)
  values (v_org, v_volunteer, v_owner_conn, 'ev-2', 'Volunteer shift', now() + interval '1 day');
  perform tests.authenticate(v_volunteer);
  begin
    insert into public.meeting (organization_id, title, organizer_id, starts_at)
    values (v_org, 'Volunteer shift', v_volunteer, now() + interval '1 day');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a volunteer cannot create an organization-wide meeting from their calendar');
  reset role;

  -- ---------------------------------------------------------- signed out
  perform tests.clear_auth();
  begin
    select count(*) into v_n from public.capture_forward;
    v_ok := v_n = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor sees no captured mail');
  begin
    perform public.google_link_event_meeting(v_owner_event, v_meeting);
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor cannot link events');
  reset role;
end;
$$;

rollback;
