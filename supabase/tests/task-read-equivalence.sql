-- task_read is has_task_capability(id, 'read'), restated (#115, migration
-- 20260924200000). The policy was rewritten for speed; this proves it still
-- admits exactly the same people to exactly the same tasks.
--
-- It builds a task for every way read access can arise, and for the ways it
-- must not, then for every organization member (at both assurance levels) and
-- one stranger compares the two row by row: a task the capability allows but
-- the policy hides, or the reverse, fails with the task and the person named.
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
  v_led_program uuid;
  v_granted_program uuid;
  v_closed_program uuid;
  v_owned_project uuid;
  v_granted_project uuid;
  v_inherited_project uuid;
  v_closed_project uuid;
  v_task uuid;
  v_user record;
  v_level text;
  v_mismatch record;
  v_people integer := 0;
  v_tasks integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_guest);

  -- Programs: one the volunteer leads, one granted to the guest, one nobody
  -- outside the organization-wide roles can see.
  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Equivalence led', 'equivalence-led-' || substr(gen_random_uuid()::text, 1, 8),
          v_volunteer, v_owner)
  returning id into v_led_program;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Equivalence granted', 'equivalence-granted-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_granted_program;
  insert into public.program_access_grant (organization_id, program_id, user_id, role, source, created_by)
  values (v_org, v_granted_program, v_guest, 'read_only', 'direct', v_owner);
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Equivalence closed', 'equivalence-closed-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_closed_program;

  -- Projects: owned by staff, granted to the guest, inheriting the guest's
  -- program grant, and one with no access for anyone below owner/admin.
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Equivalence owned', v_staff, v_owner)
  returning id into v_owned_project;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Equivalence granted', v_owner, v_owner)
  returning id into v_granted_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_granted_project, v_guest, 'follower', 'direct', v_owner);
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_granted_program, 'Equivalence inherited', v_owner, v_owner)
  returning id into v_inherited_project;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_closed_program, 'Equivalence closed', v_owner, v_owner)
  returning id into v_closed_project;

  -- One task per path in and per path that must not lead in.
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_owned_project, 'eq: owned project', v_owner),
         (v_org, v_granted_project, 'eq: granted project', v_owner),
         (v_org, v_inherited_project, 'eq: project inherits program grant', v_owner),
         (v_org, v_closed_project, 'eq: closed project', v_owner);
  insert into public.task (organization_id, program_id, title, created_by)
  values (v_org, v_led_program, 'eq: program-only, led', v_owner),
         (v_org, v_granted_program, 'eq: program-only, granted', v_owner),
         (v_org, v_closed_program, 'eq: program-only, closed', v_owner);
  insert into public.task (organization_id, title, created_by)
  values (v_org, 'eq: organization-level, no scope', v_owner);
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_closed_project, 'eq: assignee column', v_owner, v_guest);
  insert into public.task (organization_id, project_id, title, created_by, requester_id)
  values (v_org, v_closed_project, 'eq: requester column', v_owner, v_guest);
  insert into public.task (organization_id, project_id, title, created_by, reviewer_id)
  values (v_org, v_closed_project, 'eq: reviewer column', v_owner, v_volunteer);
  insert into public.task (organization_id, project_id, title, created_by, approver_id)
  values (v_org, v_closed_project, 'eq: approver column', v_owner, v_volunteer);
  for v_level in select unnest(array['contributor', 'reviewer', 'approver', 'follower']) loop
    insert into public.task (organization_id, project_id, title, created_by)
    values (v_org, v_closed_project, 'eq: assignment ' || v_level, v_owner)
    returning id into v_task;
    insert into public.task_assignment (task_id, user_id, role)
    values (v_task, v_guest, v_level);
  end loop;

  -- Every task in the database, fixture and seed alike, read without RLS.
  create temp table equivalence_task on commit drop as select id, title from public.task;
  grant select on equivalence_task to authenticated;
  select count(*) into v_tasks from equivalence_task;

  for v_user in
    select distinct m.user_id, true as member from public.organization_membership m
    union all
    select gen_random_uuid(), false
  loop
    foreach v_level in array case when v_user.member then array['aal1', 'aal2'] else array['aal1'] end loop
      perform tests.authenticate(v_user.user_id, v_level);

      select e.title, public.has_task_capability(e.id, 'read') as capability
      into v_mismatch
      from equivalence_task e
      where public.has_task_capability(e.id, 'read')
         <> exists (select 1 from public.task t where t.id = e.id)
      limit 1;

      perform tests.ok(
        v_mismatch is null,
        format(
          'task_read matches has_task_capability for %s at %s%s',
          v_user.user_id, v_level,
          case when v_mismatch is null then ''
               else format(' (task "%s": capability says %s, the policy the opposite)',
                           v_mismatch.title, v_mismatch.capability)
          end
        )
      );
      perform tests.clear_auth();
    end loop;
    v_people := v_people + 1;
  end loop;

  -- The comparison proves nothing if it had nothing to compare: the fixture
  -- alone is 15 tasks, and CI's database carries little else at this point.
  perform tests.ok(v_people >= 5 and v_tasks >= 15,
    format('compared %s people against %s tasks', v_people, v_tasks));

  -- And the fixture really does exercise both sides: the guest reads through
  -- grants and columns, and is refused the closed project and program.
  perform tests.authenticate(v_guest, 'aal1');
  perform tests.ok(
    (select count(*) from public.task where title in (
       'eq: granted project', 'eq: project inherits program grant', 'eq: program-only, granted',
       'eq: assignee column', 'eq: requester column', 'eq: assignment contributor',
       'eq: assignment reviewer', 'eq: assignment approver', 'eq: assignment follower')) = 9,
    'the guest reads every task a grant, a column or an assignment gives them'
  );
  perform tests.ok(
    not exists (select 1 from public.task where title in (
       'eq: closed project', 'eq: program-only, closed',
       'eq: owned project', 'eq: program-only, led')),
    'the guest reads none of the tasks nothing gives them'
  );
  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.ok(
    exists (select 1 from public.task where title = 'eq: program-only, led')
      and exists (select 1 from public.task where title = 'eq: reviewer column')
      and not exists (select 1 from public.task where title = 'eq: program-only, closed'),
    'a program lead reads the program''s tasks and their own review, and not a closed program'
  );
  perform tests.clear_auth();
end
$$;

rollback;
