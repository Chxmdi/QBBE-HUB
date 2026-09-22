-- Advanced planning (#31): milestone dependencies, series, and the identity
-- probe that tells a deactivated member from an unidentified request (#79).
--
-- What is pinned here is what only the database can promise: a cycle refused
-- under concurrency, a duplicate occurrence that cannot be recorded, and a
-- policy that denies a write it should deny even when the row is visible.
-- Command-level behaviour lives in the unit suite; the reachable flows live in
-- tests/e2e/work-planning.spec.ts.
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
  m_a uuid;
  m_b uuid;
  m_c uuid;
  v_series uuid;
  v_task uuid;
  n integer;
  failed boolean;
  v_actor uuid;
  k_first double precision;
  k_second double precision;
  k_third double precision;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Planning program',
          'planning-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;

  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Planning project', v_owner, v_owner)
  returning id into v_project;

  -- The staff member manages the project; the volunteer can read it and
  -- nothing more. The denials worth having are the ones where the row is
  -- visible, not the ones where it was never reachable.
  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, created_by
  ) values (v_org, v_project, v_staff, 'project_manager', 'direct', v_owner);

  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, created_by
  ) values (v_org, v_project, v_volunteer, 'read_only', 'direct', v_owner);

  insert into public.milestone (project_id, name) values (v_project, 'Book the venue')
  returning id into m_a;
  insert into public.milestone (project_id, name) values (v_project, 'Send invitations')
  returning id into m_b;
  insert into public.milestone (project_id, name) values (v_project, 'Run the event')
  returning id into m_c;

  -- -----------------------------------------------------------------------
  -- Milestone dependencies (P1-TSK-09)
  -- -----------------------------------------------------------------------
  perform tests.authenticate(v_staff);

  insert into public.milestone_dependency (blocking_milestone_id, blocked_milestone_id)
  values (m_a, m_b);
  select count(*) into n from public.milestone_dependency
  where blocking_milestone_id = m_a and blocked_milestone_id = m_b;
  perform tests.ok(n = 1, 'a project manager can record a milestone dependency');

  -- The self-edge is refused by a check constraint, before the trigger runs.
  failed := false;
  begin
    insert into public.milestone_dependency (blocking_milestone_id, blocked_milestone_id)
    values (m_a, m_a);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a milestone cannot depend on itself');

  -- The immediate reverse edge: a two-node cycle.
  failed := false;
  begin
    insert into public.milestone_dependency (blocking_milestone_id, blocked_milestone_id)
    values (m_b, m_a);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a milestone dependency cannot be reversed into a two-node cycle');

  -- The case the client-side check in #29 never covered: a longer cycle.
  -- a -> b already exists; add b -> c, then try c -> a.
  insert into public.milestone_dependency (blocking_milestone_id, blocked_milestone_id)
  values (m_b, m_c);

  failed := false;
  begin
    insert into public.milestone_dependency (blocking_milestone_id, blocked_milestone_id)
    values (m_c, m_a);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a three-node milestone cycle is refused by the database');

  -- A read-only member may see the edge and may not create one.
  perform tests.authenticate(v_volunteer);

  select count(*) into n from public.milestone_dependency
  where blocking_milestone_id = m_a and blocked_milestone_id = m_b;
  perform tests.ok(n = 1, 'a read-only member can see a dependency on a project they can read');

  failed := false;
  begin
    insert into public.milestone_dependency (blocking_milestone_id, blocked_milestone_id)
    values (m_c, m_b);
    -- A policy denial raises; a silent zero-row write would not, so check.
    get diagnostics n = row_count;
    if n = 0 then failed := true; end if;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a read-only member cannot create a milestone dependency');

  failed := false;
  begin
    delete from public.milestone_dependency
    where blocking_milestone_id = m_a and blocked_milestone_id = m_b;
    get diagnostics n = row_count;
    if n = 0 then failed := true; end if;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a read-only member cannot delete a milestone dependency');

  -- -----------------------------------------------------------------------
  -- Task series (P1-TSK-11)
  -- -----------------------------------------------------------------------
  perform tests.authenticate(v_staff);

  insert into public.task_series (
    organization_id, project_id, title, recurrence_rule, recurrence_anchor, owner_id
  ) values (v_org, v_project, 'Weekly volunteer check-in', 'weekly', current_date, v_staff)
  returning id into v_series;
  perform tests.ok(v_series is not null, 'a project manager can create a recurring series');

  -- `assignee_id` is not decoration. `task_read` is `has_task_capability`,
  -- which is STABLE and so reads the pre-insert snapshot: the row being
  -- inserted is not in it, the read policy finds nothing, and
  -- `insert ... returning` fails with a write-policy error that names the
  -- wrong problem. `task_assigned_actor_read` decides from the new row's own
  -- columns and is the policy that makes the row returnable. Every occurrence
  -- `createTaskSeries` writes carries the series owner as assignee, so this
  -- matches the command rather than working around the test.
  insert into public.task (
    organization_id, program_id, project_id, title, series_id, occurrence_date,
    assignee_id, created_by
  ) values (v_org, v_program, v_project, 'Weekly volunteer check-in', v_series,
            current_date, v_staff, v_staff)
  returning id into v_task;

  -- The guarantee: the same occurrence cannot be recorded twice. A retry, a
  -- double-click and two people completing the same task all arrive here.
  failed := false;
  begin
    insert into public.task (
      organization_id, program_id, project_id, title, series_id, occurrence_date,
      assignee_id, created_by
    ) values (v_org, v_program, v_project, 'Weekly volunteer check-in', v_series,
              current_date, v_staff, v_staff);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a series cannot record two tasks for the same occurrence date');

  -- A different date in the same series is ordinary work, not a duplicate.
  insert into public.task (
    organization_id, program_id, project_id, title, series_id, occurrence_date,
    assignee_id, created_by
  ) values (v_org, v_program, v_project, 'Weekly volunteer check-in', v_series,
            current_date + 7, v_staff, v_staff);
  select count(*) into n from public.task where series_id = v_series;
  perform tests.ok(n = 2, 'a series holds one task per occurrence date');

  -- Half a series membership is not expressible.
  failed := false;
  begin
    insert into public.task (
      organization_id, program_id, project_id, title, series_id, assignee_id, created_by
    ) values (v_org, v_program, v_project, 'Dateless occurrence', v_series, v_staff, v_staff);
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a task cannot belong to a series without an occurrence date');

  -- Stopping a series keeps everything it produced.
  update public.task_series set stopped_at = now() where id = v_series;
  select count(*) into n from public.task where series_id = v_series;
  perform tests.ok(n = 2, 'stopping a series keeps the occurrences it already produced');

  -- A read-only member may see the series and may not change it.
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.task_series where id = v_series;
  perform tests.ok(n = 1, 'a read-only member can see a series on a project they can read');

  failed := false;
  begin
    update public.task_series set title = 'Renamed by a reader' where id = v_series;
    get diagnostics n = row_count;
    if n = 0 then failed := true; end if;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a read-only member cannot rename a series');

  -- A stopped series is the flag `updateTaskStatus` reads before it spawns a
  -- successor. Pin the value the command depends on, so a rename or a default
  -- change breaks here rather than silently resuming a series somebody ended.
  select count(*) into n from public.task_series
  where id = v_series and stopped_at is not null;
  perform tests.ok(n = 1, 'a stopped series is recorded as stopped, not deleted');

  -- -----------------------------------------------------------------------
  -- Checklist ordering (P1-TSK-10)
  -- -----------------------------------------------------------------------
  --
  -- The column existed and the drawer already ordered by it; nothing ever
  -- wrote a value. Ordering by a column that is 0 in every row is not an
  -- ordering, so this is the assertion that the trigger gives each new item a
  -- place of its own.
  perform tests.authenticate(v_staff);

  insert into public.checklist_item (task_id, title) values (v_task, 'First')
  returning sort_key into k_first;
  insert into public.checklist_item (task_id, title) values (v_task, 'Second')
  returning sort_key into k_second;
  insert into public.checklist_item (task_id, title) values (v_task, 'Third')
  returning sort_key into k_third;

  perform tests.ok(k_first < k_second and k_second < k_third,
    'each new checklist item is positioned after the last one');

  -- A caller that chooses a position keeps it; only the 0 sentinel is filled
  -- in. This is what lets reorderChecklist rewrite positions as 1..n.
  update public.checklist_item set sort_key = 99 where task_id = v_task and title = 'First';
  select sort_key into k_first from public.checklist_item
  where task_id = v_task and title = 'First';
  perform tests.ok(k_first = 99, 'an explicit checklist position is preserved');

  select count(*) into n from public.checklist_item
  where task_id = v_task and sort_key = 0;
  perform tests.ok(n = 0, 'no checklist item is left on the unordered default');

  -- -----------------------------------------------------------------------
  -- The identity probe (#79)
  -- -----------------------------------------------------------------------
  --
  -- The point of the function is that it answers differently for an
  -- identified caller and an unidentified one, which is exactly the
  -- distinction /account-inactive was collapsing.
  perform tests.authenticate(v_owner);
  select public.current_actor_id() into v_actor;
  perform tests.ok(v_actor = v_owner,
    'current_actor_id reports the authenticated caller');

  -- The failure being modelled is not an anonymous visitor. It is a request
  -- that arrives with the `authenticated` role but no usable subject claim,
  -- which is what a dropped or unrefreshed token looks like to PostgREST, and
  -- is precisely the case `membership_read` answers with an empty result
  -- rather than an error.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  select public.current_actor_id() into v_actor;
  perform tests.ok(v_actor is null,
    'current_actor_id reports null when the request carries no usable subject');

  -- And the read that /account-inactive was drawing its conclusion from is
  -- empty in exactly that state, for a membership that is active. This is the
  -- pair of facts the application could not previously tell apart.
  select count(*) into n from public.organization_membership
  where user_id = v_owner and status = 'active';
  perform tests.ok(n = 0,
    'an active membership reads as absent when the request carries no identity');

  reset role;
end;
$$;

rollback;
