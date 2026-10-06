-- Workspace OS V1-9: meeting captures and the end-of-meeting review.
-- Allow and deny for every role: owner, admin, staff (project manager),
-- member (staff with no grant on the project), volunteer (attendee),
-- accountant (a guest with ledger access only) and signed out.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_member uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_meeting uuid;
  v_other_meeting uuid;
  v_agenda uuid;
  v_other_agenda uuid;
  v_capture uuid;
  v_volunteer_capture uuid;
  v_task uuid;
  v_decision uuid;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Meetings v2', 'mv2-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Meetings v2 project', v_owner, v_owner)
  returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_staff, 'project_manager', 'direct', v_owner);

  insert into public.meeting (organization_id, program_id, project_id, title, organizer_id, starts_at)
  values (v_org, v_program, v_project, 'Planning', v_staff, now())
  returning id into v_meeting;
  insert into public.meeting (organization_id, title, organizer_id, starts_at)
  values (v_org, 'Someone else''s meeting', v_owner, now())
  returning id into v_other_meeting;
  insert into public.meeting_attendee (meeting_id, user_id) values (v_meeting, v_volunteer);
  insert into public.agenda_item (meeting_id, title) values (v_meeting, 'Budget') returning id into v_agenda;
  insert into public.agenda_item (meeting_id, title) values (v_other_meeting, 'Other') returning id into v_other_agenda;

  -- The accountant is a guest with read access to the books and nothing else.
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner);

  -- Staff (project manager, organizer) ------------------------------------
  perform tests.authenticate(v_staff);
  insert into public.meeting_capture (meeting_id, agenda_item_id, kind, body, owner_id)
  values (v_meeting, v_agenda, 'task', 'Book the hall', v_volunteer)
  returning id into v_capture;
  perform tests.ok(v_capture is not null, 'staff: the organizer can capture a task');
  select organization_id = v_org and created_by = v_staff into strict failed
  from public.meeting_capture where id = v_capture;
  perform tests.ok(failed, 'staff: organization and author are set from the meeting and the session');

  failed := false;
  begin
    insert into public.meeting_capture (meeting_id, agenda_item_id, kind, body)
    values (v_meeting, v_other_agenda, 'question', 'Wrong agenda');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a capture cannot point at another meeting''s agenda item');

  failed := false;
  begin
    insert into public.meeting_capture (meeting_id, kind, body, status)
    values (v_meeting, 'task', 'Pre-approved', 'approved');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a capture cannot be created already reviewed');

  -- Volunteer (attendee) ---------------------------------------------------
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.meeting_capture where meeting_id = v_meeting;
  perform tests.ok(n = 1, 'volunteer: an attendee reads the meeting''s captures');
  insert into public.meeting_capture (meeting_id, kind, body)
  values (v_meeting, 'question', 'Who pays for parking?')
  returning id into v_volunteer_capture;
  perform tests.ok(v_volunteer_capture is not null, 'volunteer: an attendee can capture a question');
  update public.meeting_capture set body = 'Who pays for parking and snacks?'
  where id = v_volunteer_capture;
  select count(*) into n from public.meeting_capture
  where id = v_volunteer_capture and body like '%snacks%';
  perform tests.ok(n = 1, 'volunteer: the author can edit an open capture');
  update public.meeting_capture set body = 'Hijacked' where id = v_capture;
  select count(*) into n from public.meeting_capture where id = v_capture and body = 'Hijacked';
  perform tests.ok(n = 0, 'volunteer: an attendee cannot edit someone else''s capture');
  failed := false;
  begin
    update public.meeting_capture set status = 'dismissed' where id = v_volunteer_capture;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'volunteer: an attendee cannot review captures');
  failed := false;
  begin
    insert into public.meeting_capture (meeting_id, kind, body, created_by)
    values (v_meeting, 'task', 'Forged', v_staff);
    select count(*) into n from public.meeting_capture where body = 'Forged' and created_by = v_staff;
    failed := n = 0;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'volunteer: the author cannot be forged');
  failed := false;
  begin
    insert into public.meeting_capture (meeting_id, kind, body)
    values (v_other_meeting, 'task', 'Not my meeting');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'volunteer: no capture on a meeting they cannot read');

  -- Member (staff with no grant) --------------------------------------------
  perform tests.authenticate(v_member);
  select count(*) into n from public.meeting_capture where meeting_id = v_meeting;
  perform tests.ok(n = 0, 'member: a member outside the project cannot read captures');
  failed := false;
  begin
    insert into public.meeting_capture (meeting_id, kind, body) values (v_meeting, 'task', 'Outsider');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'member: a member outside the project cannot capture');
  delete from public.meeting_capture where id = v_capture;
  perform tests.authenticate(v_owner);
  select count(*) into n from public.meeting_capture where id = v_capture;
  perform tests.ok(n = 1, 'member: a member outside the project cannot delete a capture');

  -- Accountant --------------------------------------------------------------
  perform tests.authenticate(v_accountant);
  select count(*) into n from public.meeting_capture;
  perform tests.ok(n = 0, 'accountant: ledger access does not reach meeting captures');
  failed := false;
  begin
    insert into public.meeting_capture (meeting_id, kind, body) values (v_meeting, 'task', 'Accountant');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'accountant: cannot capture');

  -- Signed out --------------------------------------------------------------
  perform tests.clear_auth();
  failed := false;
  begin
    select count(*) into n from public.meeting_capture;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'signed out: captures cannot be read');
  failed := false;
  begin
    insert into public.meeting_capture (meeting_id, kind, body) values (v_meeting, 'task', 'Anon');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'signed out: cannot capture');
  reset role;

  -- Review by the organizer: tasks through create_meeting_action ------------
  perform tests.authenticate(v_staff);
  failed := false;
  begin
    update public.meeting_capture
    set status = 'approved', created_object_type = 'task', created_object_id = gen_random_uuid()
    where id = v_capture;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a capture cannot claim a task this meeting did not create');

  v_task := public.create_meeting_action(v_meeting, 'Book the hall', v_volunteer, null);
  update public.meeting_capture
  set status = 'approved', created_object_type = 'task', created_object_id = v_task
  where id = v_capture;
  select count(*) into n from public.meeting_capture
  where id = v_capture and status = 'approved' and reviewed_by = v_staff and reviewed_at is not null;
  perform tests.ok(n = 1, 'staff: the organizer approves a task capture and the review is recorded');

  failed := false;
  begin
    update public.meeting_capture set body = 'Changed after review' where id = v_capture;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a reviewed capture is final');

  update public.meeting_capture set status = 'dismissed' where id = v_volunteer_capture;
  select count(*) into n from public.meeting_capture where id = v_volunteer_capture and status = 'dismissed';
  perform tests.ok(n = 1, 'staff: the organizer can dismiss a capture');

  -- Admin and owner (both at AAL2) -------------------------------------------
  perform tests.authenticate(v_admin);
  insert into public.meeting_capture (meeting_id, kind, body) values (v_meeting, 'decision', 'Hold it indoors')
  returning id into v_capture;
  insert into public.decision (organization_id, project_id, meeting_id, title, decided_by)
  values (v_org, v_project, v_meeting, 'Hold it indoors', v_admin)
  returning id into v_decision;
  update public.meeting_capture
  set status = 'approved', created_object_type = 'decision', created_object_id = v_decision
  where id = v_capture;
  select count(*) into n from public.meeting_capture where id = v_capture and status = 'approved';
  perform tests.ok(n = 1, 'admin: an administrator reviews a decision capture into a decision');

  perform tests.authenticate(v_admin, 'aal1');
  failed := false;
  begin
    insert into public.meeting_capture (meeting_id, kind, body) values (v_meeting, 'task', 'AAL1');
    update public.meeting_capture set status = 'dismissed' where body = 'AAL1';
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'admin: an administrator without two-step sign-in cannot review');

  perform tests.authenticate(v_owner);
  select count(*) into n from public.meeting_capture where meeting_id = v_meeting;
  perform tests.ok(n >= 3, 'owner: the owner reads every capture');
  insert into public.meeting_capture (meeting_id, kind, body) values (v_other_meeting, 'follow_up', 'Call the venue')
  returning id into v_capture;
  delete from public.meeting_capture where id = v_capture;
  select count(*) into n from public.meeting_capture where id = v_capture;
  perform tests.ok(n = 0, 'owner: the owner can delete an open capture');

  reset role;
end;
$$;

rollback;
