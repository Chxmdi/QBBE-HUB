-- Writes that would change who did something, who owns something, or where it
-- belongs are refused. Reads are covered table by table elsewhere; this file
-- is about INSERT and UPDATE: each case runs as the lowest role that can write
-- the table at all and tries to change an attribution, owner, scope or
-- approval column. Run after qa-users.sql and rls.sql. Rolled back.
--
-- A case that main does not refuse yet is reported as "TODO <finding>" rather
-- than failing the suite, so the file can land before the fixes. When the fix
-- for a finding lands, its case starts printing PASS; then change its
-- tests.gap call to tests.refused_ok so it can never quietly reopen. The
-- "fixture:" checks make sure each actor can see (and ordinarily write) the
-- rows its cases aim at, so a refusal is the rule under test and not a hidden
-- row. The helpers are defined in rls.sql.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_pm uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_other_project uuid;
  v_task uuid;
  v_contact uuid;
  v_crm_org uuid;
  v_general uuid;
  v_announcements uuid;
  v_message uuid;
  v_staff_channel uuid;
  v_conversation uuid;
  v_private_conversation uuid;
  v_report uuid;
  v_request uuid;
begin
  select organization_id into strict v_org
  from organization_membership m
  where m.user_id = v_owner
    and exists (select 1 from organization_membership p where p.organization_id = m.organization_id and p.user_id = v_guest)
    and exists (select 1 from organization_membership p where p.organization_id = m.organization_id and p.user_id = v_pm);

  -- Fixtures, written as the database owner.
  insert into program (organization_id, name, slug, created_by)
  values (v_org, 'Tamper program', 'tamper-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Tamper project', v_owner, v_owner) returning id into v_project;
  insert into project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Tamper other project', v_owner, v_owner) returning id into v_other_project;
  insert into project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_pm, 'project_manager', 'direct', v_owner);

  insert into task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Tamper task', v_owner) returning id into v_task;
  insert into task_assignment (task_id, user_id, role) values (v_task, v_volunteer, 'contributor');

  insert into crm_contact (organization_id, full_name, owner_id)
  values (v_org, 'Tamper contact', v_owner) returning id into v_contact;
  insert into crm_organization (organization_id, name, owner_id, next_action_at)
  values (v_org, 'Tamper organization', v_owner, now() + interval '7 days') returning id into v_crm_org;

  select id into strict v_general from channel
  where organization_id = v_org and type <> 'announcements' and is_mandatory and posting_policy <> 'admins'
  order by created_at limit 1;
  select id into strict v_announcements from channel
  where organization_id = v_org and type = 'announcements' and is_mandatory limit 1;
  insert into message (organization_id, channel_id, author_id, body)
  values (v_org, v_general, v_guest, 'Tamper message') returning id into v_message;
  insert into channel (organization_id, name, slug, type, owner_id)
  values (v_org, 'Tamper staff channel', 'tamper-staff-' || substr(gen_random_uuid()::text, 1, 8), 'custom', v_staff)
  returning id into v_staff_channel;

  insert into conversation (organization_id, is_group, created_by) values (v_org, true, v_guest)
  returning id into v_conversation;
  insert into conversation_member (conversation_id, user_id) values (v_conversation, v_guest);
  insert into conversation (organization_id, is_group, created_by) values (v_org, false, v_owner)
  returning id into v_private_conversation;
  insert into conversation_member (conversation_id, user_id) values (v_private_conversation, v_owner), (v_private_conversation, v_staff);

  insert into report_instance (organization_id, report_type, title, project_id, generated_by)
  values (v_org, 'project_status', 'Tamper report', v_project, v_pm) returning id into v_report;

  insert into notification (user_id, organization_id, category, title)
  values (v_guest, v_org, 'mention', 'Tamper guest notice'), (v_owner, v_org, 'mention', 'Tamper owner notice');

  -- Guest: the lowest role that can write anything.
  perform tests.authenticate(v_guest, 'aal1');
  -- Each actor must see the rows its cases aim at; otherwise a refusal could
  -- only mean the fixture is broken (the target hidden), not that a rule held.
  perform tests.ok((select count(*) from message where id = v_message and author_id = v_guest) = 1,
    'fixture: the guest sees their own message');
  perform tests.ok((select count(*) from conversation_member where conversation_id = v_conversation and user_id = v_guest) = 1,
    'fixture: the guest sees their own conversation membership');
  perform tests.ok((select count(*) from notification where user_id = v_guest) >= 1,
    'fixture: the guest sees their own notification');
  perform tests.ok((select count(*) from message where author_id <> v_guest) >= 1,
    'fixture: the guest sees messages by other people');

  perform tests.gap(format(
    $q$insert into notification (user_id, organization_id, category, title, link)
       values (%L, %L, 'security', 'Tamper', '/x')$q$, v_owner, v_org),
    'SEC-004', 'a guest cannot create a notification for someone else');
  perform tests.gap(format(
    $q$insert into audit_event (organization_id, actor_id, actor_type, event_type, action, result)
       values (%L, %L, 'user', 'data_export', 'export_downloaded', 'success')$q$, v_org, v_owner),
    'SEC-005', 'a guest cannot write an audit event under someone else''s name');
  perform tests.gap(format(
    $q$insert into activity_event (organization_id, actor_id, verb, source_type, source_id, summary)
       values (%L, %L, 'updated', 'task', %L, 'Tamper')$q$, v_org, v_owner, v_task),
    'SEC-005', 'a guest cannot write an activity entry under someone else''s name');
  perform tests.gap(format(
    $q$insert into api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
       values (%L, %L, 'Tamper', encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'qbt_tamp', '{objects:read}', now() + interval '30 days')$q$,
    v_org, v_guest),
    'SEC-018', 'a guest cannot create an API key directly');

  -- Their own chat message stays where it was posted, as what it was.
  perform tests.gap(format('update message set channel_id = %L where id = %L', v_announcements, v_message),
    'SEC-009', 'a message''s author cannot move it to another channel');
  perform tests.gap(format('update message set is_system = true where id = %L', v_message),
    'SEC-009', 'a message''s author cannot mark it as a system message');
  perform tests.gap(format($q$update message set created_at = '2020-01-01' where id = %L$q$, v_message),
    'SEC-009', 'a message''s author cannot backdate it');
  perform tests.refused_ok(format('update message set author_id = %L where id = %L', v_owner, v_message),
    'a message''s author cannot hand it to someone else');

  -- Membership of a conversation is not movable to someone else's.
  perform tests.gap(format('update conversation_member set conversation_id = %L where conversation_id = %L',
      v_private_conversation, v_conversation),
    'TEST-003', 'a member cannot move their membership into another conversation');
  perform tests.refused_ok(format('update conversation_member set user_id = %L where conversation_id = %L',
      v_owner, v_conversation),
    'a member cannot hand their membership to someone else');

  -- Their own profile cannot claim another person's volunteer record.
  perform tests.gap(format($q$update user_profile set vms_id = 'tamper-vms-id' where id = %L$q$, v_guest),
    'TEST-003', 'a person cannot set the volunteer-system link on their own profile');

  -- Unfiltered: an update with no WHERE touches nobody else's rows.
  perform tests.refused_ok(format('update notification set user_id = %L', v_owner),
    'an unfiltered update cannot hand one''s notifications to someone else');
  perform tests.refused_ok(format('update notification set read_at = now() where user_id <> %L', v_guest),
    'an unfiltered update cannot touch other people''s notifications');
  perform tests.refused_ok(format('update message set body = %L where author_id <> %L', 'Tamper', v_guest),
    'an unfiltered update cannot rewrite other people''s messages');

  -- Volunteer contributor on a task.
  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.ok((select count(*) from task where id = v_task) = 1, 'fixture: the contributor sees the task');
  perform tests.ok(not tests.refused(format($q$update task set title = 'Tamper task renamed' where id = %L$q$, v_task)),
    'fixture: the contributor may work on the task');
  perform tests.gap(format('update task set approver_id = %L where id = %L', v_volunteer, v_task),
    'TEST-003', 'a contributor cannot make themselves the task''s approver');
  perform tests.refused_ok(format('update task set project_id = %L where id = %L', v_other_project, v_task),
    'a contributor cannot move the task to another project');
  perform tests.refused_ok(format('update task set created_by = %L where id = %L', v_volunteer, v_task),
    'a contributor cannot rewrite who created the task');

  -- Staff.
  perform tests.authenticate(v_staff, 'aal2');
  perform tests.ok((select count(*) from crm_contact where id = v_contact) = 1, 'fixture: staff see the CRM contact');
  perform tests.ok((select count(*) from crm_organization where id = v_crm_org) = 1, 'fixture: staff see the CRM organization');
  perform tests.ok((select count(*) from channel where id = v_staff_channel and owner_id = v_staff) = 1, 'fixture: staff see their own channel');
  perform tests.gap(format('update crm_contact set owner_id = %L where id = %L', v_staff, v_contact),
    'SEC-007', 'staff cannot make themselves owner of someone else''s CRM contact');
  perform tests.gap(format('update crm_organization set owner_id = %L where id = %L', v_staff, v_crm_org),
    'SEC-007', 'staff cannot make themselves owner of someone else''s CRM organization');
  perform tests.gap(format('update crm_contact set owner_id = %L where owner_id is distinct from %L', v_staff, v_staff),
    'SEC-007', 'an unfiltered update cannot take over every CRM contact');
  perform tests.gap(format($q$update channel set type = 'announcements', is_mandatory = true where id = %L$q$, v_staff_channel),
    'SEC-015', 'a channel''s owner cannot turn it into a mandatory announcements channel');
  perform tests.gap(format(
    $q$insert into approval_request (organization_id, report_id, requested_by, approver_id, note)
       values (%L, %L, %L, %L, 'Tamper')$q$, v_org, v_report, v_staff, v_staff),
    'TEST-003', 'staff cannot name themselves the approver of their own request');

  -- Project manager on one project, with a report on it.
  perform tests.authenticate(v_pm, 'aal1');
  perform tests.ok((select count(*) from report_instance where id = v_report) = 1, 'fixture: the project manager sees the report');
  perform tests.ok(not tests.refused(format($q$update report_instance set title = 'Tamper report renamed' where id = %L$q$, v_report)),
    'fixture: the project manager may edit the report');
  perform tests.gap(format('update report_instance set project_id = %L where id = %L', v_other_project, v_report),
    'TEST-003', 'a project manager cannot move a report to a project they do not manage');
  perform tests.gap(format('update report_instance set generated_by = %L where id = %L', v_owner, v_report),
    'TEST-003', 'a project manager cannot rewrite who generated a report');
  perform tests.gap(format('update report_instance set approved_by = %L, approved_at = now() where id = %L', v_owner, v_report),
    'TEST-003', 'a project manager cannot record someone else''s approval of a report');

  perform tests.clear_auth();
end;
$$;

rollback;
