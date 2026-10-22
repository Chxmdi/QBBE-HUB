-- activity_read answered once per query instead of once per row (PERF-001,
-- migration 20261120010000).
--
-- The Home page's "recent activity" list timed out for staff and volunteers
-- once about 7,500 activity rows existed, because the read rule called four
-- SECURITY DEFINER helpers for every row. The rule is restated in the
-- set-based style task_read and project_read already use. Who can read which
-- row must not change, so this file:
--
--   1. checks the rule no longer calls a per-row helper, and that the program
--      page's feed has an index to read from;
--   2. builds an activity row for every way read access can arise (project,
--      program-only, organization-only, task through a person-level role,
--      personal task, task moved to another project, deleted task, another
--      organization), and for the ways it must not;
--   3. for every organization member (the QA users and, when the seed loaded
--      them, the scoped-grant users) at both assurance levels, and one
--      stranger, compares the rows the policy shows with the rows the original
--      predicate admits, computed as the table owner with the reader's claims.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

-- 1. Shape of the rule and the program feed index.
do $$
declare
  v_qual text;
begin
  select pg_get_expr(p.polqual, p.polrelid) into v_qual
  from pg_policy p
  where p.polrelid = 'public.activity_event'::regclass
    and p.polname = 'activity_read';

  perform tests.ok(v_qual is not null, 'activity_read exists on public.activity_event');
  perform tests.ok(
    v_qual !~ '(has_project_capability|has_program_capability|has_task_capability|is_org_member)',
    'activity_read calls no per-row capability helper (it would run once per activity row)'
  );
  perform tests.ok(
    exists (
      select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      where i.indrelid = 'public.activity_event'::regclass
        and pg_get_indexdef(i.indexrelid) ~ '\(program_id, created_at DESC\)'
    ),
    'activity_event has an index on (program_id, created_at desc) for the program page feed'
  );
end
$$;

