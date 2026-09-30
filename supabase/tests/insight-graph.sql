-- Insight graph lens (V2-1, epic #199): the lens adds no table; it reads
-- programmes, projects, milestones, tasks and both dependency tables through
-- the viewer's own session. What must hold for it to be safe is that each role
-- sees a dependency edge only when it can read both ends, and that nobody
-- signed out sees anything. Every role the plan names is checked: owner,
-- admin, staff, member (guest), volunteer, the external accountant (a guest
-- with a ledger grant) and signed-out.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_program uuid;
  v_open uuid;
  v_closed uuid;
  m_open uuid;
  m_open2 uuid;
  m_closed uuid;
  t_open uuid;
  t_open2 uuid;
  t_closed uuid;
  v_role record;
  n integer;
  leaks integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Graph programme', 'graph-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Graph open project', v_owner, v_owner) returning id into v_open;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Graph closed project', v_owner, v_owner) returning id into v_closed;

  -- The volunteer and the guest may read the open project only.
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_open, v_volunteer, 'read_only', 'direct', v_owner),
         (v_org, v_open, v_guest, 'read_only', 'direct', v_owner);
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);

  insert into public.milestone (project_id, name) values (v_open, 'Open A') returning id into m_open;
  insert into public.milestone (project_id, name) values (v_open, 'Open B') returning id into m_open2;
  insert into public.milestone (project_id, name) values (v_closed, 'Closed') returning id into m_closed;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_open, 'Graph open task', v_owner) returning id into t_open;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_open, 'Graph open task 2', v_owner) returning id into t_open2;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_closed, 'Graph closed task', v_owner) returning id into t_closed;

  insert into public.milestone_dependency (blocking_milestone_id, blocked_milestone_id)
  values (m_open, m_open2), (m_closed, m_open);
  insert into public.task_dependency (blocking_task_id, blocked_task_id)
  values (t_open, t_open2), (t_closed, t_open);

  -- Owner and admin (with two-step sign-in) see the whole graph.
  for v_role in select * from (values (v_owner, 'owner'), (v_admin, 'admin')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.milestone_dependency
    where blocked_milestone_id in (m_open, m_open2);
    perform tests.ok(n = 2, v_role.name || ' sees every milestone dependency');
    select count(*) into n from public.task_dependency where blocked_task_id in (t_open, t_open2);
    perform tests.ok(n = 2, v_role.name || ' sees every task dependency');
    reset role;
  end loop;

  -- Every signed-in role: no edge is visible unless both of its ends are.
  for v_role in select * from (values
      (v_owner, 'owner'), (v_admin, 'admin'), (v_staff, 'staff'),
      (v_volunteer, 'volunteer'), (v_guest, 'member (guest) and accountant')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into leaks from public.milestone_dependency d
    where d.blocked_milestone_id in (m_open, m_open2)
      and (not exists (select 1 from public.milestone m where m.id = d.blocking_milestone_id)
        or not exists (select 1 from public.milestone m where m.id = d.blocked_milestone_id));
    perform tests.ok(leaks = 0, v_role.name || ': no milestone edge points at an unreadable milestone');
    select count(*) into leaks from public.task_dependency d
    where d.blocked_task_id in (t_open, t_open2)
      and (not exists (select 1 from public.task t where t.id = d.blocking_task_id)
        or not exists (select 1 from public.task t where t.id = d.blocked_task_id));
    perform tests.ok(leaks = 0, v_role.name || ': no task edge points at an unreadable task');
    reset role;
  end loop;

  -- Read-only grants on the open project: its own edge is visible (allow),
  -- the edge from the closed project is not, nor the closed objects (deny).
  for v_role in select * from (values (v_volunteer, 'volunteer'), (v_guest, 'member (guest) and accountant')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.milestone_dependency
    where blocking_milestone_id = m_open and blocked_milestone_id = m_open2;
    perform tests.ok(n = 1, v_role.name || ' sees the dependency inside a project they can read');
    select count(*) into n from public.milestone_dependency where blocking_milestone_id = m_closed;
    perform tests.ok(n = 0, v_role.name || ' does not see a dependency from a project they cannot read');
    select count(*) into n from public.task_dependency where blocking_task_id = t_closed;
    perform tests.ok(n = 0, v_role.name || ' does not see a task dependency from a project they cannot read');
    select count(*) into n from public.project where id = v_closed;
    perform tests.ok(n = 0, v_role.name || ' does not see the closed project node');
    select count(*) into n from public.milestone where id = m_closed;
    perform tests.ok(n = 0, v_role.name || ' does not see the closed milestone node');
    reset role;
  end loop;

  -- Signed out: nothing at all.
  perform tests.clear_auth();
  select count(*) into n from public.milestone_dependency where blocked_milestone_id in (m_open, m_open2);
  perform tests.ok(n = 0, 'signed-out: no milestone dependencies');
  select count(*) into n from public.task_dependency where blocked_task_id in (t_open, t_open2);
  perform tests.ok(n = 0, 'signed-out: no task dependencies');
  select count(*) into n from public.project where id in (v_open, v_closed);
  perform tests.ok(n = 0, 'signed-out: no projects');
  reset role;
end;
$$;

rollback;
