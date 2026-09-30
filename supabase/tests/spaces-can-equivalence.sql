-- Workspace OS app.can (M10c): the cached check gives exactly today's
-- answers. For every member of every organization, at both sign-in levels
-- (AAL1, AAL2), on every task, project and program in the database (the
-- seed's too, when it is loaded), for every capability name, public.can must
-- equal has_task_capability / has_project_capability / has_program_capability
-- under the W0-3 mapping. It is checked on the fixture as built, then again
-- after a run of changes that each exercise one refresh trigger, and the
-- trigger-kept cache must equal a full rebuild. Zero mismatches.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

create function tests.eq_check(p_label text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_map constant jsonb := jsonb_build_object(
    'view', jsonb_build_array('read'),
    'comment', jsonb_build_array('manage', 'collaborate', 'review', 'approve'),
    'edit_content', jsonb_build_array('manage', 'collaborate'),
    'edit_structure', jsonb_build_array('manage'),
    'manage', jsonb_build_array('manage'),
    'share', jsonb_build_array('manage'),
    'run_workflow', jsonb_build_array('manage'),
    'read', jsonb_build_array('read'),
    'collaborate', jsonb_build_array('collaborate'),
    'review', jsonb_build_array('review'),
    'approve', jsonb_build_array('approve'),
    'follow', jsonb_build_array('follow')
  );
  v_people uuid[];
  v_objects jsonb;
  v_person uuid;
  v_level text;
  v_object record;
  v_capability text;
  v_expected boolean;
  v_checked integer := 0;
  v_mismatches text[] := array[]::text[];
  v_cache_diff integer;
begin
  -- Collected before switching role, so RLS hides nothing.
  select array_agg(distinct user_id) into v_people from public.organization_membership;
  select jsonb_agg(jsonb_build_object('id', id, 'kind', kind)) into v_objects from (
    select id, 'task' as kind from public.task
    union all select id, 'project' from public.project
    union all select id, 'program' from public.program) o;

  -- The trigger-kept cache equals a rebuild from the grants.
  select count(*) into v_cache_diff from (
    (select user_id, object_id, caps from app.access_cache
     except select user_id, object_id, caps from app.access_compute(array(select id from app.access_node)) where caps <> 0)
    union all
    (select user_id, object_id, caps from app.access_compute(array(select id from app.access_node)) where caps <> 0
     except select user_id, object_id, caps from app.access_cache)) d;
  perform tests.ok(v_cache_diff = 0,
    format('%s: the cache kept by triggers equals a full rebuild (%s rows differ)', p_label, v_cache_diff));

  foreach v_person in array v_people loop
    foreach v_level in array array['aal1', 'aal2'] loop
      perform tests.authenticate(v_person, v_level);
      for v_object in select (e ->> 'id')::uuid as id, e ->> 'kind' as kind from jsonb_array_elements(v_objects) e loop
        for v_capability in select jsonb_object_keys(v_map) loop
          select coalesce(bool_or(case v_object.kind
              when 'task' then public.has_task_capability(v_object.id, legacy)
              when 'project' then public.has_project_capability(v_object.id, legacy)
              else public.has_program_capability(v_object.id, legacy) end), false)
          into v_expected
          from jsonb_array_elements_text(v_map -> v_capability) legacy;
          v_checked := v_checked + 1;
          if public.can(v_object.id, v_capability) is distinct from v_expected then
            v_mismatches := v_mismatches || format('%s %s %s %s %s (today %s)',
              v_person, v_level, v_object.kind, v_object.id, v_capability, v_expected);
          end if;
        end loop;
      end loop;
      reset role;
    end loop;
  end loop;
  perform tests.ok(v_checked > 0 and cardinality(v_mismatches) = 0,
    format('%s: app.can agrees with today''s rules on %s checks (%s people, %s records, both sign-in levels)%s',
      p_label, v_checked, cardinality(v_people), jsonb_array_length(v_objects),
      coalesce(': ' || nullif(array_to_string(v_mismatches[1:5], '; '), ''), '')));
end;
$$;
grant execute on function tests.eq_check(text) to postgres;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_lead uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_pm uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
  v_contributor uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  v_readonly uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_program uuid;
  v_program2 uuid;
  v_project uuid;
  v_project2 uuid;
  v_loose uuid;
  v_team uuid;
  t_program uuid;
  t_project uuid;
  t_loose uuid;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;

  -- Every role is represented: owner, admin, staff, volunteer, guest, a
  -- leadership viewer, and an accountant (a guest with a live ledger grant).
  update public.organization_membership set role = 'leadership_viewer'
  where organization_id = v_org and user_id = v_readonly;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '1 day', v_admin);

  -- Edge cases: a program with a lead and program-level tasks, a project in
  -- it with an owner, a project with no program, a task with no project or
  -- program, every task actor column and role, team-sourced grants.
  insert into public.team (organization_id, name, owner_id) values (v_org, 'Equivalence team', v_admin)
  returning id into v_team;
  insert into public.team_member (team_id, user_id) values (v_team, v_volunteer);

  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Equivalence A', 'eq-a-' || substr(gen_random_uuid()::text, 1, 8), v_lead, v_owner)
  returning id into v_program;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Equivalence B', 'eq-b-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program2;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Equivalence project', v_pm, v_owner) returning id into v_project;
  insert into public.project (organization_id, program_id, name, created_by)
  values (v_org, v_program2, 'Equivalence project B', v_owner) returning id into v_project2;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Equivalence loose project', v_staff, v_owner) returning id into v_loose;

  insert into public.task (organization_id, program_id, title, created_by, reviewer_id)
  values (v_org, v_program, 'Program-level', v_owner, v_guest) returning id into t_program;
  insert into public.task (organization_id, project_id, program_id, title, created_by, assignee_id, requester_id)
  values (v_org, v_project, v_program2, 'In project, other program column', v_owner, v_volunteer, v_staff)
  returning id into t_project;
  insert into public.task (organization_id, title, created_by, approver_id)
  values (v_org, 'No project or program', v_owner, v_contributor) returning id into t_loose;
  insert into public.task (organization_id, project_id, title, created_by)
  select v_org, v_project2, 'Equivalence bulk ' || n, v_owner from generate_series(1, 5) n;

  insert into public.program_access_grant (organization_id, program_id, user_id, role, source)
  values (v_org, v_program, v_contributor, 'contributor', 'direct'),
         (v_org, v_program2, v_staff, 'reviewer', 'direct'),
         (v_org, v_program2, v_guest, 'follower', 'direct');
  insert into public.program_access_grant (organization_id, program_id, user_id, role, source, source_team_id)
  values (v_org, v_program, v_volunteer, 'read_only', 'team', v_team);
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source)
  values (v_org, v_project2, v_contributor, 'approver', 'direct'),
         (v_org, v_loose, v_guest, 'read_only', 'direct');
  insert into public.task_assignment (task_id, user_id, role)
  values (t_loose, v_volunteer, 'follower'), (t_program, v_staff, 'contributor'),
         (t_project, v_guest, 'reviewer'), (t_loose, v_staff, 'approver');

  perform tests.eq_check('as built');

  -- One change per refresh path, made as the owner (the move guards ask who
  -- is moving), then everything again.
  update public.program set lead_id = v_staff where id = v_program;                         -- lead column
  perform tests.authenticate(v_owner);
  update public.project set program_id = v_program2 where id = v_project;                   -- project move
  reset role;
  update public.project set owner_id = v_contributor where id = v_loose;                    -- owner column
  update public.task set project_id = null, program_id = v_program where id = t_project;   -- task move
  update public.task set assignee_id = v_readonly, reviewer_id = v_volunteer where id = t_loose; -- actor columns
  delete from public.program_access_grant where program_id = v_program2 and user_id = v_staff; -- grant removed
  update public.project_access_grant set role = 'contributor' where project_id = v_project2 and user_id = v_contributor; -- role changed
  delete from public.task_assignment where task_id = t_loose and user_id = v_volunteer;     -- task role removed
  insert into public.team_member (team_id, user_id) values (v_team, v_pm);                  -- team joined
  update public.organization_membership set role = 'volunteer'
  where organization_id = v_org and user_id = v_staff;                                     -- org role changed
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_contributor;                               -- deactivated
  delete from public.task where id = t_program;                                              -- task deleted

  perform tests.eq_check('after changes');
end;
$$;

rollback;
