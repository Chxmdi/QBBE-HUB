-- dashboard_task_summary returns the figures the dashboard used to compute
-- with separate queries (#115, migration 20260925010000), for every member:
-- the same filters, under the same row-level security. Run after qa-users.sql
-- and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_today date := current_date;
  v_week_out date := current_date + 7;
  v_month_ago timestamptz := now() - interval '30 days';
  v_sixty timestamptz := now() - interval '60 days';
  v_user record;
  v_level text;
  s record;
  v_open bigint;
  v_week bigint;
  v_overdue bigint;
  v_done30 bigint;
  v_todo bigint;
  v_progress bigint;
  v_done60 bigint;
  v_people integer := 0;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_volunteer;

  -- Enough variety that every figure is non-trivial: each open status, due in
  -- the past, this week, later and never, archived, and completed at 10, 45
  -- and 90 days ago. Assigned to the volunteer so a non-administrator sees
  -- some of them.
  insert into public.task (organization_id, title, created_by, assignee_id, status, due_at, archived_at, blocked_reason)
  select v_org, 'summary: ' || s.status || ' ' || coalesce(d.label, 'none'), v_owner, v_volunteer,
         s.status::public.task_status, d.due,
         case when d.label = 'archived' then now() end,
         case when s.status = 'blocked' then 'Waiting on the venue' end
  from unnest(array['not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review']) as s(status)
  cross join (values
    ('past', current_date - 3), ('week', current_date + 2), ('later', current_date + 30),
    ('none', null::date), ('archived', current_date + 1)
  ) as d(label, due);
  insert into public.task (organization_id, title, created_by, assignee_id, status, completed_at)
  select v_org, 'summary: completed ' || ago, v_owner, v_volunteer, 'completed', now() - (ago || ' days')::interval
  from unnest(array[10, 45, 90]) as ago;

  for v_user in select distinct user_id from public.organization_membership loop
    foreach v_level in array array['aal1', 'aal2'] loop
      perform tests.authenticate(v_user.user_id, v_level);

      select * into s from public.dashboard_task_summary(v_today, v_week_out, v_month_ago, v_sixty);

      select count(*) into v_open from public.task
      where status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
        and archived_at is null;
      select count(*) into v_week from public.task
      where status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
        and archived_at is null and due_at >= v_today and due_at <= v_week_out;
      select count(*) into v_overdue from public.task
      where status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
        and archived_at is null and due_at < v_today;
      select count(*) into v_done30 from public.task
      where status = 'completed' and completed_at >= v_month_ago;
      select count(*) into v_todo from public.task
      where status::text in ('not_started', 'ready') and archived_at is null
        and (due_at is null or due_at >= v_today);
      select count(*) into v_progress from public.task
      where status::text in ('in_progress', 'waiting', 'blocked', 'in_review') and archived_at is null
        and (due_at is null or due_at >= v_today);
      select count(*) into v_done60 from public.task
      where status = 'completed' and completed_at >= v_sixty;

      perform tests.ok(
        s.open_tasks = v_open and s.due_this_week = v_week and s.overdue = v_overdue
          and s.completed_last_30 = v_done30 and s.donut_to_do = v_todo
          and s.donut_in_progress = v_progress
          and cardinality(s.completed_at_since_sixty_days) = v_done60,
        format(
          'dashboard_task_summary matches the separate queries for %s at %s '
          '(open %s/%s, week %s/%s, overdue %s/%s, done30 %s/%s, todo %s/%s, progress %s/%s, done60 %s/%s)',
          v_user.user_id, v_level,
          s.open_tasks, v_open, s.due_this_week, v_week, s.overdue, v_overdue,
          s.completed_last_30, v_done30, s.donut_to_do, v_todo, s.donut_in_progress, v_progress,
          cardinality(s.completed_at_since_sixty_days), v_done60
        )
      );
      perform tests.clear_auth();
    end loop;
    v_people := v_people + 1;
  end loop;

  -- The volunteer, a non-administrator, sees the fixture through assignment.
  perform tests.authenticate(v_volunteer, 'aal1');
  select * into s from public.dashboard_task_summary(v_today, v_week_out, v_month_ago, v_sixty);
  perform tests.ok(s.open_tasks >= 24 and s.overdue >= 6 and s.due_this_week >= 6
                     and s.completed_last_30 >= 1,
    format('the fixture is visible to an assignee (open %s, overdue %s, week %s, done30 %s)',
           s.open_tasks, s.overdue, s.due_this_week, s.completed_last_30));
  perform tests.clear_auth();

  perform tests.ok(v_people >= 5, format('compared %s people', v_people));
end
$$;

rollback;
