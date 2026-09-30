-- Workspace OS app.can stand-in (W0-3): it must give exactly today's answers
-- for tasks and projects, and deny what it does not know. Run after qa-users.sql and
-- rls.sql. All mutations are rolled back.
--
-- The equivalence block is the important one: for every fixture person, at
-- both sign-in assurance levels, on every task and project, app.can must agree
-- with has_task_capability / has_project_capability under the mapping in
-- 20261101000200_workspace_os_can_stand_in.sql. A stand-in that answered true
-- more often than the old rules would open data the day a policy adopts it.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  t_assigned uuid;
  t_reviewed uuid;
  t_unrelated uuid;
  v_people uuid[];
  v_tasks uuid[];
  v_projects uuid[];
  v_person uuid;
  v_level text;
  v_object uuid;
  v_capability text;
  v_expected boolean;
  v_checked integer := 0;
  v_mismatches text[] := array[]::text[];
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
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Workspace OS can', 'wos-can-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Workspace OS can', v_owner, v_owner)
  returning id into v_project;

  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Assigned to the volunteer', v_owner, v_volunteer)
  returning id into t_assigned;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Reviewed by the volunteer', v_owner)
  returning id into t_reviewed;
  insert into public.task_assignment (task_id, user_id, role)
  values (t_reviewed, v_volunteer, 'reviewer');
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Nothing to do with the volunteer', v_owner)
  returning id into t_unrelated;

  -- Collected before switching role, so RLS does not hide any of them.
  select array_agg(user_id) into v_people
  from public.organization_membership where organization_id = v_org;
  select array_agg(id) into v_tasks from public.task;
  select array_agg(id) into v_projects from public.project;

  -- Grants and hardening.
  perform tests.ok(
    not has_function_privilege('anon', 'app.can(uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.can(uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'app.can(uuid, text)', 'execute')
      and has_function_privilege('authenticated', 'public.can(uuid, text)', 'execute'),
    'signed-in people reach app.can only through public.can; signed-out visitors not at all'
  );
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'can' and n.nspname in ('app', 'public')),
    'app.can and public.can are security definer with an empty search_path'
  );

  perform tests.ok(
    app.can(t_assigned, 'view') is false,
    'with no signed-in person, even the database owner gets false'
  );

  -- Equivalence with the existing predicates.
  foreach v_person in array v_people loop
    foreach v_level in array array['aal1', 'aal2'] loop
      perform tests.authenticate(v_person, v_level);
      for v_capability in select jsonb_object_keys(v_map) loop
        foreach v_object in array v_tasks loop
          select coalesce(bool_or(public.has_task_capability(v_object, legacy)), false)
          into v_expected
          from jsonb_array_elements_text(v_map -> v_capability) legacy;
          v_checked := v_checked + 1;
          if public.can(v_object, v_capability) is distinct from v_expected then
            v_mismatches := v_mismatches || format('%s %s task %s %s', v_person, v_level, v_object, v_capability);
          end if;
        end loop;
        foreach v_object in array v_projects loop
          select coalesce(bool_or(public.has_project_capability(v_object, legacy)), false)
          into v_expected
          from jsonb_array_elements_text(v_map -> v_capability) legacy;
          v_checked := v_checked + 1;
          if public.can(v_object, v_capability) is distinct from v_expected then
            v_mismatches := v_mismatches || format('%s %s project %s %s', v_person, v_level, v_object, v_capability);
          end if;
        end loop;
      end loop;
      reset role;
    end loop;
  end loop;
  perform tests.ok(
    v_checked > 0 and cardinality(v_mismatches) = 0,
    format('app.can agrees with the task and project predicates on %s checks%s',
      v_checked, coalesce(': ' || array_to_string(v_mismatches[1:5], '; '), ''))
  );

  -- The mapping, spelled out for one person.
  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    public.can(t_assigned, 'view') and public.can(t_assigned, 'comment')
      and public.can(t_assigned, 'edit_content')
      and not public.can(t_assigned, 'edit_structure')
      and not public.can(t_assigned, 'manage')
      and not public.can(t_assigned, 'share')
      and not public.can(t_assigned, 'run_workflow'),
    'an assignee can view, comment and edit content, and nothing more'
  );
  perform tests.ok(
    public.can(t_reviewed, 'view') and public.can(t_reviewed, 'comment')
      and not public.can(t_reviewed, 'edit_content'),
    'a reviewer can comment but not edit content'
  );
  perform tests.ok(
    not public.can(t_unrelated, 'view') and not public.can(v_project, 'view'),
    'no relationship means no access to the task or its project'
  );

  -- Deny by default.
  perform tests.ok(
    not public.can(gen_random_uuid(), 'view')
      and not public.can(t_assigned, 'delete_everything')
      and not public.can(t_assigned, null)
      and not public.can(null, 'view'),
    'unknown objects, unknown capabilities and nulls are denied'
  );
  perform tests.ok(
    public.can(t_assigned, 'VIEW'),
    'capability names are case-insensitive, like the predicates they call'
  );
  reset role;

  perform tests.authenticate(v_owner);
  -- M10a/M10c: a program is its space (same id), and can answers with
  -- today's program rules (spaces-can-equivalence.sql checks every role).
  perform tests.ok(
    public.can(v_program, 'view') = public.has_program_capability(v_program, 'read')
      and public.can(v_program, 'manage') = public.has_program_capability(v_program, 'manage')
      and public.can(v_program, 'view'),
    'a program is its space: can answers with the program rules'
  );
  perform tests.ok(
    public.can(v_project, 'manage') and public.can(t_unrelated, 'share'),
    'the owner with two-step sign-in manages the project and its tasks'
  );
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(
    public.can(v_project, 'view') and not public.can(v_project, 'manage'),
    'without two-step sign-in the owner can only view'
  );
  reset role;

  -- A deactivated member loses everything app.can answered before.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_volunteer;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    not public.can(t_assigned, 'view'),
    'deactivation closes access through app.can'
  );
  reset role;
end;
$$;

-- Signed out, the function cannot be called at all.
do $$
begin
  perform tests.clear_auth();
  begin
    perform public.can(gen_random_uuid(), 'view');
    raise exception 'FAIL: anon called public.can';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out caller cannot call public.can');
  end;
  reset role;
end;
$$;

rollback;
