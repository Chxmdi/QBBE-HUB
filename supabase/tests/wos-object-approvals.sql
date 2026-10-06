-- Workspace OS V2-7: approvals on any object through the existing engine.
-- Allow and deny for every role: owner, admin, staff (project manager),
-- member (staff with no grant), volunteer (collaborator on the project),
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
  v_task uuid;
  v_meeting uuid;
  v_decision uuid;
  v_item uuid;
  v_status text;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Object approvals', 'oa-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Object approvals project', v_owner, v_owner)
  returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_staff, 'project_manager', 'direct', v_owner),
         (v_org, v_project, v_volunteer, 'contributor', 'direct', v_owner);
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Order the banners', v_owner, v_volunteer)
  returning id into v_task;
  insert into public.meeting (organization_id, program_id, title, organizer_id, starts_at)
  values (v_org, v_program, 'Board check-in', v_owner, now())
  returning id into v_meeting;
  insert into public.decision (organization_id, project_id, title, decided_by)
  values (v_org, v_project, 'Print locally', v_owner)
  returning id into v_decision;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner);

  -- Staff (project manager) -----------------------------------------------------
  perform tests.authenticate(v_staff);
  v_item := public.request_object_approval('task', v_task, null, 'Budget line 12');
  perform tests.ok(v_item is not null, 'staff: a project manager requests approval of a task');
  select count(*) into n from public.approval_item
  where id = v_item and subject_type = 'other' and subject_id = v_task and title = 'Order the banners' and status = 'pending';
  perform tests.ok(n = 1, 'staff: the request is an ordinary approval item named after the task');
  select count(*) into n from public.approval_step where item_id = v_item;
  perform tests.ok(n >= 1, 'staff: the engine routed it to at least one approver');
  select count(*) into n from public.object_approvals('task', v_task);
  perform tests.ok(n = 1, 'staff: the requester sees the approval on the task');
  failed := false;
  begin
    perform public.request_object_approval('task', v_task);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: one waiting approval per record');
  failed := false;
  begin
    insert into public.object_approval (organization_id, object_type, object_id, approval_item_id, requested_by)
    values (v_org, 'task', v_task, v_item, v_staff);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: the link cannot be written directly');
  failed := false;
  begin
    perform public.request_object_approval('meeting', v_meeting);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a meeting the person does not manage cannot be sent for approval');
  failed := false;
  begin
    perform public.request_object_approval('invoice', v_task);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: unknown record kinds are refused');

  -- Volunteer (contributor on the project) ------------------------------------------
  perform tests.authenticate(v_volunteer);
  select status into v_status from public.object_approvals('task', v_task);
  perform tests.ok(v_status = 'pending', 'volunteer: a reader of the task sees that it waits for approval');
  select count(*) into n from public.object_approval where object_id = v_task;
  perform tests.ok(n = 1, 'volunteer: and can read the link');
  select count(*) into n from public.object_approvals('task', v_task) where can_open;
  perform tests.ok(n = 0, 'volunteer: but cannot open the approval item itself');
  failed := false;
  begin
    perform public.request_object_approval('decision', v_decision);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'volunteer: a non-manager cannot send a decision for approval');

  -- Member (staff with no grant) --------------------------------------------------
  perform tests.authenticate(v_member);
  select count(*) into n from public.object_approvals('task', v_task);
  perform tests.ok(n = 0, 'member: someone outside the project sees nothing');
  select count(*) into n from public.object_approval;
  perform tests.ok(n = 0, 'member: nor the link');
  failed := false;
  begin
    perform public.request_object_approval('task', v_task);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'member: cannot request approval of a task they cannot change');

  -- Accountant --------------------------------------------------------------------
  perform tests.authenticate(v_accountant);
  select count(*) into n from public.object_approvals('task', v_task);
  perform tests.ok(n = 0, 'accountant: ledger access does not reach object approvals');
  failed := false;
  begin
    perform public.request_object_approval('project', v_project);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'accountant: cannot request approvals');

  -- Signed out ----------------------------------------------------------------------
  perform tests.clear_auth();
  failed := false;
  begin
    perform public.object_approvals('task', v_task);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'signed out: statuses cannot be read');
  failed := false;
  begin
    perform public.request_object_approval('task', v_task);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'signed out: cannot request approvals');
  reset role;

  -- Admin decides through the ordinary engine; readers see the outcome --------------
  perform tests.authenticate(v_admin);
  perform public.decide_approval(v_item, 'approve', null);
  perform tests.authenticate(v_volunteer);
  select status into v_status from public.object_approvals('task', v_task);
  perform tests.ok(v_status = 'approved', 'admin: an administrator approves, and task readers see it approved');

  perform tests.authenticate(v_admin, 'aal1');
  failed := false;
  begin
    perform public.request_object_approval('meeting', v_meeting);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'admin: without two-step sign-in an administrator cannot request');

  -- Owner: a meeting and a decision -----------------------------------------------------
  perform tests.authenticate(v_owner);
  v_item := public.request_object_approval('meeting', v_meeting, 'Approve the check-in minutes');
  select count(*) into n from public.object_approvals('meeting', v_meeting) where title = 'Approve the check-in minutes';
  perform tests.ok(n = 1, 'owner: the owner sends a meeting for approval under a custom title');
  v_item := public.request_object_approval('decision', v_decision);
  select count(*) into n from public.object_approvals('decision', v_decision);
  perform tests.ok(n = 1, 'owner: and a decision');
  perform tests.authenticate(v_staff);
  select count(*) into n from public.object_approvals('decision', v_decision);
  perform tests.ok(n = 1, 'staff: a project reader sees the decision''s approval');

  reset role;
end;
$$;

rollback;