-- 2 and 3. Same people, same rows.
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_other_org uuid;
  v_led_program uuid;
  v_granted_program uuid;
  v_closed_program uuid;
  v_owned_project uuid;
  v_granted_project uuid;
  v_inherited_project uuid;
  v_closed_project uuid;
  v_task uuid;
  v_moved_task uuid;
  v_user record;
  v_level text;
  v_missing integer;
  v_extra integer;
  v_example text;
  v_people integer := 0;
  v_rows integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_guest);

  insert into public.organization (name, slug)
  values ('Activity other org', 'activity-other-org-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_other_org;

  -- Programs: one the volunteer leads, one granted to the guest, one closed.
  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Activity led', 'act-led-' || substr(gen_random_uuid()::text, 1, 8), v_volunteer, v_owner)
  returning id into v_led_program;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Activity granted', 'act-granted-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_granted_program;
  insert into public.program_access_grant (organization_id, program_id, user_id, role, source, created_by)
  values (v_org, v_granted_program, v_guest, 'read_only', 'direct', v_owner);
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Activity closed', 'act-closed-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_closed_program;

  -- Projects: owned by staff, granted to the guest, inheriting the guest's
  -- program grant, and one closed to everyone below the organization-wide roles.
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Activity owned', v_staff, v_owner)
  returning id into v_owned_project;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Activity granted', v_owner, v_owner)
  returning id into v_granted_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_granted_project, v_guest, 'follower', 'direct', v_owner);
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_granted_program, 'Activity inherited', v_owner, v_owner)
  returning id into v_inherited_project;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_closed_program, 'Activity closed', v_owner, v_owner)
  returning id into v_closed_project;

  -- Project and program rows, written the way the app writes them.
  insert into public.activity_event (organization_id, verb, source_type, source_id, project_id, program_id, summary)
  select organization_id, 'updated', 'project', id, id, program_id, 'act: project ' || name
  from public.project
  where id in (v_owned_project, v_granted_project, v_inherited_project, v_closed_project);
  insert into public.activity_event (organization_id, verb, source_type, source_id, project_id, program_id, summary)
  select organization_id, 'updated', 'program', id, null, id, 'act: program-only ' || name
  from public.program
  where id in (v_led_program, v_granted_program, v_closed_program);

  -- Organization-only rows, here and in an organization nobody here belongs to.
  insert into public.activity_event (organization_id, verb, source_type, source_id, summary)
  values (v_org, 'created', 'meeting', gen_random_uuid(), 'act: organization-only'),
         (v_other_org, 'created', 'meeting', gen_random_uuid(), 'act: other organization');

  -- Tasks reached only through a person-level role, in the closed project.
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_closed_project, 'act: assignee column', v_owner, v_guest);
  insert into public.task (organization_id, project_id, title, created_by, requester_id)
  values (v_org, v_closed_project, 'act: requester column', v_owner, v_guest);
  insert into public.task (organization_id, project_id, title, created_by, reviewer_id)
  values (v_org, v_closed_project, 'act: reviewer column', v_owner, v_volunteer);
  insert into public.task (organization_id, project_id, title, created_by, approver_id)
  values (v_org, v_closed_project, 'act: approver column', v_owner, v_volunteer);
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_closed_project, 'act: nobody', v_owner);
  insert into public.task (organization_id, program_id, title, created_by, assignee_id)
  values (v_org, v_closed_program, 'act: closed program, assignee', v_owner, v_guest);
  for v_level in select unnest(array['contributor', 'reviewer', 'approver', 'follower']) loop
    insert into public.task (organization_id, project_id, title, created_by)
    values (v_org, v_closed_project, 'act: assignment ' || v_level, v_owner)
    returning id into v_task;
    insert into public.task_assignment (task_id, user_id, role)
    values (v_task, v_guest, v_level);
  end loop;
  -- A personal task (no project, no program) the staff member keeps.
  insert into public.task (organization_id, title, created_by)
  values (v_org, 'act: personal task', v_staff);

  insert into public.activity_event (organization_id, verb, source_type, source_id, project_id, program_id, summary)
  select organization_id, 'updated', 'task', id, project_id, program_id, 'act: task ' || title
  from public.task
  where title like 'act: %';

  -- A task that has moved from the closed project to the granted one: its
  -- older rows still name the closed project.
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_granted_project, 'act: moved task', v_owner)
  returning id into v_moved_task;
  insert into public.activity_event (organization_id, verb, source_type, source_id, project_id, program_id, summary)
  values (v_org, 'updated', 'task', v_moved_task, v_closed_project, v_closed_program, 'act: moved task, old row');

  -- A task-sourced row whose task no longer exists.
  insert into public.activity_event (organization_id, verb, source_type, source_id, project_id, summary)
  values (v_org, 'deleted', 'task', gen_random_uuid(), v_closed_project, 'act: deleted task');

  select count(*) into v_rows from public.activity_event;

  create temp table expected_activity (id uuid primary key) on commit drop;
  create temp table actual_activity (id uuid primary key) on commit drop;
  grant select, insert, delete on expected_activity, actual_activity to authenticated;

  for v_user in
    select distinct m.user_id, true as member from public.organization_membership m
    union all
    select gen_random_uuid(), false
  loop
    foreach v_level in array case when v_user.member then array['aal1', 'aal2'] else array['aal1'] end loop
      perform tests.authenticate(v_user.user_id, v_level);

      -- The rule as it stood before the rewrite, without RLS.
      perform set_config('role', 'postgres', true);
      truncate expected_activity, actual_activity;
      insert into expected_activity
      select a.id from public.activity_event a
      where (a.project_id is not null and app.has_project_capability(a.project_id, 'read'))
         or (a.project_id is null and a.program_id is not null
             and app.has_program_capability(a.program_id, 'read'))
         or (a.source_type = 'task' and app.has_task_capability(a.source_id, 'read'))
         or (a.project_id is null and a.program_id is null
             and app.is_org_member(a.organization_id));
      perform set_config('role', 'authenticated', true);

      insert into actual_activity select id from public.activity_event;

      select count(*) into v_missing from expected_activity e
      where not exists (select 1 from actual_activity a where a.id = e.id);
      select count(*) into v_extra from actual_activity a
      where not exists (select 1 from expected_activity e where e.id = a.id);

      perform set_config('role', 'postgres', true);
      select string_agg(x.summary, '; ') into v_example
      from (
        select ae.summary from public.activity_event ae
        where ae.id in (
          select e.id from expected_activity e
          where not exists (select 1 from actual_activity a where a.id = e.id)
          union all
          select a.id from actual_activity a
          where not exists (select 1 from expected_activity e where e.id = a.id)
        )
        limit 3
      ) as x;
      perform set_config('role', 'authenticated', true);

      perform tests.ok(
        v_missing = 0 and v_extra = 0,
        format('activity_read matches the original rule for %s at %s (missing %s, extra %s%s)',
               v_user.user_id, v_level, v_missing, v_extra,
               case when v_example is null then '' else ': ' || v_example end)
      );
      perform tests.clear_auth();
    end loop;
    v_people := v_people + 1;
  end loop;

  -- This file alone writes 22 rows; the seed may add more.
  perform tests.ok(v_people >= 5 and v_rows >= 22,
    format('compared %s people against %s activity rows', v_people, v_rows));

  -- The fixture exercises both sides of every branch.
  perform tests.authenticate(v_guest, 'aal1');
  perform tests.ok(
    (select count(*) from public.activity_event where summary in (
       'act: project Activity granted', 'act: project Activity inherited',
       'act: program-only Activity granted', 'act: organization-only',
       'act: task act: assignee column', 'act: task act: requester column',
       'act: task act: assignment contributor', 'act: task act: assignment reviewer',
       'act: task act: assignment approver', 'act: task act: assignment follower',
       'act: task act: closed program, assignee', 'act: moved task, old row')) = 12,
    'the guest reads activity through grants, task roles, a moved task and the organization'
  );
  perform tests.ok(
    not exists (select 1 from public.activity_event where summary in (
       'act: project Activity closed', 'act: project Activity owned',
       'act: program-only Activity closed', 'act: program-only Activity led',
       'act: task act: nobody', 'act: deleted task', 'act: other organization')),
    'the guest reads no activity that nothing gives them'
  );
  perform tests.authenticate(v_volunteer, 'aal2');
  perform tests.ok(
    exists (select 1 from public.activity_event where summary = 'act: program-only Activity led')
      and exists (select 1 from public.activity_event where summary = 'act: task act: reviewer column')
      and exists (select 1 from public.activity_event where summary = 'act: task act: approver column')
      and not exists (select 1 from public.activity_event where summary = 'act: program-only Activity closed'),
    'a program lead reads the program''s activity and their review tasks, not a closed program'
  );
  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(
    exists (select 1 from public.activity_event where summary = 'act: project Activity closed')
      and exists (select 1 from public.activity_event where summary = 'act: task act: nobody')
      and not exists (select 1 from public.activity_event where summary = 'act: other organization'),
    'an owner reads every row of their organization at aal1, and none of another organization'
  );
  perform tests.clear_auth();
end
$$;

rollback;
