-- Workspace OS integration I5: meeting notes in the block editor, a page as a
-- task's source, and the meeting following its tasks (20261107030100).
-- Allow and deny for every role: owner, admin, staff (organizer and project
-- manager), member (staff with no grant on the project), volunteer
-- (attendee), accountant (ledger guest) and signed out.
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
  v_page uuid;
  v_task uuid;
  v_block_task uuid;
  v_capture uuid;
  v_reviewed_at timestamptz;
  v_version integer;
  v_text text;
  v_due date;
  v_owner_id uuid;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Notes editor', 'notes-editor-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Notes editor project', v_owner, v_owner)
  returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_staff, 'project_manager', 'direct', v_owner);

  insert into public.meeting (organization_id, program_id, project_id, title, organizer_id, starts_at, notes)
  values (v_org, v_program, v_project, 'Gala planning', v_staff, now(), 'Typed before the editor')
  returning id into v_meeting;
  insert into public.meeting (organization_id, title, organizer_id, starts_at)
  values (v_org, 'Someone else''s meeting', v_owner, now())
  returning id into v_other_meeting;
  insert into public.meeting_attendee (meeting_id, user_id) values (v_meeting, v_volunteer);

  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_owner, 'Shared notes') returning id into v_page;

  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner);

  -- 1. The meeting's notes as an editor document ---------------------------

  -- Staff (organizer and project manager) writes the document.
  perform tests.authenticate(v_staff);
  insert into public.editor_document (object_id, object_type, organization_id, created_by, content, content_text)
  values (v_meeting, 'meeting', v_org, v_staff,
          '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"Discussed the venue."}]}]}'::jsonb,
          'Discussed the venue.');
  select count(*) into n from public.editor_document where object_id = v_meeting and object_type = 'meeting';
  perform tests.ok(n = 1, 'staff: the organizer creates the meeting''s notes document');
  select organization_id = v_org into strict failed from public.editor_document where object_id = v_meeting;
  perform tests.ok(failed, 'staff: the document takes its organization from the meeting');
  select notes into v_text from public.meeting where id = v_meeting;
  perform tests.ok(v_text = 'Discussed the venue.', 'staff: meeting.notes mirrors the document''s text');

  update public.editor_document
  set content = '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"Discussed the venue and the date."}]}]}'::jsonb,
      content_text = 'Discussed the venue and the date.'
  where object_id = v_meeting;
  select version, content_text into v_version, v_text from public.editor_document where object_id = v_meeting;
  perform tests.ok(v_version = 2 and v_text = 'Discussed the venue and the date.', 'staff: the organizer edits the notes and the version rises');
  select notes into v_text from public.meeting where id = v_meeting;
  perform tests.ok(v_text = 'Discussed the venue and the date.', 'staff: an edit in the editor reaches meeting.notes');

  -- The classic page writes plain notes: the document follows, one paragraph per line.
  update public.meeting set notes = E'Line one\nLine two' where id = v_meeting;
  select content_text into v_text from public.editor_document where object_id = v_meeting;
  perform tests.ok(v_text = E'Line one\nLine two', 'staff: plain notes saved elsewhere replace the document''s text');
  select jsonb_array_length(content -> 'blocks') into n from public.editor_document where object_id = v_meeting;
  perform tests.ok(n = 2, 'staff: plain notes become one paragraph per line');
  select (yjs_state is null) into strict failed from public.editor_document where object_id = v_meeting;
  perform tests.ok(failed, 'staff: the collaboration state is dropped when plain notes replace the document');
  -- Saving the same text again changes nothing (no loop between the two mirrors).
  select version into v_version from public.editor_document where object_id = v_meeting;
  update public.meeting set notes = E'Line one\nLine two' where id = v_meeting;
  select count(*) into n from public.editor_document where object_id = v_meeting and version = v_version;
  perform tests.ok(n = 1, 'staff: unchanged notes leave the document alone');

  -- Staff cannot write notes for a meeting they do not manage.
  failed := false;
  begin
    insert into public.editor_document (object_id, object_type, organization_id, created_by)
    values (v_other_meeting, 'meeting', v_org, v_staff);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: no notes document on a meeting they do not manage');

  failed := false;
  begin
    insert into public.editor_document (object_id, object_type, organization_id, created_by)
    values (gen_random_uuid(), 'meeting', v_org, v_staff);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: no document for a meeting that does not exist');

  -- Volunteer (attendee): reads, never writes.
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.editor_document where object_id = v_meeting;
  perform tests.ok(n = 1, 'volunteer: an attendee reads the meeting''s notes');
  update public.editor_document set content_text = 'Hijacked' where object_id = v_meeting;
  select count(*) into n from public.editor_document where object_id = v_meeting and content_text = 'Hijacked';
  perform tests.ok(n = 0, 'volunteer: an attendee cannot edit the notes');
  select notes into v_text from public.meeting where id = v_meeting;
  perform tests.ok(v_text = E'Line one\nLine two', 'volunteer: the refused edit never reached meeting.notes');

  -- Member (staff with no grant on the project): nothing.
  perform tests.authenticate(v_member);
  select count(*) into n from public.editor_document where object_id = v_meeting;
  perform tests.ok(n = 0, 'member: a member outside the project cannot read the notes');
  update public.editor_document set content_text = 'Outsider' where object_id = v_meeting;
  select count(*) into n from public.editor_document where object_id = v_meeting and content_text = 'Outsider';
  perform tests.ok(n = 0, 'member: a member outside the project cannot edit the notes');

  -- Accountant: ledger access reaches no meeting notes.
  perform tests.authenticate(v_accountant);
  select count(*) into n from public.editor_document where object_id = v_meeting;
  perform tests.ok(n = 0, 'accountant: ledger access does not reach meeting notes');

  -- Admin and owner manage every meeting.
  perform tests.authenticate(v_admin);
  update public.editor_document set content_text = 'Admin edit', content = '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"Admin edit"}]}]}'::jsonb
  where object_id = v_meeting;
  select count(*) into n from public.editor_document where object_id = v_meeting and content_text = 'Admin edit';
  perform tests.ok(n = 1, 'admin: an administrator edits the notes');
  perform tests.authenticate(v_owner);
  select count(*) into n from public.editor_document where object_id = v_meeting and content_text = 'Admin edit';
  perform tests.ok(n = 1, 'owner: the owner reads the notes');

  -- Signed out.
  perform tests.clear_auth();
  failed := false;
  begin
    select count(*) into n from public.editor_document where object_id = v_meeting;
    failed := n = 0;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'signed out: the notes cannot be read');
  reset role;

  -- 2. A page as a task's source -------------------------------------------
  perform tests.authenticate(v_staff);
  insert into public.task (organization_id, project_id, title, created_by, source_type, source_id)
  values (v_org, v_project, 'Order chairs', v_staff, 'page', v_page)
  returning id into v_block_task;
  select count(*) into n from public.task where id = v_block_task and source_type = 'page' and source_id = v_page;
  perform tests.ok(n = 1, 'staff: a task records the page it was written in');
  failed := false;
  begin
    insert into public.task (organization_id, project_id, title, created_by, source_type, source_id)
    values (v_org, v_project, 'Typed by hand', v_staff, 'manual', v_page);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a manual task cannot point at a page');
  failed := false;
  begin
    insert into public.task (organization_id, project_id, title, created_by, source_type, source_id)
    values (v_org, v_project, 'Nowhere', v_staff, 'notebook', v_page);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: an unknown source kind is refused');
  update public.task set source_type = 'manual', source_id = null where id = v_block_task;
  select count(*) into n from public.task where id = v_block_task and source_type = 'page';
  perform tests.ok(n = 1, 'staff: a page source is fixed at creation');

  -- 3. The meeting follows the task ----------------------------------------
  -- A reviewed capture whose task was made by the review, as the app does it.
  insert into public.meeting_capture (meeting_id, kind, body, owner_id, due_on)
  values (v_meeting, 'task', 'Book the hall', v_volunteer, current_date + 20)
  returning id into v_capture;
  v_task := public.create_meeting_action(v_meeting, 'Book the hall', v_volunteer, (current_date + 20)::timestamptz);
  update public.meeting_capture
  set status = 'approved', created_object_type = 'task', created_object_id = v_task
  where id = v_capture;
  select reviewed_at into v_reviewed_at from public.meeting_capture where id = v_capture;
  perform tests.ok(v_reviewed_at is not null, 'staff: the capture is approved with its task');

  -- The one edit, on the task: the meeting's two copies follow.
  update public.task set due_at = current_date + 27, assignee_id = v_staff where id = v_task;
  select due_at, owner_id into v_due, v_owner_id from public.meeting_action where task_id = v_task;
  perform tests.ok(v_due = current_date + 27 and v_owner_id = v_staff,
    'staff: moving the task''s due date and owner moves the classic meeting action');
  select due_on, owner_id into v_due, v_owner_id from public.meeting_capture where id = v_capture;
  perform tests.ok(v_due = current_date + 27 and v_owner_id = v_staff,
    'staff: the approved capture shows the task''s new due date and owner');
  select count(*) into n from public.meeting_capture
  where id = v_capture and status = 'approved' and reviewed_at = v_reviewed_at and body = 'Book the hall';
  perform tests.ok(n = 1, 'staff: the review record itself is untouched by the sync');

  -- Clearing the date clears the copies too.
  update public.task set due_at = null where id = v_task;
  select count(*) into n from public.meeting_action where task_id = v_task and due_at is null;
  perform tests.ok(n = 1, 'staff: a cleared due date clears the meeting action''s copy');
  select count(*) into n from public.meeting_capture where id = v_capture and due_on is null;
  perform tests.ok(n = 1, 'staff: a cleared due date clears the capture''s copy');
  update public.task set due_at = current_date + 27 where id = v_task;

  -- The copies cannot drift on their own: a reviewed capture is still final.
  failed := false;
  begin
    update public.meeting_capture set due_on = current_date + 40 where id = v_capture;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: an approved capture''s due date cannot be set to anything but the task''s');
  failed := false;
  begin
    update public.meeting_capture set owner_id = v_volunteer where id = v_capture;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: an approved capture''s owner cannot be set to anyone but the task''s');
  failed := false;
  begin
    update public.meeting_capture set body = 'Changed after review' where id = v_capture;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a reviewed capture''s text is final');
  failed := false;
  begin
    update public.meeting_capture set status = 'dismissed' where id = v_capture;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a reviewed capture cannot be reviewed again');
  update public.meeting_capture set due_on = current_date + 27, owner_id = v_staff where id = v_capture;
  select count(*) into n from public.meeting_capture where id = v_capture and due_on = current_date + 27;
  perform tests.ok(n = 1, 'staff: repeating the task''s own values on the capture is harmless');

  -- The sync writes only to the meeting's rows for that task.
  select count(*) into n from public.meeting_action where meeting_id = v_meeting;
  perform tests.ok(n = 1, 'staff: the sync adds no meeting action');

  -- Volunteer: the assignee can see the task but cannot touch the meeting's copies.
  perform tests.authenticate(v_volunteer);
  update public.meeting_capture set due_on = current_date + 27 where id = v_capture;
  update public.meeting_action set due_at = current_date + 50 where task_id = v_task;
  select count(*) into n from public.meeting_action where task_id = v_task and due_at = current_date + 50;
  perform tests.ok(n = 0, 'volunteer: an attendee cannot edit the meeting action');

  -- Signed out: nothing.
  perform tests.clear_auth();
  failed := false;
  begin
    update public.meeting_action set due_at = current_date + 50 where task_id = v_task;
    select count(*) into n from public.meeting_action where task_id = v_task and due_at = current_date + 50;
    failed := n = 0;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'signed out: cannot edit a meeting action');
  reset role;
end;
$$;

rollback;
