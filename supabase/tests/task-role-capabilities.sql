-- Task role capabilities: every task role grants exactly its own capabilities,
-- and nothing else reaches the task. Run after qa-users.sql and rls.sql.
-- All mutations are rolled back.
--
-- Each scenario puts its task on a project the actor has no grant on, so the
-- only thing that can make the task reachable is the role under test. A test
-- that gave the actor project access would pass no matter what the role did.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_actor uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_other uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_foreign_org uuid;
  v_program uuid;
  v_project uuid;
  v_foreign_project uuid;
  t_reviewer_col uuid;
  t_approver_col uuid;
  t_contributor uuid;
  t_reviewer_row uuid;
  t_approver_row uuid;
  t_follower uuid;
  t_unrelated uuid;
  t_foreign uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership owner_membership
  where owner_membership.user_id = v_owner
    and exists (
      select 1 from public.organization_membership peer
      where peer.organization_id = owner_membership.organization_id
        and peer.user_id = v_actor
    );

  insert into public.program (organization_id, name, slug, created_by)
  values (
    v_org, 'Task role program',
    'task-role-' || substr(gen_random_uuid()::text, 1, 8), v_owner
  ) returning id into v_program;

  insert into public.project (
    organization_id, program_id, name, owner_id, created_by
  ) values (
    v_org, v_program, 'Task role project', v_owner, v_owner
  ) returning id into v_project;

  insert into public.task (organization_id, project_id, title, created_by, reviewer_id)
  values (v_org, v_project, 'Reviewed by column', v_owner, v_actor)
  returning id into t_reviewer_col;

  insert into public.task (organization_id, project_id, title, created_by, approver_id)
  values (v_org, v_project, 'Approved by column', v_owner, v_actor)
  returning id into t_approver_col;

  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Contributed by role row', v_owner)
  returning id into t_contributor;
  insert into public.task_assignment (task_id, user_id, role)
  values (t_contributor, v_actor, 'contributor');

  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Reviewed by role row', v_owner)
  returning id into t_reviewer_row;
  insert into public.task_assignment (task_id, user_id, role)
  values (t_reviewer_row, v_actor, 'reviewer');

  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Approved by role row', v_owner)
  returning id into t_approver_row;
  insert into public.task_assignment (task_id, user_id, role)
  values (t_approver_row, v_actor, 'approver');

  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Followed by role row', v_owner)
  returning id into t_follower;
  insert into public.task_assignment (task_id, user_id, role)
  values (t_follower, v_actor, 'follower');

  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'No relationship at all', v_owner)
  returning id into t_unrelated;

  -- A role row naming somebody else, on a task the actor cannot reach.
  insert into public.task_assignment (task_id, user_id, role)
  values (t_unrelated, v_other, 'follower');

  perform tests.authenticate(v_actor);

  -- Column roles.
  perform tests.ok(
    public.has_task_capability(t_reviewer_col, 'read')
      and public.has_task_capability(t_reviewer_col, 'review')
      and public.has_task_capability(t_reviewer_col, 'approve')
      and not public.has_task_capability(t_reviewer_col, 'manage')
      and not public.has_task_capability(t_reviewer_col, 'collaborate'),
    'reviewer column grants review and approve without management'
  );
  perform tests.ok(
    public.has_task_capability(t_approver_col, 'read')
      and public.has_task_capability(t_approver_col, 'review')
      and public.has_task_capability(t_approver_col, 'approve')
      and not public.has_task_capability(t_approver_col, 'manage'),
    'approver column grants approval without management'
  );

  -- Explicit role rows.
  perform tests.ok(
    public.has_task_capability(t_contributor, 'read')
      and public.has_task_capability(t_contributor, 'collaborate')
      and not public.has_task_capability(t_contributor, 'review')
      and not public.has_task_capability(t_contributor, 'manage'),
    'contributor role row grants collaboration only'
  );
  perform tests.ok(
    public.has_task_capability(t_reviewer_row, 'read')
      and public.has_task_capability(t_reviewer_row, 'review')
      and not public.has_task_capability(t_reviewer_row, 'approve')
      and not public.has_task_capability(t_reviewer_row, 'collaborate'),
    'reviewer role row grants review but not approval'
  );
  perform tests.ok(
    public.has_task_capability(t_approver_row, 'read')
      and public.has_task_capability(t_approver_row, 'review')
      and public.has_task_capability(t_approver_row, 'approve'),
    'approver role row grants review and approval'
  );
  perform tests.ok(
    public.has_task_capability(t_follower, 'read')
      and public.has_task_capability(t_follower, 'follow')
      and not public.has_task_capability(t_follower, 'collaborate')
      and not public.has_task_capability(t_follower, 'review'),
    'follower role row grants visibility only'
  );

  -- The capability helper is only interesting if the policies agree with it.
  select count(*) into n from public.task
  where id in (
    t_reviewer_col, t_approver_col, t_contributor,
    t_reviewer_row, t_approver_row, t_follower
  );
  perform tests.ok(n = 6, 'every task role makes its task readable through RLS');

  select count(*) into n from public.task where id = t_unrelated;
  perform tests.ok(n = 0, 'a task with no role and no scope stays invisible');

  -- A follower can see the task but must not be able to change the work.
  update public.task set title = 'Follower edit' where id = t_follower;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a follower cannot update the task it follows');

  -- Role rows explain themselves, without leaking other people's roles.
  select count(*) into n from public.task_assignment
  where task_id = t_follower and user_id = v_actor;
  perform tests.ok(n = 1, 'a person can read the role row that names them');

  select count(*) into n from public.task_assignment
  where task_id = t_unrelated and user_id = v_other;
  perform tests.ok(
    n = 0, 'a role row on an unreachable task is not visible to other members'
  );
  reset role;

  -- Same-organization integrity for the grant-bearing paths.
  insert into public.organization (name, slug)
  values (
    'Task role foreign organization',
    'task-role-foreign-' || substr(gen_random_uuid()::text, 1, 8)
  ) returning id into v_foreign_org;
  -- No owner: the owner would have to be a member of the foreign organization,
  -- and the point of this fixture is that nobody here is.
  insert into public.project (organization_id, name, created_by)
  values (v_foreign_org, 'Foreign project', v_owner)
  returning id into v_foreign_project;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_foreign_org, v_foreign_project, 'Foreign task', v_owner)
  returning id into t_foreign;

  begin
    insert into public.task_assignment (task_id, user_id, role)
    values (t_foreign, v_actor, 'reviewer');
    raise exception 'FAIL: a task role crossed an organization boundary';
  exception when check_violation then
    perform tests.ok(
      true, 'a task role requires membership of the task''s organization'
    );
  end;

  begin
    insert into public.task (
      organization_id, project_id, title, created_by, approver_id
    ) values (
      v_foreign_org, v_foreign_project, 'Foreign approver', v_owner, v_actor
    );
    raise exception 'FAIL: a foreign approver was accepted';
  exception when check_violation then
    perform tests.ok(
      true, 'an approver must be an active member of the task''s organization'
    );
  end;

  -- Deactivation must close a role-derived grant, not just a scope-derived one.
  update public.organization_membership
  set status = 'deactivated'
  where organization_id = v_org and user_id = v_actor;
  perform tests.authenticate(v_actor);
  select count(*) into n from public.task where id = t_reviewer_row;
  perform tests.ok(
    n = 0, 'deactivating a member closes their role-derived task access'
  );
  reset role;
end;
$$;

rollback;
