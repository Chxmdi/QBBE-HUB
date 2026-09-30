-- Workspace OS V1-10: the full decision record, participants and the revisit
-- bookkeeping. Allow and deny for every role: owner, admin, staff (project
-- manager), member (staff with no grant), volunteer (read-only on the
-- project), accountant (a guest with ledger access only) and signed out.
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
  v_decision uuid;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Decisions v2', 'dv2-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Decisions v2 project', v_owner, v_owner)
  returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_staff, 'project_manager', 'direct', v_owner),
         (v_org, v_project, v_volunteer, 'read_only', 'direct', v_owner);
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner);

  -- Staff (project manager) --------------------------------------------------
  perform tests.authenticate(v_staff);
  insert into public.decision (
    organization_id, project_id, title, decided_by, problem, options_considered,
    evidence, reasoning, revisit_on
  ) values (
    v_org, v_project, 'Move the workshop online', v_staff, 'The hall is too small',
    '["Rent a bigger hall", "Split into two sessions", "Move online"]'::jsonb,
    'Registrations doubled', 'Online costs nothing and fits everyone', current_date + 30
  ) returning id into v_decision;
  perform tests.ok(v_decision is not null, 'staff: a project manager records a decision with the full record');

  failed := false;
  begin
    update public.decision set options_considered = '[1, 2]'::jsonb where id = v_decision;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: options considered must be text');

  insert into public.decision_participant (decision_id, user_id) values (v_decision, v_volunteer);
  select count(*) into n from public.decision_participant where decision_id = v_decision;
  perform tests.ok(n = 1, 'staff: a project manager adds a participant');

  failed := false;
  begin
    insert into public.decision_participant (decision_id, user_id)
    values (v_decision, gen_random_uuid());
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a participant must be a member of the organization');

  failed := false;
  begin
    insert into public.decision_participant (decision_id, user_id) values (v_decision, v_member);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff: a participant must already be able to read the decision');

  -- The revisit marker resets when the date moves.
  reset role;
  update public.decision set revisit_reminded_at = now() where id = v_decision;
  perform tests.authenticate(v_staff);
  update public.decision set revisit_on = current_date + 60 where id = v_decision;
  select count(*) into n from public.decision where id = v_decision and revisit_reminded_at is null;
  perform tests.ok(n = 1, 'staff: moving the revisit date re-arms the reminder');
  perform tests.ok(public.can_manage_decision(v_decision), 'staff: the helper agrees a project manager manages it');

  -- Volunteer (read-only on the project) ---------------------------------------
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.decision where id = v_decision and problem = 'The hall is too small';
  perform tests.ok(n = 1, 'volunteer: a reader of the project reads the full record');
  select count(*) into n from public.decision_participant where decision_id = v_decision;
  perform tests.ok(n = 1, 'volunteer: a reader sees the participants');
  update public.decision set reasoning = 'Changed by a reader' where id = v_decision;
  reset role;
  select count(*) into n from public.decision where id = v_decision and reasoning = 'Changed by a reader';
  perform tests.ok(n = 0, 'volunteer: a reader cannot change the decision');
  perform tests.authenticate(v_volunteer);
  failed := false;
  begin
    insert into public.decision_participant (decision_id, user_id) values (v_decision, v_member);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'volunteer: a reader cannot add participants');
  perform tests.ok(not public.can_manage_decision(v_decision), 'volunteer: the helper agrees a reader does not manage it');

  -- Member (staff with no grant) ---------------------------------------------
  perform tests.authenticate(v_member);
  select count(*) into n from public.decision where id = v_decision;
  perform tests.ok(n = 0, 'member: a member outside the project cannot read the decision');
  select count(*) into n from public.decision_participant where decision_id = v_decision;
  perform tests.ok(n = 0, 'member: nor its participants');
  delete from public.decision_participant where decision_id = v_decision;
  reset role;
  select count(*) into n from public.decision_participant where decision_id = v_decision;
  perform tests.ok(n = 1, 'member: a member outside the project cannot remove participants');

  -- Accountant -------------------------------------------------------------
  perform tests.authenticate(v_accountant);
  select count(*) into n from public.decision where id = v_decision;
  perform tests.ok(n = 0, 'accountant: ledger access does not reach decisions');
  failed := false;
  begin
    insert into public.decision_participant (decision_id, user_id) values (v_decision, v_accountant);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'accountant: cannot add participants');

  -- Signed out ---------------------------------------------------------------
  perform tests.clear_auth();
  failed := false;
  begin
    select count(*) into n from public.decision_participant;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'signed out: participants cannot be read');
  failed := false;
  begin
    perform public.can_manage_decision(v_decision);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'signed out: the helper is not callable');
  reset role;

  -- Admin and owner ------------------------------------------------------------
  perform tests.authenticate(v_admin);
  delete from public.decision_participant where decision_id = v_decision and user_id = v_volunteer;
  select count(*) into n from public.decision_participant where decision_id = v_decision;
  perform tests.ok(n = 0, 'admin: an administrator removes a participant');
  perform tests.authenticate(v_admin, 'aal1');
  failed := false;
  begin
    insert into public.decision_participant (decision_id, user_id) values (v_decision, v_staff);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'admin: without two-step sign-in an administrator cannot add participants');

  perform tests.authenticate(v_owner);
  insert into public.decision_participant (decision_id, user_id) values (v_decision, v_staff);
  update public.decision set evidence = 'Registrations tripled' where id = v_decision;
  select count(*) into n from public.decision where id = v_decision and evidence = 'Registrations tripled';
  perform tests.ok(n = 1, 'owner: the owner edits the record and adds participants');

  reset role;
  perform tests.ok(public.decision_readable_by(v_decision, v_volunteer), 'job: a project reader can be reminded');
  perform tests.ok(not public.decision_readable_by(v_decision, v_member), 'job: someone outside the project is never reminded');
  perform tests.ok(not public.decision_readable_by(v_decision, v_accountant), 'job: nor is the accountant');
end;
$$;

rollback;
