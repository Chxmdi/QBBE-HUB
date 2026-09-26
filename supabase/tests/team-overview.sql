-- team_overview (#136, migration 20260926090000): the figures match separate
-- queries over the same records, only owners and admins who completed MFA get
-- any rows, and volunteers and guests are never listed. Run after
-- qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_project uuid;
  v_today date := current_date;
  v_rows integer;
  v_checked integer := 0;
  r record;
  e record;
  s record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Team overview fixture', v_owner, v_owner)
  returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_staff, 'contributor', 'direct', v_owner);

  -- The staff member's work: overdue (one 12 days old), due this week, due
  -- later, blocked for a week and blocked since yesterday, in progress with no
  -- update for 10 days, archived (never counted as open), and completed 3, 10
  -- and 20 days ago.
  insert into public.task (organization_id, project_id, title, created_by, assignee_id,
                           status, due_at, blocked_reason, updated_at, archived_at, completed_at)
  values
    (v_org, v_project, 'overview: overdue 12d', v_owner, v_staff, 'not_started', v_today - 12, null, now(), null, null),
    (v_org, v_project, 'overview: overdue 2d', v_owner, v_staff, 'in_progress', v_today - 2, null, now(), null, null),
    (v_org, v_project, 'overview: this week', v_owner, v_staff, 'ready', v_today + 3, null, now(), null, null),
    (v_org, v_project, 'overview: later', v_owner, v_staff, 'not_started', v_today + 30, null, now(), null, null),
    (v_org, v_project, 'overview: blocked old', v_owner, v_staff, 'blocked', null, 'Waiting on the venue', now() - interval '7 days', null, null),
    (v_org, v_project, 'overview: blocked new', v_owner, v_staff, 'blocked', null, 'Waiting on a quote', now() - interval '1 day', null, null),
    (v_org, v_project, 'overview: stale work', v_owner, v_staff, 'in_progress', null, null, now() - interval '10 days', null, null),
    (v_org, v_project, 'overview: archived', v_owner, v_staff, 'not_started', v_today - 5, null, now(), now(), null),
    (v_org, v_project, 'overview: done 3d', v_owner, v_staff, 'completed', null, null, now(), null, now() - interval '3 days'),
    (v_org, v_project, 'overview: done 10d', v_owner, v_staff, 'completed', null, null, now(), null, now() - interval '10 days'),
    (v_org, v_project, 'overview: done 20d', v_owner, v_staff, 'completed', null, null, now(), null, now() - interval '20 days');

  insert into public.decision_request (organization_id, project_id, requester_id, assignee_id, due_at, context)
  values
    (v_org, v_project, v_owner, v_staff, v_today - 1, 'Overview: overdue decision'),
    (v_org, v_project, v_owner, v_staff, v_today + 5, 'Overview: open decision');

  -- A volunteer with work of their own, to prove they are still not listed.
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_volunteer;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id, status, due_at)
  values (v_org, v_project, 'overview: volunteer task', v_owner, v_volunteer, 'not_started', v_today - 1);

  -- An owner who completed MFA sees one row per active owner, admin and staff
  -- member, and each row matches the records counted directly.
  perform tests.authenticate(v_owner, 'aal2');
  for r in select * from public.team_overview(v_today) loop
    perform tests.clear_auth();
    reset role;

    select
      count(*) filter (where is_open) as open_tasks,
      count(*) filter (where is_open and due_at < v_today) as overdue,
      min(due_at) filter (where is_open and due_at < v_today) as oldest,
      count(*) filter (where is_open and due_at >= v_today and due_at <= v_today + 7) as week,
      count(*) filter (where is_open and status = 'blocked') as blocked,
      count(*) filter (where is_open and status = 'blocked' and updated_at < now() - interval '5 days') as blocked_stale,
      count(*) filter (where is_open and status = 'in_progress' and updated_at < now() - interval '7 days') as stale,
      count(*) filter (where status = 'completed' and completed_at >= now() - interval '7 days') as done7,
      count(*) filter (where status = 'completed' and completed_at >= now() - interval '14 days'
                       and completed_at < now() - interval '7 days') as donep7,
      count(*) filter (where status = 'completed' and completed_at >= now() - interval '30 days') as done30
    into e
    from (
      select status::text as status, due_at, updated_at, completed_at,
             (status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
               and archived_at is null) as is_open
      from public.task
      where organization_id = r.organization_id and assignee_id = r.user_id
        and (archived_at is null or status = 'completed')
    ) t;

    select count(*) as open_d, count(*) filter (where due_at < v_today) as overdue_d
    into s
    from public.decision_request
    where organization_id = r.organization_id and assignee_id = r.user_id and status = 'open';

    perform tests.ok(
      r.open_tasks = e.open_tasks and r.overdue = e.overdue
        and r.oldest_overdue_due is not distinct from e.oldest
        and r.due_this_week = e.week and r.blocked = e.blocked
        and r.blocked_stale = e.blocked_stale and r.in_progress_stale = e.stale
        and r.completed_7 = e.done7 and r.completed_prev_7 = e.donep7
        and r.completed_30 = e.done30
        and r.open_decisions = s.open_d and r.overdue_decisions = s.overdue_d,
      format('team_overview matches the records for %s (open %s/%s, overdue %s/%s, week %s/%s, blocked %s/%s, stale %s/%s, done7 %s/%s)',
             r.user_id, r.open_tasks, e.open_tasks, r.overdue, e.overdue, r.due_this_week, e.week,
             r.blocked, e.blocked, r.in_progress_stale, e.stale, r.completed_7, e.done7)
    );
    perform tests.ok(r.role in ('owner', 'admin', 'staff'),
      format('only owners, admins and staff are listed (%s is %s)', r.user_id, r.role));
    v_checked := v_checked + 1;
    perform tests.authenticate(v_owner, 'aal2');
  end loop;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_checked >= 3, format('compared %s people', v_checked));

  -- The fixture's staff row, spelled out, so a broken comparison above cannot
  -- pass by comparing two wrong numbers.
  perform tests.authenticate(v_owner, 'aal2');
  select * into r from public.team_overview(v_today) where user_id = v_staff;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(
    r.open_tasks >= 7 and r.overdue >= 2 and r.oldest_overdue_due <= v_today - 12
      and r.due_this_week >= 1 and r.blocked >= 2 and r.blocked_stale >= 1
      and r.in_progress_stale >= 1 and r.completed_7 >= 1 and r.completed_prev_7 >= 1
      and r.completed_30 >= 3 and r.open_decisions >= 2 and r.overdue_decisions >= 1,
    format('the staff fixture reads as expected (open %s, overdue %s, blocked %s/%s stale, done 7d %s, decisions %s)',
           r.open_tasks, r.overdue, r.blocked, r.blocked_stale, r.completed_7, r.open_decisions)
  );

  perform tests.authenticate(v_owner, 'aal2');
  select count(*) into v_rows from public.team_overview(v_today)
  where user_id in (v_volunteer, v_guest);
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_rows = 0, 'volunteers and guests are never listed');

  -- An admin who completed MFA sees the same people.
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_rows from public.team_overview(v_today) where user_id = v_staff;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_rows = 1, 'an admin with MFA sees the staff member');

  -- Everyone else gets nothing: an owner without MFA, staff, a volunteer and a
  -- guest, each at both assurance levels where it applies.
  perform tests.authenticate(v_owner, 'aal1');
  select count(*) into v_rows from public.team_overview(v_today);
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_rows = 0, format('an owner without MFA gets no rows (%s)', v_rows));

  for r in select unnest(array[v_staff, v_volunteer, v_guest]) as uid loop
    perform tests.authenticate(r.uid, 'aal2');
    select count(*) into v_rows from public.team_overview(v_today);
    perform tests.clear_auth();
    reset role;
    perform tests.ok(v_rows = 0, format('%s gets no rows (%s)', r.uid, v_rows));
  end loop;

  -- Signed out, the function cannot be called at all.
  begin
    set local role anon;
    perform public.team_overview(v_today);
    reset role;
    perform tests.ok(false, 'anon cannot call team_overview');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call team_overview');
  end;
end
$$;

rollback;
