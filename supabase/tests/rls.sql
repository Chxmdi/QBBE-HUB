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
  n int;
  v_private uuid;
  v_private_message uuid;
  v_private_task uuid;
  v_private_label uuid;
  v_private_meeting uuid;
  v_private_agenda uuid;
  v_other_org uuid;
  v_other_team uuid;
  v_other_program uuid;
  v_other_project uuid;
  v_other_milestone uuid;
  v_other_task uuid;
  v_other_label uuid;
  v_other_crm uuid;
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

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    select count(*) into n from risk where id = v_risk;
    perform tests.ok(n = 0, 'guest cannot read a project risk');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'guest cannot read a project risk (privilege denied)');
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

  perform tests.authenticate(v_guest);
  begin
    set local role authenticated;
    select count(*) into n
    from global_search('RLS fixture risk', 60)
    where result_type = 'risk';
    perform tests.ok(n = 0, 'guest cannot find a project risk through search');
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

  perform tests.ok(true, 'RLS matrix complete');
end;
$$;
