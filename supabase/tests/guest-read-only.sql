-- "Read-only guest" means read-only: a guest's project or program grant,
-- whatever role it names, lets them read and follow, never manage,
-- collaborate, review or approve. Administrators cannot give a guest more.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  guest_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  org uuid;
  v_program uuid;
  v_project uuid;
  v_task uuid;
  v_personal uuid;
  n int;
  refused boolean;
  cap text;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  perform tests.ensure_verified_mfa_factor(admin_user);
  insert into public.program (organization_id, name, slug, created_by)
  values (org, 'GRO program', 'gro-program-' || substr(md5(random()::text), 1, 6), owner_user) returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (org, v_program, 'GRO project', owner_user, owner_user) returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (org, v_project, guest_user, 'project_manager', 'direct', owner_user);
  insert into public.program_access_grant (organization_id, program_id, user_id, role, source, created_by)
  values (org, v_program, guest_user, 'manager', 'direct', owner_user);
  insert into public.task (organization_id, project_id, title, assignee_id, created_by)
  values (org, v_project, 'GRO task', guest_user, owner_user) returning id into v_task;
  insert into public.task (organization_id, title, created_by)
  values (org, 'GRO personal', guest_user) returning id into v_personal;

  perform tests.authenticate(guest_user, 'aal1');
  set local role authenticated;
  perform tests.ok(public.has_project_capability(v_project, 'read'), 'a guest with a project grant can read the project');
  foreach cap in array array['manage', 'collaborate', 'review', 'approve'] loop
    perform tests.ok(not public.has_project_capability(v_project, cap), format('a guest with a project manager grant cannot %s the project', cap));
    perform tests.ok(not public.has_program_capability(v_program, cap), format('a guest with a program manager grant cannot %s the program', cap));
    perform tests.ok(not public.has_task_capability(v_task, cap), format('a guest assigned a project task cannot %s it', cap));
  end loop;
  update public.project set name = 'GRO renamed' where id = v_project;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a guest cannot rename the project');
  refused := false;
  begin
    update public.task set status = 'completed' where id = v_task;
    get diagnostics n = row_count;
    refused := n = 0;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a guest cannot change a project task');
  update public.task set title = 'GRO personal (edited)' where id = v_personal;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a guest still manages their own personal task');

  -- Owning a document or organizing a meeting gives a guest no edit rights.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.document (organization_id, title, kind, url, project_id, owner_id, created_by)
  values (org, 'GRO guest doc', 'link', 'https://drive.google.com/gro', v_project, guest_user, guest_user);
  insert into public.meeting (organization_id, title, starts_at, organizer_id, project_id)
  values (org, 'GRO guest meeting', now() + interval '1 day', guest_user, v_project);
  perform tests.authenticate(guest_user, 'aal1');
  set local role authenticated;
  update public.document set title = 'GRO edited' where title = 'GRO guest doc';
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a guest cannot edit a project document they own');
  update public.meeting set title = 'GRO edited' where title = 'GRO guest meeting';
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a guest cannot edit a meeting they organize');

  reset role;
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  refused := false;
  begin
    perform public.set_project_direct_access(v_project, guest_user, 'contributor');
  exception when invalid_parameter_value then refused := true;
  end;
  perform tests.ok(refused, 'an administrator cannot give a guest more than read or follow on a project');
  refused := false;
  begin
    perform public.set_program_direct_access(v_program, guest_user, 'lead');
  exception when invalid_parameter_value then refused := true;
  end;
  perform tests.ok(refused, 'an administrator cannot give a guest more than read or follow on a program');
  perform public.set_project_direct_access(v_project, guest_user, 'read_only');
  perform tests.ok(true, 'an administrator can still give a guest read access');
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
