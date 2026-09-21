-- Task core follow-ups (#76): the defects #29 and #30 left behind.
--
-- Three of the nine are database-observable and are pinned here. The rest are
-- command- or component-level and are covered by the unit suite and
-- tests/e2e/task-core.spec.ts.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  t_unassigned uuid;
  t_assigned uuid;
  v_label uuid;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Task follow-up program',
          'task-followup-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;

  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Task follow-up project', v_owner, v_owner)
  returning id into v_project;

  -- Grants are explicit here rather than inherited from the seed, so each
  -- assertion below is about the policy under test and not about which
  -- fixture happened to reach which project. The staff member manages the
  -- project; the volunteer can read it and nothing more. That pairing is the
  -- interesting one: the denials that matter are the ones where the row is
  -- visible, not the ones where it was never reachable.
  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, created_by
  ) values (v_org, v_project, v_staff, 'project_manager', 'direct', v_owner);

  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, created_by
  ) values (v_org, v_project, v_volunteer, 'read_only', 'direct', v_owner);

  -- ------------------------------------------------------------------
  -- 1. The review queue must not be NULL-blind.
  --
  -- The reviewing query said "not mine" with `assignee_id <> me`. In SQL that
  -- is null for an unassigned task, and a null predicate excludes the row, so
  -- a task somebody was named reviewer of vanished from their queue for as
  -- long as nobody owned it — which is exactly when a reviewer is waiting on
  -- it. These assertions are on the raw predicate rather than on the query
  -- builder, because the trap is in SQL's three-valued logic and this is
  -- where the next person will look for it.
  -- ------------------------------------------------------------------
  insert into public.task
    (organization_id, program_id, project_id, title, status, reviewer_id,
     assignee_id, requester_id, created_by)
  values
    (v_org, v_program, v_project, 'Unassigned but under review', 'in_review',
     v_staff, null, v_owner, v_owner)
  returning id into t_unassigned;

  insert into public.task
    (organization_id, program_id, project_id, title, status, reviewer_id,
     assignee_id, requester_id, created_by)
  values
    (v_org, v_program, v_project, 'Owned by the reviewer', 'in_review',
     v_staff, v_staff, v_owner, v_owner)
  returning id into t_assigned;

  select count(*) into n
  from public.task
  where id in (t_unassigned, t_assigned)
    and reviewer_id = v_staff
    and assignee_id <> v_staff;
  perform tests.ok(
    n = 0,
    'the old predicate drops the unassigned task and keeps nothing (both rows excluded)'
  );

  select count(*) into n
  from public.task
  where id in (t_unassigned, t_assigned)
    and reviewer_id = v_staff
    and (assignee_id is null or assignee_id <> v_staff);
  perform tests.ok(
    n = 1,
    'the null-aware predicate keeps the unassigned task and still excludes the reviewer''s own'
  );

  -- ------------------------------------------------------------------
  -- 2. Labels are writable, and only by the people the policies name.
  --
  -- `label` and `task_label` have had correct policies since 0001_core.sql
  -- and no caller. These prove the policies actually permit the write path
  -- that was added, and still refuse the person who may only read the task.
  -- ------------------------------------------------------------------
  perform tests.authenticate(v_staff);

  insert into public.label (organization_id, name, color)
  values (v_org, 'Follow-up label ' || substr(gen_random_uuid()::text, 1, 8), 'brand')
  returning id into v_label;
  perform tests.ok(v_label is not null, 'a staff member can create a label');

  insert into public.task_label (task_id, label_id) values (t_unassigned, v_label);
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a staff member can attach a label to a task they manage');

  -- Attaching the same label twice is a duplicate, not a second label.
  failed := false;
  begin
    insert into public.task_label (task_id, label_id) values (t_unassigned, v_label);
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'the same label cannot be attached to a task twice');

  select count(*) into n from public.task_label where task_id = t_unassigned;
  perform tests.ok(n = 1, 'the task carries exactly one copy of the label');

  -- The volunteer holds read_only on this project, so every denial below is a
  -- read-without-write case. A volunteer with no access at all would pass the
  -- same assertions for the wrong reason.
  perform tests.authenticate(v_volunteer);

  select count(*) into n from public.task_label where task_id = t_unassigned;
  perform tests.ok(n = 1, 'a volunteer can see the labels on a task they can read');

  failed := false;
  begin
    insert into public.task_label (task_id, label_id) values (t_assigned, v_label);
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'a volunteer cannot attach a label to a task');

  delete from public.task_label where task_id = t_unassigned and label_id = v_label;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a volunteer cannot detach a label either');

  failed := false;
  begin
    insert into public.label (organization_id, name) values (v_org, 'Volunteer label');
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'a volunteer cannot create an organization-wide label');

  -- The person who could attach it can take it off again.
  perform tests.authenticate(v_staff);
  delete from public.task_label where task_id = t_unassigned and label_id = v_label;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a staff member can detach a label');

  -- ------------------------------------------------------------------
  -- 3. The approver column is authoritative, not decoration.
  --
  -- #76 adds the first control for it, so this pins what naming somebody
  -- actually does: `app.has_task_capability` grants an approver read, review
  -- and approve on a task they reach no other way.
  -- ------------------------------------------------------------------
  perform tests.clear_auth();
  reset role;
  update public.task set approver_id = v_volunteer, reviewer_id = null
  where id = t_assigned;

  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    public.has_task_capability(t_assigned, 'approve'),
    'naming somebody approver gives them approve on that task'
  );
  perform tests.ok(
    public.has_task_capability(t_assigned, 'review'),
    'an approver can also review'
  );
  perform tests.ok(
    not public.has_task_capability(t_assigned, 'manage'),
    'an approver does not thereby get manage'
  );

  perform tests.clear_auth();
  reset role;
end $$;

rollback;
