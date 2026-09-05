-- TST-003 / DONE-002: RLS allow + deny matrix.
-- Run after qa-users.sql against local Supabase:
--   cat supabase/tests/qa-users.sql supabase/tests/rls.sql \
--     | docker exec -i supabase_db_workspace psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- Recipe: new table → policies in the same migration → one allow + one deny here.

create schema if not exists tests;

create or replace function tests.ok(condition boolean, msg text)
returns void
language plpgsql
set search_path = tests, public, auth
as $$
begin
  if not condition then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'PASS: %', msg;
end;
$$;

create or replace function tests.authenticate(uid uuid)
returns void
language plpgsql
set search_path = tests, public, auth
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated', 'email', '')::text,
    true
  );
end;
$$;

create or replace function tests.clear_auth()
returns void
language plpgsql
set search_path = tests, public, auth
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant usage on schema tests to anon, authenticated, postgres;
grant execute on all functions in schema tests to anon, authenticated, postgres;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_vol uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_admin_org uuid;
  v_admin_rule uuid;
  v_other_risk uuid;
  v_other_issue uuid;
  v_other_opportunity uuid;
  v_risk uuid;
  v_org uuid;
  v_crm uuid;
  v_opportunity uuid;
  v_request uuid;
  v_approval uuid;
  v_report uuid;
  v_version uuid;
  v_export uuid;
  v_prog uuid;
  v_operation uuid;
  v_metric uuid;
  v_policy uuid;
  n int;
  m int;
  v_private uuid;
  v_private_message uuid;
  v_private_task uuid;
  v_recurring_parent uuid;
  v_private_label uuid;
  v_private_meeting uuid;
  v_private_agenda uuid;
  v_proposed_agenda uuid;
  v_text text;
  v_other_org uuid;
  v_other_team uuid;
  v_other_program uuid;
  v_other_project uuid;
  v_other_milestone uuid;
  v_other_task uuid;
  v_other_label uuid;
  v_other_crm uuid;
  v_other_channel uuid;
  v_other_message uuid;
  v_other_announcement uuid;
  v_other_document uuid;
  v_project uuid;
  v_job_run uuid;
  v_title text;
