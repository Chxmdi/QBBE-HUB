-- A project manager cannot move a report to a project they do not manage,
-- by the update policy alone (the scope trigger is dropped for this test),
-- and can still edit the report where it is.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  pm_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
  org uuid;
  v_program uuid;
  v_project uuid;
  v_other uuid;
  v_report uuid;
  refused boolean;
  n int;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  drop trigger if exists report_instance_forbid_scope_move on public.report_instance;
  insert into public.program (organization_id, name, slug, created_by)
  values (org, 'RMP program', 'rmp-' || substr(md5(random()::text), 1, 8), owner_user) returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (org, v_program, 'RMP project', owner_user, owner_user) returning id into v_project;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (org, v_program, 'RMP other project', owner_user, owner_user) returning id into v_other;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (org, v_project, pm_user, 'project_manager', 'direct', owner_user);
  insert into public.report_instance (organization_id, report_type, title, project_id, period_start, period_end, snapshot, generated_by)
  values (org, 'project', 'RMP report', v_project, current_date, current_date, '{}', owner_user) returning id into v_report;
  insert into public.report_instance (organization_id, report_type, title, project_id, program_id, period_start, period_end, snapshot, generated_by)
  values (org, 'project', 'RMP both', v_project, v_program, current_date, current_date, '{}', owner_user);

  perform tests.authenticate(pm_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    update public.report_instance set project_id = v_other where id = v_report;
    get diagnostics n = row_count;
    refused := n = 0;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a project manager cannot move a report to a project they do not manage (policy)');
  update public.report_instance set title = 'RMP report renamed' where id = v_report;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a project manager can still edit the report');
  update public.report_instance set title = 'RMP both renamed' where title = 'RMP both';
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a project manager can still edit a report on their project and its program');
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
