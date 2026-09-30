-- Equivalence round 2's changes (see equivalence-setup.sql): made through
-- today's tables only, as postgres, so every trigger fires as in the app.
-- ---------------------------------------------------------------------------
-- Round 2: change things through today's tables only.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_perf_program uuid;
  v_roles_program uuid;
  v_closed_program uuid;
  v_project uuid;
  v_team uuid;
  v_p30 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000030';
  v_p31 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000031';
  v_p32 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000032';
  v_p33 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000033';
  v_p05 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000005';
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  select id into strict v_perf_program from public.program where slug = 'perf-program';
  select id into strict v_roles_program from public.program where name = 'Eq roles program';
  select id into strict v_closed_program from public.program where name = 'Eq closed';

  -- A volunteer is given the whole 2,000-task program, another is removed
  -- from a project, a direct project grant changes role.
  insert into public.program_access_grant (organization_id, program_id, user_id, role, source, created_by)
  values (v_org, v_perf_program, v_p30, 'contributor', 'direct', v_owner);
  delete from public.project_access_grant
  where user_id = v_p31 and source = 'direct'
    and project_id = (select project_id from public.project_access_grant
                      where user_id = v_p31 and source = 'direct' limit 1);
  update public.project_access_grant set role = 'follower'
  where user_id = v_p32 and source = 'direct'
    and project_id = (select project_id from public.project_access_grant
                      where user_id = v_p32 and source = 'direct' limit 1);

  -- Projects move: one from the perf program into the roles program (its 200
  -- tasks follow), one out of any program.
  update public.project set program_id = v_roles_program where name = 'Perf Project 02';
  -- An active project must keep a program, so this one is moved back to
  -- planning first.
  update public.project set stage = 'planning' where name = 'Perf Project 03';
  update public.project set program_id = null where name = 'Perf Project 03';
  -- Ownership and program lead change hands.
  update public.project set owner_id = v_staff where name = 'Perf Project 04';
  update public.program set lead_id = v_volunteer where id = v_closed_program;

  -- A lead who is not an active member when named: today no record_lead grant
  -- is written, so once reactivated they reach the program and its
  -- program-level tasks through lead_id, but not its projects.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_p33;
  update public.program set lead_id = v_p33 where id = v_roles_program;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_p33;

  -- Tasks move and change hands.
  update public.task set project_id = null, program_id = v_closed_program
  where title = 'eq: roles project task';
  update public.task set project_id = null, program_id = null
  where title = 'eq: no-program project task';
  update public.task set assignee_id = v_volunteer
  where id in (select id from public.task where title like 'Perf task %' order by id limit 25);
  update public.task set reviewer_id = v_guest, approver_id = null
  where title in ('eq: approver column', 'eq: closed project task');
  delete from public.task_assignment
  where user_id = v_guest and role = 'follower';
  insert into public.task_assignment (task_id, user_id, role)
  select id, v_p05, 'reviewer' from public.task where title = 'eq: closed program-level task';

  -- A team grant (today stored per person with source 'team'), then one
  -- member leaves the team, which removes their grant by cascade.
  insert into public.team (organization_id, name, owner_id)
  values (v_org, 'Eq team', v_owner) returning id into v_team;
  insert into public.team_member (team_id, user_id, organization_id)
  values (v_team, v_p30, v_org), (v_team, v_p31, v_org);
  insert into public.program_access_grant
    (organization_id, program_id, user_id, role, source, source_team_id, created_by)
  values (v_org, v_closed_program, v_p30, 'reviewer', 'team', v_team, v_owner),
         (v_org, v_closed_program, v_p31, 'reviewer', 'team', v_team, v_owner);
  delete from public.team_member where team_id = v_team and user_id = v_p31;

  -- Roles change: suspended, promoted, demoted.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001';
  update public.organization_membership set role = 'admin'
  where organization_id = v_org and user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002';
  update public.organization_membership set role = 'staff'
  where organization_id = v_org and user_id = v_admin;

  -- Records deleted.
  delete from public.task where title = 'eq: assignment contributor';
  delete from public.project where name = 'Eq no-program project';

  delete from spike_access.eq_object o where not exists (
    select 1 from public.task t where t.id = o.id
    union all select 1 from public.project p where p.id = o.id
    union all select 1 from public.program p where p.id = o.id);
end
$$;