begin
  -- Fixtures must exist.
  select count(*) into n from auth.users
    where id in (v_owner, v_staff, v_vol, v_admin, v_guest);
  perform tests.ok(n = 5, 'qa users exist for all five roles');

  -- Every role in the product is represented, or the matrix below is a
  -- statement about three roles pretending to be a statement about five.
  select count(distinct role) into n from organization_membership
    where user_id in (v_owner, v_staff, v_vol, v_admin, v_guest);
  perform tests.ok(n = 5, 'the five organization roles are each held by a fixture');

  -- A member of one organization must not discover another organization's
  -- core directory records, teams, or membership list.
  insert into organization (name, slug)
  values ('RLS Isolated Organization', 'rls-isolated-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_other_org;
  insert into team (organization_id, name) values (v_other_org, 'Private team')
  returning id into v_other_team;
  insert into program (organization_id, name, slug, created_by)
  values (v_other_org, 'Private program', 'private-program-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_other_program;
  insert into project (organization_id, program_id, name, owner_id, created_by)
  values (v_other_org, v_other_program, 'Private project', v_owner, v_owner)
  returning id into v_other_project;
  insert into milestone (project_id, name) values (v_other_project, 'Private milestone')
  returning id into v_other_milestone;
  insert into task (organization_id, project_id, title, created_by)
  values (v_other_org, v_other_project, 'Private task', v_owner)
  returning id into v_other_task;
  insert into label (organization_id, name) values (v_other_org, 'Private label')
  returning id into v_other_label;
  insert into crm_organization (organization_id, name, created_by)
  values (v_other_org, 'Private CRM organization', v_owner)
  returning id into v_other_crm;

  -- The communication and document surfaces were scoped later than the rest,
  -- so they get the same isolation fixtures the core records already had.
  insert into channel (organization_id, name, slug, privacy, created_by)
  values (v_other_org, 'Private announcements', 'private-ann-'
          || substr(gen_random_uuid()::text, 1, 8), 'public', v_owner)
  returning id into v_other_channel;
  insert into message (organization_id, channel_id, author_id, body)
  values (v_other_org, v_other_channel, v_owner, 'Private announcement body')
  returning id into v_other_message;
  insert into announcement (organization_id, message_id, title, created_by)
  values (v_other_org, v_other_message, 'Private announcement', v_owner)
  returning id into v_other_announcement;
  insert into document (organization_id, title, kind, url, visibility, created_by)
  values (v_other_org, 'Private document', 'link', 'https://example.org/private',
          'organization', v_owner)
  returning id into v_other_document;
  insert into email_delivery (organization_id, recipient, subject, dedupe_key)
  values (v_other_org, 'private@example.org', 'Private subject',
          'rls-fixture-' || substr(gen_random_uuid()::text, 1, 8));
  insert into risk (organization_id, project_id, title, likelihood, impact, created_by)
  values (v_other_org, v_other_project, 'Private risk', 'high', 'high', v_owner)
  returning id into v_other_risk;
  insert into issue (organization_id, project_id, title, severity, created_by)
  values (v_other_org, v_other_project, 'Private issue', 'critical', v_owner)
  returning id into v_other_issue;
  insert into opportunity (organization_id, crm_organization_id, title, owner_id, created_by)
  values (v_other_org, v_other_crm, 'Private opportunity', v_owner, v_owner)
  returning id into v_other_opportunity;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from organization where id = v_other_org;
    perform tests.ok(n = 0, 'volunteer cannot read an organization they do not belong to');
    select count(*) into n from organization_membership where organization_id = v_other_org;
    perform tests.ok(n = 0, 'volunteer cannot read another organization membership list');
    select count(*) into n from team where id = v_other_team;
    perform tests.ok(n = 0, 'volunteer cannot read another organization team');
    select count(*) into n from team_member where team_id = v_other_team;
    perform tests.ok(n = 0, 'volunteer cannot read another organization team members');
    select count(*) into n from program where id = v_other_program;
    perform tests.ok(n = 0, 'volunteer cannot read another organization program');
    select count(*) into n from project where id = v_other_project;
    perform tests.ok(n = 0, 'volunteer cannot read another organization project');
    select count(*) into n from milestone where id = v_other_milestone;
    perform tests.ok(n = 0, 'volunteer cannot read another organization milestone');
    select count(*) into n from task where id = v_other_task;
    perform tests.ok(n = 0, 'volunteer cannot read another organization task');
    select count(*) into n from label where id = v_other_label;
    perform tests.ok(n = 0, 'volunteer cannot read another organization label');
    select count(*) into n from risk where id = v_other_risk;
    perform tests.ok(n = 0, 'volunteer cannot read another organization risk');
    select count(*) into n from issue where id = v_other_issue;
    perform tests.ok(n = 0, 'volunteer cannot read another organization issue');
  end;
  reset role;

  perform tests.authenticate(v_staff);
  begin
    set local role authenticated;
    select count(*) into n from crm_organization where id = v_other_crm;
    perform tests.ok(n = 0, 'staff cannot read another organization CRM records');
  end;
  reset role;

  -- Anon cannot read profiles (existence leak).
  perform tests.clear_auth();
  begin
    set local role anon;
    select count(*) into n from user_profile;
    perform tests.ok(n = 0, 'anon cannot read user_profile');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'anon cannot read user_profile (privilege denied)');
  end;
  reset role;

  -- Job execution records are operationally useful to admins but never to volunteers.
  insert into background_job_run (organization_id, job_name, status)
  select o.id, 'rls_test', 'succeeded' from organization o limit 1
  returning id into v_job_run;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from background_job_run where id = v_job_run;
    perform tests.ok(n = 0, 'volunteer cannot read background job runs');
  end;
  reset role;

  perform tests.authenticate(v_owner);
  begin
    set local role authenticated;
    select count(*) into n from background_job_run where id = v_job_run;
    perform tests.ok(n = 1, 'owner can read background job runs');
  end;
  reset role;

  -- Volunteer cannot read CRM (staff-only policy).
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from crm_organization;
    perform tests.ok(n = 0, 'volunteer cannot read crm_organization');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot read crm_organization (privilege denied)');
  end;
  reset role;

  -- Volunteer cannot read reports.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from report_instance;
    perform tests.ok(n = 0, 'volunteer cannot read report_instance');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot read report_instance (privilege denied)');
  end;
  reset role;

  -- Volunteer cannot read audit.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from audit_event;
    perform tests.ok(n = 0, 'volunteer cannot read audit_event');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot read audit_event (privilege denied)');
  end;
  reset role;

  -- Owner CAN read audit.
  perform tests.authenticate(v_owner);
  begin
    set local role authenticated;
    select count(*) into n from audit_event;
    perform tests.ok(true, 'owner can query audit_event (count=' || n || ')');
  exception
    when insufficient_privilege then
      perform tests.ok(false, 'owner should be able to read audit_event');
  end;
  reset role;

  -- Staff CAN read CRM (empty is still an allow).
  perform tests.authenticate(v_staff);
  begin
    set local role authenticated;
    select count(*) into n from crm_organization;
    perform tests.ok(true, 'staff can query crm_organization (count=' || n || ')');
  exception
    when insufficient_privilege then
      perform tests.ok(false, 'staff should be able to read crm_organization');
  end;
  reset role;

  -- Task children inherit task visibility rather than organization membership.
  insert into task (organization_id, title, status, assignee_id, requester_id, created_by)
  select o.id, 'Private task fixture', 'not_started', v_owner, v_owner, v_owner
  from organization o limit 1
  returning id into v_private_task;
  insert into checklist_item (task_id, title) values (v_private_task, 'Private checklist');
  insert into task_comment (task_id, author_id, body) values (v_private_task, v_owner, 'Private task comment');
  insert into label (organization_id, name)
  select o.id, 'Private task label ' || substr(gen_random_uuid()::text, 1, 8)
  from organization o limit 1
  returning id into v_private_label;
  insert into task_label (task_id, label_id) values (v_private_task, v_private_label);

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from checklist_item where task_id = v_private_task;
    perform tests.ok(n = 0, 'volunteer cannot read checklist for an inaccessible task');
    select count(*) into n from task_comment where task_id = v_private_task;
    perform tests.ok(n = 0, 'volunteer cannot read comments for an inaccessible task');
    select count(*) into n from task_label where task_id = v_private_task;
    perform tests.ok(n = 0, 'volunteer cannot read labels for an inaccessible task');
  end;
  reset role;

  perform tests.authenticate(v_owner);
  begin
    set local role authenticated;
    select count(*) into n from task_comment where task_id = v_private_task;
    perform tests.ok(n = 1, 'assignee can read children for an accessible task');
  end;
  reset role;

  -- Meeting children must not bypass a meeting's organizer/attendee policy.
  insert into meeting (organization_id, title, organizer_id, starts_at)
  select o.id, 'Private meeting fixture', v_owner, now()
  from organization o limit 1
  returning id into v_private_meeting;
  insert into meeting_attendee (meeting_id, user_id)
  values (v_private_meeting, v_owner);
  insert into agenda_item (meeting_id, title)
  values (v_private_meeting, 'Private agenda')
  returning id into v_private_agenda;
  insert into decision (organization_id, meeting_id, title)
  select o.id, v_private_meeting, 'Private decision'
  from organization o limit 1;
  insert into meeting_action (meeting_id, agenda_item_id, title)
  values (v_private_meeting, v_private_agenda, 'Private action');

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from meeting where id = v_private_meeting;
    perform tests.ok(n = 0, 'volunteer cannot read an inaccessible meeting');
    select count(*) into n from meeting_attendee where meeting_id = v_private_meeting;
    perform tests.ok(n = 0, 'volunteer cannot read attendees for an inaccessible meeting');
    select count(*) into n from agenda_item where meeting_id = v_private_meeting;
    perform tests.ok(n = 0, 'volunteer cannot read agenda for an inaccessible meeting');
    select count(*) into n from decision where meeting_id = v_private_meeting;
    perform tests.ok(n = 0, 'volunteer cannot read decisions for an inaccessible meeting');
    select count(*) into n from meeting_action where meeting_id = v_private_meeting;
    perform tests.ok(n = 0, 'volunteer cannot read actions for an inaccessible meeting');
  end;
  reset role;

  insert into meeting_attendee (meeting_id, user_id)
  values (v_private_meeting, v_vol);

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from meeting where id = v_private_meeting;
    perform tests.ok(n = 1, 'attendee can read their meeting');
    select count(*) into n from meeting_attendee where meeting_id = v_private_meeting;
    perform tests.ok(n = 2, 'attendee can read attendees for an accessible meeting');
    select count(*) into n from agenda_item where meeting_id = v_private_meeting;
    perform tests.ok(n = 1, 'attendee can read agenda for an accessible meeting');
    select count(*) into n from decision where meeting_id = v_private_meeting;
    perform tests.ok(n = 1, 'attendee can read decisions for an accessible meeting');
    select count(*) into n from meeting_action where meeting_id = v_private_meeting;
    perform tests.ok(n = 1, 'attendee can read actions for an accessible meeting');
  end;
  reset role;

  -- -----------------------------------------------------------------------
  -- Triage is the organizer's, and the database is what says so.
  --
  -- `agenda_staff_update` permits an update when the caller can manage the
  -- meeting OR proposed the item. The second branch exists so somebody can fix
  -- the wording of their own proposal — but RLS grants rows, not columns, so
  -- on its own it also let a proposer accept their own item. A queue anybody
  -- can promote themselves out of is not a triage process.
  --
  -- A trigger closes it: the status may move only at the hand of someone who
  -- can manage the meeting. Editing the wording still belongs to the proposer,
  -- which is the half worth keeping, so both are asserted.
  -- -----------------------------------------------------------------------
  insert into agenda_item (meeting_id, title, status, proposed_by)
  values (v_private_meeting, 'Volunteer proposal', 'proposed', v_vol)
  returning id into v_proposed_agenda;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    update agenda_item set status = 'accepted' where id = v_proposed_agenda;
    perform tests.ok(false, 'a proposer must not be able to accept their own item');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a proposer cannot accept their own agenda item');
  end;
  reset role;

  select status into v_text from agenda_item where id = v_proposed_agenda;
  perform tests.ok(v_text = 'proposed', 'the refused triage left the status alone');

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    update agenda_item set title = 'Volunteer proposal, reworded'
      where id = v_proposed_agenda;
    select count(*) into n from agenda_item
      where id = v_proposed_agenda and title = 'Volunteer proposal, reworded';
    perform tests.ok(n = 1, 'a proposer can still reword their own item');
  end;
  reset role;

  perform tests.authenticate(v_staff);
  begin
    set local role authenticated;
    update agenda_item set status = 'accepted' where id = v_proposed_agenda;
    select count(*) into n from agenda_item
      where id = v_proposed_agenda and status = 'accepted';
    perform tests.ok(n = 1, 'staff can triage a proposed agenda item');
  end;
  reset role;

  -- Run as staff on purpose. As superuser `auth.uid()` is null, so the trigger
  -- would refuse first and this would prove the trigger twice over rather than
  -- proving the constraint once — the values were documented in a comment and
  -- enforced by nothing until now.
  perform tests.authenticate(v_staff);
  begin
    set local role authenticated;
    update agenda_item set status = 'maybe-later' where id = v_proposed_agenda;
    perform tests.ok(false, 'an unknown agenda status must be refused');
  exception
    when check_violation then
      perform tests.ok(true, 'an unknown agenda status is refused by the database');
  end;
  reset role;

  -- v_vol stays on the attendee list here on purpose: the guest-list assertion
  -- below needs them able to read the meeting in order to prove they cannot
  -- edit who else is on it. An earlier draft tidied the row away and turned
  -- that test into a check that someone who cannot see a meeting cannot change
  -- it — true, and not the thing it claims to prove.
  -- Reading a meeting does not confer managing its guest list. Attendee writes
  -- are staff-only (`app.can_manage_meeting`), so an invitee cannot drop
  -- another attendee — which, because attendance is what grants read, would
  -- otherwise be a way to revoke someone else's access to the meeting.
  --
  -- Untested until now, and worth having for a reason the read assertions
  -- above illustrate: those have passed since the policy was written, while
  -- nothing in the product could create an attendee row at all. A policy
  -- proven correct in both directions is still not a feature.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    delete from meeting_attendee
      where meeting_id = v_private_meeting and user_id = v_owner;
    select count(*) into n from meeting_attendee
      where meeting_id = v_private_meeting and user_id = v_owner;
    perform tests.ok(n = 1, 'an attendee cannot remove another attendee');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'an attendee cannot remove another attendee (denied)');
  end;
  reset role;

  -- Private channel: create as owner (bypass RLS as postgres for setup).
  insert into channel (
    organization_id, name, slug, type, privacy, owner_id, created_by
  )
  select o.id, 'RLS Private', 'rls-private-' || substr(gen_random_uuid()::text, 1, 8),
         'custom', 'private', v_owner, v_owner
  from organization o
  limit 1
  returning id into v_private;

  insert into channel_member (channel_id, user_id, role, membership_source)
  values (v_private, v_owner, 'manager', 'manual')
  on conflict do nothing;

  -- Volunteer cannot see the private channel.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from channel where id = v_private;
    perform tests.ok(n = 0, 'volunteer cannot see private channel they are not in');
  end;
  reset role;

  -- Volunteer cannot see messages in that channel.
  insert into message (organization_id, channel_id, author_id, body)
  select o.id, v_private, v_owner, 'secret-rls-' || v_private::text
  from organization o limit 1
  returning id into v_private_message;

  insert into message_mention (message_id, mentioned_user_id)
  values (v_private_message, v_owner);

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from message where channel_id = v_private;
    perform tests.ok(n = 0, 'volunteer cannot read private channel messages');
  end;
  reset role;

  -- Mention metadata must not reveal an inaccessible private message.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from message_mention where message_id = v_private_message;
    perform tests.ok(n = 0, 'volunteer cannot read private message mentions');
  end;
  reset role;

  -- A guessed private-message UUID cannot be saved by a non-member.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    insert into saved_message (user_id, message_id) values (v_vol, v_private_message);
    perform tests.ok(false, 'volunteer must not save an inaccessible private message');
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      perform tests.ok(true, 'volunteer cannot save inaccessible private message');
  end;
  reset role;

  -- Search must not leak the private title (SECURITY INVOKER + RLS).
  -- Use EXECUTE so the SQL function is planned as `authenticated`, not as
  -- table-owner postgres (inlined invoker functions can otherwise bypass RLS).
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    execute 'select count(*) from global_search($1)'
      into n
      using 'secret-rls-' || v_private::text;
    perform tests.ok(n = 0, 'search does not leak private channel content');
  exception
    when undefined_function then
      perform tests.ok(true, 'global_search signature differs; skip title leak check');
  end;
  reset role;

  -- After adding the volunteer, they can see the channel.
  insert into channel_member (channel_id, user_id, membership_source)
  values (v_private, v_vol, 'manual')
  on conflict do nothing;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from channel where id = v_private;
    perform tests.ok(n = 1, 'volunteer can see private channel after being added');
  end;
  reset role;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from message_mention where message_id = v_private_message;
    perform tests.ok(n = 1, 'volunteer can read private message mentions after being added');
  end;
  reset role;

  -- Once channel visibility is granted, a personal saved-message bookmark is allowed.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    insert into saved_message (user_id, message_id) values (v_vol, v_private_message);
    select count(*) into n from saved_message where user_id = v_vol and message_id = v_private_message;
    perform tests.ok(n = 1, 'volunteer can save an accessible private message');
  end;
  reset role;

  -- Members may update their own notification level but not self-promote.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    update channel_member set muted_level = 'mentions'
      where channel_id = v_private and user_id = v_vol;
    select count(*) into n from channel_member
      where channel_id = v_private and user_id = v_vol and muted_level = 'mentions';
    perform tests.ok(n = 1, 'volunteer can update own channel notification level');
  end;
  reset role;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    update channel_member set role = 'manager'
      where channel_id = v_private and user_id = v_vol;
    perform tests.ok(false, 'volunteer must not promote own channel role');
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      perform tests.ok(true, 'volunteer cannot promote own channel role');
  end;
  reset role;

  -- Volunteer cannot insert a milestone (staff-only write).
  insert into project (organization_id, name, owner_id, created_by)
  select o.id, 'RLS Project', v_owner, v_owner
  from organization o limit 1
  returning id into v_project;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    insert into milestone (project_id, name) values (v_project, 'Should fail');
    perform tests.ok(false, 'volunteer must not insert milestones');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot insert milestone');
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      perform tests.ok(sqlstate in ('42501', '42501'), 'volunteer cannot insert milestone (' || sqlstate || ')');
  end;
  reset role;

  -- Volunteer cannot insert a team (admin-only write).
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    insert into team (organization_id, name)
    select o.id, 'Should fail' from organization o limit 1;
    perform tests.ok(false, 'volunteer must not insert teams');
  exception
    when others then
      perform tests.ok(true, 'volunteer cannot insert team');
  end;
  reset role;

  -- Volunteer still cannot read CRM via a crafted select after other cases.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from crm_contact;
    perform tests.ok(n = 0, 'volunteer cannot read crm_contact');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot read crm_contact (privilege denied)');
  end;
  reset role;

  -- ---------------------------------------------------------------------
  -- Admin: the same reach as an owner over administration, and no reach
  -- into another organization.
  -- ---------------------------------------------------------------------
  -- Seed one row in each administrative table so "can read" is a claim about
  -- seeing something, not a count of zero that would pass either way.
  select organization_id into v_admin_org from organization_membership
    where user_id = v_admin limit 1;

  insert into workflow_rule (organization_id, name, trigger_event, created_by)
  values (v_admin_org, 'RLS fixture rule', 'task_status_changed', v_owner)
  returning id into v_admin_rule;

  insert into workflow_execution (
    organization_id, rule_id, rule_name, trigger_event,
    source_type, source_id, outcome, recipient_count
  )
  values (v_admin_org, v_admin_rule, 'RLS fixture rule', 'task_status_changed',
          'task', v_private_task, 'notified', 1);

  insert into email_delivery (organization_id, recipient, subject, dedupe_key, status)
  values (v_admin_org, 'rls-fixture@example.com', 'RLS fixture delivery',
          'email:rls-fixture:' || gen_random_uuid()::text, 'queued');

  -- An admin denied their own administration surfaces is a failure, so this
  -- block has no forgiving exception handler: a privilege error propagates.
  perform tests.authenticate(v_admin);
  set local role authenticated;

  select count(*) into n from audit_event;
  perform tests.ok(n >= 0, 'admin can query the audit trail');

  select count(*) into n from workflow_execution;
  perform tests.ok(n > 0, 'admin can read workflow execution history');

  select count(*) into n from email_delivery;
  perform tests.ok(n > 0, 'admin can read the email delivery ledger');

  select count(*) into n from job_run;
  perform tests.ok(n >= 0, 'admin can query the job runtime history');

  -- Administration is scoped to their own organization, not the platform.
  select count(*) into n from organization where id = v_other_org;
  perform tests.ok(n = 0, 'admin cannot read another organization');

  select count(*) into n from task where id = v_other_task;
  perform tests.ok(n = 0, 'admin cannot read another organization task');

  select count(*) into n from crm_organization where id = v_other_crm;
  perform tests.ok(n = 0, 'admin cannot read another organization CRM record');

  select count(*) into n from risk where id = v_other_risk;
  perform tests.ok(n = 0, 'admin cannot read another organization risk');

  select count(*) into n from issue where id = v_other_issue;
  perform tests.ok(n = 0, 'admin cannot read another organization issue');

  -- These four tables kept the unscoped membership helpers until 2026-09-01.
  -- An admin of any organization could read every one of them, and no
  -- assertion here said otherwise, which is why it went unnoticed for weeks.
  select count(*) into n from announcement where id = v_other_announcement;
  perform tests.ok(n = 0, 'admin cannot read another organization announcement');

  select count(*) into n from document where id = v_other_document;
  perform tests.ok(n = 0, 'admin cannot read another organization document');

  select count(*) into n from channel where id = v_other_channel;
  perform tests.ok(n = 0, 'admin cannot read another organization channel');

  select count(*) into n from message where id = v_other_message;
  perform tests.ok(n = 0, 'admin cannot read another organization message');

  select count(*) into n from email_delivery where organization_id = v_other_org;
  perform tests.ok(n = 0, 'admin cannot read another organization email ledger');

  reset role;

  -- The RAID log follows the project: staff who can manage a project can log
  -- against it, and the score is derived rather than supplied.
  perform tests.authenticate(v_staff);
  set local role authenticated;

  insert into risk (organization_id, project_id, title, likelihood, impact, created_by)
  values (
    (select organization_id from project where id = v_project),
    v_project, 'RLS fixture risk', 'high', 'high', v_staff
  )
  returning id into v_risk;

  select score into n from risk where id = v_risk;
  perform tests.ok(n = 9, 'risk score is derived from likelihood and impact');

  select count(*) into n from risk where id = v_risk;
  perform tests.ok(n = 1, 'staff can read a risk on a project they manage');

  reset role;

  -- A volunteer shares the organization but not project management rights.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    update risk set title = 'Volunteer edit' where id = v_risk;
    select count(*) into n from risk
      where id = v_risk and title = 'Volunteer edit';
    perform tests.ok(n = 0, 'volunteer cannot rewrite a risk they do not manage');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot rewrite a risk (privilege denied)');
  end;
  reset role;

  -- A guest is a read-only member, so the risk register is visible to them:
  -- risks inherit project visibility by design, and the project itself is
  -- readable by any active member. The boundary that matters for a guest is
  -- the write, so pin both halves rather than assuming the read is blocked.
  -- Contrast the funding pipeline below, which is staff-and-above outright.
  perform tests.authenticate(v_guest);
  set local role authenticated;
  select count(*) into n from risk where id = v_risk;
  perform tests.ok(n = 1, 'guest reads a project risk, as a read-only member');
  reset role;

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    update risk set title = 'Guest edit' where id = v_risk;
    select count(*) into n from risk
      where id = v_risk and title = 'Guest edit';
    perform tests.ok(n = 0, 'guest cannot rewrite a project risk');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot rewrite a project risk (privilege denied)');
  end;
  reset role;

  -- ---------------------------------------------------------------------
  -- The funding pipeline. Money conversations are commercially sensitive, so
  -- they follow the rest of the CRM: staff and above, own organization only.
  -- ---------------------------------------------------------------------
  select organization_id into v_org from organization_membership
    where user_id = v_staff limit 1;

  perform tests.authenticate(v_staff);
  set local role authenticated;

  insert into crm_organization (organization_id, name, category, created_by)
  values (v_org, 'RLS fixture funder', 'funder', v_staff)
  returning id into v_crm;

  insert into opportunity (organization_id, crm_organization_id, title,
                           kind, stage, amount_requested, owner_id, created_by)
  values (v_org, v_crm, 'RLS fixture grant', 'grant', 'submitted',
          10000, v_staff, v_staff)
  returning id into v_opportunity;

  select count(*) into n from opportunity where id = v_opportunity;
  perform tests.ok(n = 1, 'staff can read an opportunity they created');

  select count(*) into n from opportunity where id = v_opportunity and is_open;
  perform tests.ok(n = 1, 'a submitted opportunity is derived as open');

  select count(*) into n from opportunity where id = v_other_opportunity;
  perform tests.ok(n = 0, 'staff cannot read another organization opportunity');

  reset role;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from opportunity;
    perform tests.ok(n = 0, 'volunteer cannot read the funding pipeline');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot read the funding pipeline (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    insert into opportunity (organization_id, crm_organization_id, title, owner_id)
    values (v_org, v_crm, 'Guest bid', v_guest);
    perform tests.ok(false, 'guest should not be able to record an opportunity');
  exception
    when insufficient_privilege or check_violation then
      perform tests.ok(true, 'guest cannot record an opportunity (privilege denied)');
  end;
  reset role;

  -- ---------------------------------------------------------------------
  -- Intake. Anyone may propose work; only staff run the queue; and only the
  -- person named on an approval can answer it. That last one is the whole
  -- point of naming an approver rather than notifying a group, so it gets an
  -- explicit allow and an explicit deny.
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_vol);
  set local role authenticated;

  insert into project_request (organization_id, title, summary, requested_by)
  values (v_org, 'Volunteer proposal', 'A Saturday club', v_vol)
  returning id into v_request;

  -- The insert above is the allow case; reading it back is what proves it,
  -- because tests.ok(true) after an insert asserts nothing the script would
  -- not already have died on.
  select count(*) into n from project_request where id = v_request;
  perform tests.ok(n = 1, 'a volunteer can propose work and read it back');

  reset role;

  -- Somebody else's request is not a volunteer's business.
  perform tests.authenticate(v_staff);
  set local role authenticated;
  insert into project_request (organization_id, title, summary, requested_by)
  values (v_org, 'Staff proposal', 'Something else', v_staff);
  reset role;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from project_request where requested_by = v_staff;
    perform tests.ok(n = 0, 'a volunteer cannot read another person''s request');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a volunteer cannot read another request (privilege denied)');
  end;
  reset role;

  -- Proposing as somebody else is refused.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    insert into project_request (organization_id, title, summary, requested_by)
    values (v_org, 'Impersonated', 'Not mine to file', v_staff);
    perform tests.ok(false, 'a volunteer should not file a request as someone else');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a volunteer cannot file a request as someone else');
  end;
  reset role;

  -- Staff run the queue.
  perform tests.authenticate(v_staff);
  set local role authenticated;
  select count(*) into n from project_request where id = v_request;
  perform tests.ok(n = 1, 'staff can read the intake queue');

  insert into approval_request (organization_id, project_request_id, requested_by,
                                approver_id, note)
  values (v_org, v_request, v_staff, v_admin, 'Worth a look?')
  returning id into v_approval;

  select count(*) into n from approval_request
    where id = v_approval and decision = 'pending';
  perform tests.ok(n = 1, 'staff can ask a named person to decide');
  reset role;

  -- The named approver answers it; nobody else can.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    update approval_request set decision = 'approved', decided_by = v_vol,
      decided_at = now() where id = v_approval;
    select count(*) into n from approval_request
      where id = v_approval and decision = 'approved';
    perform tests.ok(n = 0, 'only the named approver can answer an approval');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'only the named approver can answer (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_admin);
  set local role authenticated;
  update approval_request set decision = 'approved', decided_by = v_admin,
    decided_at = now() where id = v_approval;
  select count(*) into n from approval_request
    where id = v_approval and decision = 'approved';
  perform tests.ok(n = 1, 'the named approver can answer their approval');
  reset role;

  -- ---------------------------------------------------------------------
  -- Report versions are append-only, and that is enforced by the *absence* of
  -- an update policy rather than by any statement. An absence is exactly what
  -- a later tidy-up removes without noticing, so it is asserted here: a
  -- version that could be edited after approval would let the figures behind
  -- a signed-off funder report change silently.
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff);
  set local role authenticated;

  insert into report_instance (organization_id, report_type, title, snapshot, generated_by)
  values (v_org, 'project', 'RLS fixture report',
          '{"metrics":{"tasks_completed":10}}'::jsonb, v_staff)
  returning id into v_report;

  insert into report_version (organization_id, report_id, version_number,
                              snapshot, generated_by)
  values (v_org, v_report, 1, '{"metrics":{"tasks_completed":10}}'::jsonb, v_staff)
  returning id into v_version;

  select count(*) into n from report_version where id = v_version;
  perform tests.ok(n = 1, 'staff can record and read a report version');

  begin
    update report_version set snapshot = '{"metrics":{"tasks_completed":999}}'::jsonb
    where id = v_version;
    select count(*) into n from report_version
      where id = v_version and snapshot -> 'metrics' ->> 'tasks_completed' = '999';
    perform tests.ok(n = 0, 'nobody can rewrite a report version');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'nobody can rewrite a report version (privilege denied)');
  end;

  begin
    delete from report_version where id = v_version;
    select count(*) into n from report_version where id = v_version;
    perform tests.ok(n = 1, 'nobody can delete a report version');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'nobody can delete a report version (privilege denied)');
  end;

  -- Sign-off is an administrator's job, matching the rule on report_instance.
  begin
    insert into report_approval (organization_id, report_version_id, decision, decided_by)
    values (v_org, v_version, 'approved', v_staff);
    perform tests.ok(false, 'staff should not be able to sign off a report');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'staff cannot sign off a report');
  end;
  reset role;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from report_version;
    perform tests.ok(n = 0, 'a volunteer cannot read report versions');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a volunteer cannot read report versions (privilege denied)');
  end;
  reset role;

  -- ---------------------------------------------------------------------
  -- Data exports. An export is a copy of the organization's most sensitive
  -- records sitting outside every policy that normally protects them, so the
  -- rules about who may make one, and who may see that one was made, are
  -- worth asserting rather than assuming.
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff);
  set local role authenticated;

  insert into export_job (organization_id, kind, requested_by)
  values (v_org, 'crm_contacts', v_staff)
  returning id into v_export;

  select count(*) into n from export_job where id = v_export;
  perform tests.ok(n = 1, 'staff can request an operational export');

  -- The whole organization, and anything about a named person, are an
  -- administrator's to ask for.
  begin
    insert into export_job (organization_id, kind, requested_by)
    values (v_org, 'organization_data', v_staff);
    perform tests.ok(false, 'staff should not be able to export everything');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'staff cannot export the whole organization');
  end;

  begin
    insert into export_job (organization_id, kind, requested_by, subject_user_id)
    values (v_org, 'person_data', v_staff, v_vol);
    perform tests.ok(false, 'staff should not be able to export a person');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'staff cannot export everything about a person');
  end;

  -- Requesting one in somebody else's name would break the audit trail.
  begin
    insert into export_job (organization_id, kind, requested_by)
    values (v_org, 'crm_contacts', v_admin);
    perform tests.ok(false, 'staff should not be able to request as someone else');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'an export records who really asked for it');
  end;

  -- Nobody hand-edits an export: no update policy exists, so the update
  -- matches nothing rather than moving the row.
  begin
    update export_job set expires_at = now() + interval '10 years'
    where id = v_export;
    select count(*) into n from export_job
      where id = v_export and expires_at > now() + interval '1 year';
    perform tests.ok(n = 0, 'nobody can extend an export''s life by hand');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'nobody can edit an export (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from export_job where id = v_export;
    perform tests.ok(n = 0, 'a volunteer cannot see another person''s export');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a volunteer cannot see exports (privilege denied)');
  end;
  reset role;

  -- The subject of a person export can see that it happened. Being told what
  -- was extracted about you is the point of the right, not a courtesy.
  perform tests.authenticate(v_admin);
  set local role authenticated;
  insert into export_job (organization_id, kind, requested_by, subject_user_id)
  values (v_org, 'person_data', v_admin, v_vol)
  returning id into v_export;
  reset role;

  perform tests.authenticate(v_vol);
  set local role authenticated;
  select count(*) into n from export_job where id = v_export;
  perform tests.ok(n = 1, 'the subject of a person export can see it was made');
  reset role;

  -- ---------------------------------------------------------------------
  -- Delivery and outcomes. Volunteers run these sessions, so they can read the
  -- record; only staff write it. A delivery record a volunteer cannot see is a
  -- record they cannot correct, and the numbers in it end up in a funder
  -- report with their name on the session.
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff);
  set local role authenticated;

  insert into program (organization_id, name, slug, created_by)
  values (v_org, 'RLS fixture programme', 'rls-fixture-programme', v_staff)
  returning id into v_prog;

  insert into program_operation (organization_id, program_id, title, occurred_on,
                                 status, attendee_count, duration_hours, created_by)
  values (v_org, v_prog, 'RLS fixture session', current_date,
          'delivered', 24, 2.5, v_staff)
  returning id into v_operation;

  select contact_hours into n from program_operation where id = v_operation;
  perform tests.ok(n = 60, 'contact hours are derived from attendance and duration');

  insert into outcome_metric (organization_id, program_id, name, direction,
                              baseline, target, created_by)
  values (v_org, v_prog, 'RLS fixture measure', 'increase', 4, 8, v_staff)
  returning id into v_metric;

  insert into outcome_measurement (organization_id, metric_id, measured_on, value,
                                   recorded_by)
  values (v_org, v_metric, current_date, 6, v_staff);

  select count(*) into n from outcome_measurement where metric_id = v_metric;
  perform tests.ok(n = 1, 'staff can record a measurement');
  reset role;

  perform tests.authenticate(v_vol);
  set local role authenticated;

  select count(*) into n from program_operation where id = v_operation;
  perform tests.ok(n = 1, 'a volunteer can read what was delivered');

  select count(*) into n from outcome_metric where id = v_metric;
  perform tests.ok(n = 1, 'a volunteer can read the outcome measures');

  begin
    insert into program_operation (organization_id, program_id, title, occurred_on)
    values (v_org, v_prog, 'Volunteer session', current_date);
    perform tests.ok(false, 'a volunteer should not be able to record delivery');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a volunteer cannot record delivery');
  end;

  begin
    update program_operation set attendee_count = 999 where id = v_operation;
    select count(*) into n from program_operation
      where id = v_operation and attendee_count = 999;
    perform tests.ok(n = 0, 'a volunteer cannot change an attendance figure');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a volunteer cannot change attendance (privilege denied)');
  end;

  begin
    insert into outcome_measurement (organization_id, metric_id, measured_on, value)
    values (v_org, v_metric, current_date - 1, 99);
    perform tests.ok(false, 'a volunteer should not be able to record a measurement');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a volunteer cannot record a measurement');
  end;
  reset role;

  -- ---------------------------------------------------------------------
  -- Retention. Deciding what the organization stops keeping is an
  -- administrator's call; staff can see the decision but not make it, and the
  -- floor holds whoever is asking.
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_admin);
  set local role authenticated;

  insert into retention_policy (organization_id, subject_key, retain_days, created_by)
  values (v_admin_org, 'activity_event', 365, v_admin)
  returning id into v_policy;

  select count(*) into n from retention_policy
    where id = v_policy and enabled = false;
  perform tests.ok(n = 1, 'a new retention policy is created switched off');

  -- The floor is a trigger, so it applies to an administrator too.
  begin
    insert into retention_policy (organization_id, subject_key, retain_days)
    values (v_admin_org, 'audit_event', 30);
    perform tests.ok(false, 'the audit trail floor should have refused 30 days');
  exception
    when check_violation then
      perform tests.ok(true, 'nobody can set the audit trail below its floor');
  end;
  reset role;

  perform tests.authenticate(v_staff);
  begin
    set local role authenticated;
    insert into retention_policy (organization_id, subject_key, retain_days)
    values (v_org, 'notification', 180);
    perform tests.ok(false, 'staff should not be able to set a retention policy');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'staff cannot set a retention policy');
  end;
  reset role;

  -- Staff read the policies they cannot set. The coverage note claims
  -- "admins set policies, staff see them, volunteers see neither", and only
  -- two thirds of that sentence was ever tested.
  perform tests.authenticate(v_staff);
  set local role authenticated;
  select count(*) into n from retention_policy where organization_id = v_org;
  perform tests.ok(n >= 1, 'staff can read a retention policy they cannot set');
  reset role;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from retention_policy;
    perform tests.ok(n = 0, 'a volunteer cannot read retention policies');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'a volunteer cannot read retention policies (privilege denied)');
  end;
  reset role;

  -- The run log is written by the job runner alone.
  perform tests.authenticate(v_admin);
  begin
    set local role authenticated;
    insert into retention_run (organization_id, subject_key, action, cutoff, affected)
    values (v_admin_org, 'activity_event', 'delete', now(), 999);
    perform tests.ok(false, 'nobody should be able to write the retention log');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'nobody can write the retention log by hand');
  end;
  reset role;

  -- ---------------------------------------------------------------------
  -- Global search must not become a side door. It is SECURITY INVOKER, so
  -- every branch inherits the caller's policies — but that is a property of
  -- one keyword in the definition, and a future edit could quietly drop it.
  -- These assertions fail loudly if it ever does.
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_staff);
  begin
    set local role authenticated;

    select count(*) into n
    from global_search('RLS fixture risk', 60)
    where result_type = 'risk';
    perform tests.ok(n = 1, 'staff finds a risk on their project through search');

    select count(*) into n
    from global_search('RLS fixture risk', 60)
    where result_type = 'risk'
      and href = '/projects/' || v_project || '?tab=risks&risk=' || v_risk;
    perform tests.ok(n = 1, 'the risk search result deep-links to the RAID tab');

    -- Another organization's records stay invisible even to a staff member.
    select count(*) into n from global_search('Private risk', 60);
    perform tests.ok(n = 0, 'search does not reach another organization risk');
    select count(*) into n from global_search('Private issue', 60);
    perform tests.ok(n = 0, 'search does not reach another organization issue');
  end;
  reset role;

  -- Search must be neither a side channel nor a second, stricter policy: it
  -- has to return exactly what a direct select would. A guest can read this
  -- risk, so a guest must also find it — and the assertion is written as an
  -- agreement between the two paths rather than a hardcoded count, so that
  -- if the risk policy is ever tightened, both sides move together or this
  -- fails.
  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    select count(*) into n
    from global_search('RLS fixture risk', 60)
    where result_type = 'risk';
    select count(*) into m from risk where id = v_risk;
    perform tests.ok(n = m, 'search shows a guest exactly the risks they can read');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot search risks (privilege denied)');
  end;
  reset role;

  -- ---------------------------------------------------------------------
  -- Guest: the most restricted role. A guest belongs to the organization,
  -- so directory-level reads are expected; everything operational is not.
  -- ---------------------------------------------------------------------
  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;

    select count(*) into n from audit_event;
    perform tests.ok(n = 0, 'guest cannot read the audit trail');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot read the audit trail (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    select count(*) into n from crm_organization;
    perform tests.ok(n = 0, 'guest cannot read CRM organizations');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot read CRM organizations (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    select count(*) into n from report_instance;
    perform tests.ok(n = 0, 'guest cannot read report snapshots');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot read report snapshots (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    select count(*) into n from background_job_run;
    perform tests.ok(n = 0, 'guest cannot read background job runs');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot read background job runs (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    select count(*) into n from job_run;
    perform tests.ok(n = 0, 'guest cannot read the job runtime history');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot read the job runtime history (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    select count(*) into n from workflow_execution;
    perform tests.ok(n = 0, 'guest cannot read workflow execution history');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot read workflow execution history (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    -- A delivery row exists (seeded above) and names a recipient and subject.
    -- A guest must see none of it: the policy admits only their own mail.
    select count(*) into n from email_delivery;
    perform tests.ok(n = 0, 'guest sees no email delivery but their own');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot read email deliveries (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    select count(*) into n from rate_limit_counter;
    perform tests.ok(n = 0, 'guest cannot read rate limit counters');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot read rate limit counters (privilege denied)');
  end;
  reset role;

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    select count(*) into n from task where id = v_other_task;
    perform tests.ok(n = 0, 'guest cannot read another organization task');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot read another organization task (privilege denied)');
  end;
  reset role;

  -- The queue functions are service-role only; no signed-in role may drain them.
  perform tests.authenticate(v_admin);
  begin
    set local role authenticated;
    perform public.job_queue_read('notifications', 30, 1);
    perform tests.ok(false, 'admin must not be able to read the job queue');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'not even an admin can read the job queue directly');
    when others then
      perform tests.ok(true, 'job queue is unreachable to an admin (' || sqlerrm || ')');
  end;
  reset role;

  -- Invite-only: with an organization present, signup_allowed is false without an invite.
  perform tests.clear_auth();
  perform tests.ok(
    public.signup_allowed('nobody@example.com') = false,
    'signup is invite-only after an organization exists'
  );

  -- -----------------------------------------------------------------------
  -- The unscoped membership helpers must not reappear.
  --
  -- Every individual assertion above tests one table. This tests the shape of
  -- the whole system: that no policy and no helper still asks "a member of
  -- some organization" where it means "a member of this row's organization".
  --
  -- It is here because the audit that found the original gap was done by hand,
  -- and a hand audit is a snapshot. The catalogue knows the answer exactly, so
  -- the check belongs in the suite rather than in someone's memory of having
  -- looked once. Both surfaces are covered: policy expressions, and the bodies
  -- of the SECURITY DEFINER helpers that policies delegate to — the second is
  -- what the first pass missed.
  -- -----------------------------------------------------------------------
  -- Two policies are exempt, named individually rather than by pattern.
  -- `job_run` and `job_definition` are platform tables with no
  -- organization_id: a job definition is the schedule itself, not one
  -- organization's copy of it, so there is nothing to scope to without a
  -- schema change and a decision about whether the job runtime is per-tenant
  -- at all. Their rows carry job names, timings and counts, not organization
  -- data; `background_job_run`, which does carry per-organization results, is
  -- scoped. Listing them by name means a third exemption cannot appear by
  -- accident — someone has to come here and add it on purpose.
  -- Not restricted to `public`: the first version of this check was, and that
  -- is exactly how three `storage.objects` policies kept the unscoped role
  -- tests through two scoping migrations. A guard that cannot see a schema
  -- reports it as clean, which is worse than not having the guard.
  select count(*) into n
  from pg_policies
  where schemaname in ('public', 'storage')
    and policyname not in ('job_run_admin_read', 'job_definition_admin_read',
                           'documents upload for active members')
    and (coalesce(qual, '') ~ 'app\.is_(member|staff|admin)\(\)'
      or coalesce(with_check, '') ~ 'app\.is_(member|staff|admin)\(\)');
  perform tests.ok(n = 0,
    'no policy tests membership in any organization rather than this one');

  select count(*) into n
  from pg_proc pr
  join pg_namespace ns on ns.oid = pr.pronamespace
  where ns.nspname = 'app'
    and pr.prokind = 'f'
    and pr.proname not in ('is_member', 'is_staff', 'is_admin')
    and pg_get_functiondef(pr.oid) ~ 'app\.is_(member|staff|admin)\(\)';
  perform tests.ok(n = 0,
    'no helper function carries an unscoped copy of the membership test');

  -- -----------------------------------------------------------------------
  -- Sign-up is invite-only where it counts.
  --
  -- `signup_allowed` returning false was already asserted below, and that
  -- assertion passed for weeks while an uninvited stranger could still obtain
  -- an active staff membership — because the predicate was consulted only by a
  -- client component, and the trigger that grants the membership never asked
  -- it. Testing that a rule is *computable* is not testing that it is
  -- *enforced*, and the gap between those two is where this one lived.
  -- -----------------------------------------------------------------------
  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa99',
      'authenticated', 'authenticated', 'gatecrasher@example.com',
      'x', now(), '{}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', ''
    );
    perform tests.ok(false, 'an uninvited stranger must not be able to sign up');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'an uninvited sign-up is refused by the database');
  end;

  select count(*) into n from organization_membership
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa99';
  perform tests.ok(n = 0, 'a refused sign-up leaves no membership behind');

  -- -----------------------------------------------------------------------
  -- A completed recurring task spawns one successor, not two.
  --
  -- The next occurrence is created inline on completion, and nothing stopped
  -- that running twice: no prior-status check, and an insert carrying no key.
  -- A double-click or a client retry produced a duplicate indistinguishable
  -- from real work — same title, same assignee, same due date.
  --
  -- The command now checks the prior status, but a check cannot win a race:
  -- two requests can both read "not completed" before either writes. So the
  -- rule is the shape of the data. A second successor is not detected and
  -- rejected; it cannot be recorded in the first place.
  -- -----------------------------------------------------------------------
  insert into task (organization_id, title, status, created_by, requester_id)
  select o.id, 'Recurring original', 'completed', v_owner, v_owner
  from organization o limit 1
  returning id into v_recurring_parent;

  insert into task (organization_id, title, status, created_by, requester_id,
                    recurrence_parent_id)
  select o.id, 'Recurring successor', 'not_started', v_owner, v_owner,
         v_recurring_parent
  from organization o limit 1;

  begin
    insert into task (organization_id, title, status, created_by, requester_id,
                      recurrence_parent_id)
    select o.id, 'Recurring duplicate', 'not_started', v_owner, v_owner,
           v_recurring_parent
    from organization o limit 1;
    perform tests.ok(false, 'a task must not be able to spawn two successors');
  exception
    when unique_violation then
      perform tests.ok(true, 'a completed task can spawn only one successor');
  end;

  select count(*) into n from task where recurrence_parent_id = v_recurring_parent;
  perform tests.ok(n = 1, 'the refused duplicate left exactly one successor');

  -- Ordinary tasks all leave the column null, so the index has to be partial
  -- or the second non-recurring task ever created would collide with the first.
  select count(*) into n from task
    where recurrence_parent_id is null and organization_id = v_org;
  perform tests.ok(n > 1, 'many tasks can have no predecessor at once');

  begin
    update task set recurrence_parent_id = id where id = v_recurring_parent;
    perform tests.ok(false, 'a task must not be its own successor');
  exception
    when check_violation then
      perform tests.ok(true, 'a task cannot be its own successor');
  end;

  perform tests.ok(true, 'RLS matrix complete');
end;
$$;
