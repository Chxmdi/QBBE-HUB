-- Approvals are made by the person they name, when they make them: intake
-- requests and approval requests cannot be created already decided, the
-- requester cannot approve their own request, a decision is recorded as made
-- by whoever made it, and a settled decision stays settled. Report approval
-- fields and figures change only through the report functions. A meeting
-- attendee's agenda item waits for the organizer's triage.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  volunteer_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  guest_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  lead_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  org uuid;
  v_project uuid;
  v_request uuid;
  v_approval uuid;
  v_report uuid;
  v_version uuid;
  v_meeting uuid;
  v_item uuid;
  refused boolean;
  n int;
  r record;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  perform tests.ensure_verified_mfa_factor(admin_user);
  insert into public.project (organization_id, name, owner_id, created_by)
  values (org, 'ARI project', staff_user, owner_user) returning id into v_project;

  -- Intake requests.
  perform tests.authenticate(guest_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    insert into public.project_request (organization_id, title, summary, requested_by, status, decided_by, decided_at, project_id)
    values (org, 'ARI forged', 'x', guest_user, 'approved', owner_user, now(), v_project);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a request cannot be created already approved');
  insert into public.project_request (organization_id, title, summary, requested_by)
  values (org, 'ARI guest idea', 'x', guest_user) returning id into v_request;
  perform tests.ok(v_request is not null, 'a member can still submit a request');

  reset role;
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  insert into public.project_request (organization_id, title, summary, requested_by)
  values (org, 'ARI staff idea', 'x', staff_user) returning id into v_request;
  refused := false;
  begin
    update public.project_request set status = 'deferred', decision_note = 'later',
      decided_by = owner_user, decided_at = now() - interval '30 days'
    where id = v_request;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a requester cannot decide their own request');

  -- Approval requests.
  refused := false;
  begin
    insert into public.approval_request (organization_id, project_request_id, requested_by, approver_id)
    values (org, v_request, staff_user, staff_user);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a requester cannot name themselves approver');
  refused := false;
  begin
    insert into public.approval_request (organization_id, project_request_id, requested_by, approver_id, decision, decided_by, decided_at)
    values (org, v_request, staff_user, owner_user, 'approved', owner_user, now());
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an approval request cannot be created already decided');
  insert into public.approval_request (organization_id, project_request_id, requested_by, approver_id)
  values (org, v_request, staff_user, volunteer_user) returning id into v_approval;

  reset role;
  perform tests.authenticate(volunteer_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    update public.approval_request set approver_id = guest_user where id = v_approval;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'the approver cannot hand the approval to someone else');
  update public.approval_request
  set decision = 'approved', decided_by = owner_user, decided_at = now() - interval '30 days'
  where id = v_approval;
  reset role;
  select decision::text as decision, decided_by, decided_at into r from public.approval_request where id = v_approval;
  perform tests.ok(r.decision = 'approved' and r.decided_by = volunteer_user and r.decided_at > now() - interval '1 minute',
    'a decision is recorded as made by its approver, now');
  perform tests.authenticate(volunteer_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    update public.approval_request set decision = 'rejected' where id = v_approval;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a settled decision cannot be flipped');
  refused := false;
  begin
    update public.approval_request set decision_note = 'Fine actually' where id = v_approval;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a settled decision cannot be reworded');

  -- Someone else declines the staff member's request; the requester cannot
  -- reword, re-attribute or reopen it.
  reset role;
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  update public.project_request set status = 'declined', decision_note = 'Not this year.',
    decided_by = admin_user, decided_at = now()
  where id = v_request;
  reset role;
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    update public.project_request set decision_note = 'Approved really' where id = v_request;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a requester cannot reword the decision on their request');
  refused := false;
  begin
    update public.project_request set status = 'submitted', decided_by = null, decided_at = null where id = v_request;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a requester cannot reopen a declined request');
  reset role;
  perform tests.authenticate(lead_user, 'aal1');
  set local role authenticated;
  update public.project_request set decision_note = 'Not this year, maybe next.' where id = v_request;
  reset role;
  select decided_by into r from public.project_request where id = v_request;
  perform tests.ok(r.decided_by = lead_user, 'whoever rewords a decision is recorded as its decider');

  -- Versions go through record_report_version.
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    insert into public.report_version (organization_id, report_id, version_number, snapshot, generated_by)
    values (org, v_report, 1000000, '{}'::jsonb, staff_user);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a report version cannot be written directly');

  -- Reports.
  reset role;
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  insert into public.report_instance (organization_id, report_type, title, project_id, period_start, period_end,
                                      snapshot, status, generated_by, approved_by, approved_at)
  values (org, 'project', 'ARI report', v_project, current_date, current_date,
          '{"tasks":{"completed":999}}', 'approved', staff_user, owner_user, now())
  returning id into v_report;
  reset role;
  select status::text as status, approved_by into r from public.report_instance where id = v_report;
  perform tests.ok(r.status = 'draft' and r.approved_by is null, 'a report cannot be created already approved');

  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  v_version := public.record_report_version(v_report, '{"tasks":{"completed":3}}', null);
  perform tests.ok(v_version is not null, 'a report manager records a version');
  refused := false;
  begin
    update public.report_instance set status = 'approved', approved_by = owner_user, approved_at = now() where id = v_report;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a report manager cannot mark their report approved');
  refused := false;
  begin
    perform public.decide_report_version(v_version, 'approved', null);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a report manager cannot approve through the decision function');

  reset role;
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  perform public.decide_report_version(v_version, 'approved', 'ok');
  reset role;
  select status::text as status, approved_by into r from public.report_instance where id = v_report;
  perform tests.ok(r.status = 'approved' and r.approved_by = admin_user, 'an administrator with MFA approves the report');

  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    update public.report_instance set snapshot = '{"tasks":{"completed":300}}' where id = v_report;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'the figures of an approved report cannot be changed directly');

  -- Agenda triage.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.meeting (organization_id, title, starts_at, organizer_id)
  values (org, 'ARI meeting', now() + interval '1 day', owner_user) returning id into v_meeting;
  insert into public.meeting_attendee (meeting_id, user_id) values (v_meeting, volunteer_user)
  on conflict do nothing;
  perform tests.authenticate(volunteer_user, 'aal1');
  set local role authenticated;
  insert into public.agenda_item (meeting_id, title, status, proposed_by)
  values (v_meeting, 'ARI item', 'accepted', volunteer_user) returning id into v_item;
  reset role;
  select status::text as status into r from public.agenda_item where id = v_item;
  perform tests.ok(r.status = 'proposed', 'an attendee''s agenda item waits for the organizer''s triage');
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
