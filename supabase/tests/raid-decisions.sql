-- RAID decisions (#36): a risk trigger, an issue's impact and plan, and a
-- decision request that only a project manager can send to someone who can
-- already read the project.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_risk uuid;
  v_request uuid;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'RAID program', 'raid-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;

  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'RAID project', v_owner, v_owner)
  returning id into v_project;

  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, created_by
  ) values (v_org, v_project, v_staff, 'project_manager', 'direct', v_owner);

  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, created_by
  ) values (v_org, v_project, v_volunteer, 'read_only', 'direct', v_owner);

  perform tests.authenticate(v_staff);

  insert into public.risk (
    organization_id, project_id, title, trigger, likelihood, impact, created_by
  ) values (
    v_org, v_project, 'Venue falls through', 'The hall cancels inside two weeks', 'medium', 'high', v_staff
  ) returning id into v_risk;
  perform tests.ok(v_risk is not null, 'a project manager can record a risk trigger');

  insert into public.issue (
    organization_id, project_id, title, impact, resolution_plan, created_by
  ) values (
    v_org, v_project, 'The printer failed', 'Packets cannot be printed', 'Borrow the school copier', v_staff
  );
  select count(*) into n from public.issue
  where project_id = v_project and impact = 'Packets cannot be printed';
  perform tests.ok(n = 1, 'an open issue can record impact and a resolution plan');

  insert into public.decision (
    organization_id, project_id, title, detail, alternatives, affected_records, reopen_conditions, decided_by
  ) values (
    v_org, v_project, 'Hold the event indoors', 'Rain is forecast', 'Postpone',
    '["Saturday session"]'::jsonb, 'A dry forecast by Thursday', v_staff
  );
  select count(*) into n from public.decision
  where project_id = v_project and title = 'Hold the event indoors';
  perform tests.ok(n = 1, 'a project manager can record a decision with rationale and reopen conditions');

  failed := false;
  begin
    insert into public.decision_request (
      organization_id, project_id, requester_id, assignee_id, due_at, context
    ) values (
      v_org, v_project, v_staff, v_guest, current_date + 3, 'Should we cancel?'
    );
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a decision cannot be requested from someone who cannot read the project');

  insert into public.decision_request (
    organization_id, project_id, requester_id, assignee_id, due_at, context
  ) values (
    v_org, v_project, v_staff, v_volunteer, current_date + 3, 'Which room do we use?'
  ) returning id into v_request;
  perform tests.ok(v_request is not null, 'a project manager can request a decision from a reader');

  perform tests.authenticate(v_volunteer);
  failed := false;
  begin
    insert into public.decision_request (
      organization_id, project_id, requester_id, assignee_id, due_at, context
    ) values (
      v_org, v_project, v_volunteer, v_staff, current_date + 1, 'A reader cannot ask'
    );
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a read-only member cannot request a decision');

  update public.decision_request set status = 'declined' where id = v_request;
  select count(*) into n from public.decision_request
  where id = v_request and status = 'declined';
  perform tests.ok(n = 1, 'the person asked can decline the request');

  perform tests.authenticate(v_guest);
  select count(*) into n from public.decision_request where id = v_request;
  perform tests.ok(n = 0, 'someone outside the project cannot see the request');

  reset role;
end;
$$;

rollback;
