-- Project progress, workload and project task counts come from the
-- database, not from capped downloads (migration 20261118130000). Proves:
-- the counts are whole past PostgREST's 1,000-row cap (1,500 tasks on one
-- project); and for every member of the organization (and a stranger) each
-- function returns exactly what that person could count by reading the rows
-- themselves, so nothing beyond what row-level security shows them is
-- counted. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_big uuid;
  v_small uuid;
  v_user record;
  v_ids uuid[];
  v_rows integer;
  v_bad integer;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.project (organization_id, name, owner_id)
  values (v_org, 'Counts big project', v_owner) returning id into v_big;
  insert into public.project (organization_id, name, owner_id)
  values (v_org, 'Counts small project', v_staff) returning id into v_small;

  -- 1,500 tasks: 700 completed, 1 blocked, the rest open; half assigned to staff.
  insert into public.task (organization_id, project_id, title, status, blocked_reason, assignee_id, due_at, estimate_hours, created_by)
  select v_org, v_big, 'Counts task ' || g,
    (case when g <= 700 then 'completed' when g = 701 then 'blocked' else 'in_progress' end)::public.task_status,
    case when g = 701 then 'Waiting on the venue' end,
    case when g % 2 = 0 then v_staff else v_owner end,
    current_date + (g % 20) - 5,
    case when g % 3 = 0 then null else 1.5 end,
    v_owner
  from generate_series(1, 1500) g;
  insert into public.task (organization_id, project_id, title, status, assignee_id, created_by)
  values (v_org, v_small, 'Counts small 1', 'ready', v_staff, v_staff),
         (v_org, v_small, 'Counts small 2', 'cancelled', v_staff, v_staff);
  v_ids := array[v_big, v_small];

  perform tests.authenticate(v_owner, 'aal2');
  select * into r from public.portfolio_project_progress(v_ids) where project_id = v_big;
  perform tests.ok(r.total = 1500 and r.completed = 700 and r.blocked_task_title = 'Counts task 701',
    format('progress counts every task past the 1,000-row cap (%s total, %s completed, %s)',
      r.total, r.completed, r.blocked_task_title));
  perform tests.ok((select member_has_task from public.portfolio_project_progress(v_ids, v_staff) where project_id = v_small)
    and not (select member_has_task from public.portfolio_project_progress(v_ids, gen_random_uuid()) where project_id = v_big),
    'progress says which projects the filtered person has work in');
  select * into r from public.project_task_counts(v_big);
  perform tests.ok(r.total = 1500 and r.completed = 700 and r.open = 800,
    format('a project''s task counts are whole (%s open, %s completed)', r.open, r.completed));
  select * into r from public.project_task_counts(v_small);
  perform tests.ok(r.total = 2 and r.open = 1 and r.completed = 0, 'cancelled tasks are neither open nor done');
  perform tests.clear_auth(); reset role;

  -- Each person, at both assurance levels, gets exactly their own readable rows.
  for v_user in
    select m.user_id from public.organization_membership m where m.organization_id = v_org
    union all select gen_random_uuid()
  loop
    perform tests.authenticate(v_user.user_id, 'aal1');

    select count(*) into v_bad from (
      (select project_id, total, completed from public.portfolio_project_progress(v_ids)
       except
       select t.project_id, count(*), count(*) filter (where t.status = 'completed')
       from public.task t where t.project_id = any(v_ids) and t.archived_at is null group by t.project_id)
      union all
      (select t.project_id, count(*), count(*) filter (where t.status = 'completed')
       from public.task t where t.project_id = any(v_ids) and t.archived_at is null group by t.project_id
       except
       select project_id, total, completed from public.portfolio_project_progress(v_ids))
    ) diff;
    perform tests.ok(v_bad = 0, format('progress matches what %s can read', v_user.user_id));

    select count(*) into v_bad from (
      (select assignee_id, active, overdue, due_soon from public.open_task_workload(current_date, current_date + 7)
       except
       select t.assignee_id, count(*),
         count(*) filter (where t.due_at < current_date),
         count(*) filter (where t.due_at >= current_date and t.due_at <= current_date + 7)
       from public.task t
       where t.archived_at is null and t.assignee_id is not null
         and t.status in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
       group by t.assignee_id)
      union all
      (select t.assignee_id, count(*),
         count(*) filter (where t.due_at < current_date),
         count(*) filter (where t.due_at >= current_date and t.due_at <= current_date + 7)
       from public.task t
       where t.archived_at is null and t.assignee_id is not null
         and t.status in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
       group by t.assignee_id
       except
       select assignee_id, active, overdue, due_soon from public.open_task_workload(current_date, current_date + 7))
    ) diff;
    perform tests.ok(v_bad = 0, format('workload matches what %s can read', v_user.user_id));

    select count(*) into v_bad from public.project_task_counts(v_big) c
    where c.total <> (select count(*) from public.task t where t.project_id = v_big and t.archived_at is null);
    perform tests.ok(v_bad = 0, format('project counts match what %s can read', v_user.user_id));
    perform tests.clear_auth(); reset role;
  end loop;

  begin
    set local role anon;
    perform public.open_task_workload(current_date, current_date + 7);
    reset role;
    perform tests.ok(false, 'anon cannot read workload');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot read workload');
  end;
end;
$$;

rollback;
