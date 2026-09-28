-- person_work_summary (#136 phase 2, migration 20261003090000): the figures
-- match the underlying records for every listed member and agree with
-- team_overview; the person sees their own summary, owners and admins with
-- MFA see anyone listed, and everyone else, including signed-out callers,
-- gets nothing. Run after qa-users.sql and rls.sql. All mutations roll back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_lead uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_project uuid;
  v_quiet_project uuid;
  v_meeting uuid;
  v_action_task uuid;
  v_today date := current_date;
  v_summary jsonb;
  v_page jsonb;
  v_checked integer := 0;
  v_count integer;
  v_overview jsonb;
  v_row jsonb;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  -- A project the staff member owns whose weekly report is overdue, and one
  -- with no reporting schedule.
  insert into public.project (organization_id, name, owner_id, created_by, stage,
                              reporting_cadence, last_status_update_at, created_at)
  values (v_org, 'Summary fixture: late report', v_staff, v_owner, 'planning', 'weekly',
          now() - interval '10 days', now() - interval '40 days')
  returning id into v_project;
  insert into public.project (organization_id, name, owner_id, created_by, stage)
  values (v_org, 'Summary fixture: no cadence', v_staff, v_owner, 'planning')
  returning id into v_quiet_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_staff, 'contributor', 'direct', v_owner);

  insert into public.task (organization_id, project_id, title, created_by, assignee_id,
                           status, due_at, blocked_reason, updated_at, archived_at, completed_at)
  values
    (v_org, v_project, 'summary: overdue 12d', v_owner, v_staff, 'not_started', v_today - 12, null, now(), null, null),
    (v_org, v_project, 'summary: overdue and blocked', v_owner, v_staff, 'blocked', v_today - 2, 'Waiting', now(), null, null),
    (v_org, v_project, 'summary: blocked old', v_owner, v_staff, 'blocked', null, 'Waiting on the venue', now() - interval '7 days', null, null),
    (v_org, v_project, 'summary: this week', v_owner, v_staff, 'ready', v_today + 3, null, now(), null, null),
    (v_org, v_project, 'summary: due today', v_owner, v_staff, 'in_progress', v_today, null, now(), null, null),
    (v_org, v_project, 'summary: later', v_owner, v_staff, 'not_started', v_today + 30, null, now(), null, null),
    (v_org, v_project, 'summary: no due date, stale', v_owner, v_staff, 'in_progress', null, null, now() - interval '10 days', null, null),
    (v_org, v_project, 'summary: archived', v_owner, v_staff, 'not_started', v_today - 5, null, now(), now(), null),
    (v_org, v_project, 'summary: done 3d', v_owner, v_staff, 'completed', null, null, now(), null, now() - interval '3 days'),
    (v_org, v_project, 'summary: done 10d', v_owner, v_staff, 'completed', null, null, now(), null, now() - interval '10 days');

  insert into public.decision_request (organization_id, project_id, requester_id, assignee_id, due_at, context)
  values
    (v_org, v_project, v_owner, v_staff, v_today - 1, 'Summary: overdue decision'),
    (v_org, v_project, v_owner, v_staff, v_today + 5, 'Summary: open decision');

  -- Meeting action items: one open (its task is open), one done (its task is
  -- completed), one without a task, and one from a cancelled meeting.
  insert into public.meeting (organization_id, project_id, title, organizer_id, starts_at, status)
  values (v_org, v_project, 'Summary fixture meeting', v_owner, now() - interval '1 day', 'completed')
  returning id into v_meeting;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id, status, due_at)
  values (v_org, v_project, 'summary: action task', v_owner, v_staff, 'not_started', v_today + 2)
  returning id into v_action_task;
  insert into public.meeting_action (meeting_id, task_id, title, owner_id, due_at)
  values (v_meeting, v_action_task, 'Summary: open action', v_staff, v_today + 2);
  insert into public.meeting_action (meeting_id, task_id, title, owner_id, due_at)
  select v_meeting, t.id, 'Summary: done action', v_staff, v_today - 1
  from public.task t where t.title = 'summary: done 3d' and t.organization_id = v_org;
  insert into public.meeting_action (meeting_id, title, owner_id, due_at)
  values (v_meeting, 'Summary: action without a task', v_staff, v_today - 1);
  insert into public.meeting (organization_id, title, organizer_id, starts_at, status)
  values (v_org, 'Summary cancelled meeting', v_owner, now(), 'cancelled')
  returning id into v_meeting;
  insert into public.meeting_action (meeting_id, title, owner_id)
  values (v_meeting, 'Summary: action from a cancelled meeting', v_staff);

  -- Activity: three work events inside the window, one message event (never
  -- shown), and one older than the retention window (never shown).
  insert into public.activity_event (organization_id, actor_id, verb, source_type, source_id, project_id, summary, created_at)
  values
    (v_org, v_staff, 'completed', 'task', gen_random_uuid(), v_project, 'Summary: completed a task', now() - interval '1 hour'),
    (v_org, v_staff, 'updated', 'project', v_project, v_project, 'Summary: updated the project', now() - interval '2 hours'),
    (v_org, v_staff, 'created', 'task', gen_random_uuid(), v_project, 'Summary: created a task', now() - interval '3 hours'),
    (v_org, v_staff, 'posted', 'message', gen_random_uuid(), v_project, 'Summary: said something private', now() - interval '90 minutes'),
    (v_org, v_staff, 'created', 'task', gen_random_uuid(), v_project, 'Summary: too old to show', now() - interval '400 days');

  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_volunteer;

  -- Every listed member: the summary's figures equal the overview row, and
  -- the figures the overview does not carry equal the records counted here.
  perform tests.authenticate(v_owner, 'aal2');
  select jsonb_agg(to_jsonb(o)) into v_overview from public.team_overview(v_today) o;
  perform tests.clear_auth();
  reset role;

  for v_row in select value from jsonb_array_elements(v_overview) loop
    perform tests.authenticate(v_owner, 'aal2');
    v_summary := public.person_work_summary((v_row->>'user_id')::uuid, v_today);
    perform tests.clear_auth();
    reset role;

    perform tests.ok(v_summary is not null,
      format('an owner with MFA can read the summary of %s', (v_row->>'user_id')::uuid));
    perform tests.ok(
      (v_summary->'figures'->>'open_tasks')::bigint = (v_row->>'open_tasks')::bigint
        and (v_summary->'figures'->>'overdue')::bigint = (v_row->>'overdue')::bigint
        and (v_summary->'figures'->>'oldest_overdue_due')::date is not distinct from (v_row->>'oldest_overdue_due')::date
        and (v_summary->'figures'->>'due_this_week')::bigint = (v_row->>'due_this_week')::bigint
        and (v_summary->'figures'->>'blocked')::bigint = (v_row->>'blocked')::bigint
        and (v_summary->'figures'->>'blocked_stale')::bigint = (v_row->>'blocked_stale')::bigint
        and (v_summary->'figures'->>'in_progress_stale')::bigint = (v_row->>'in_progress_stale')::bigint
        and (v_summary->'figures'->>'completed_7')::bigint = (v_row->>'completed_7')::bigint
        and (v_summary->'figures'->>'completed_prev_7')::bigint = (v_row->>'completed_prev_7')::bigint
        and (v_summary->'figures'->>'completed_30')::bigint = (v_row->>'completed_30')::bigint
        and (v_summary->'figures'->>'open_decisions')::bigint = (v_row->>'open_decisions')::bigint
        and (v_summary->'figures'->>'overdue_decisions')::bigint = (v_row->>'overdue_decisions')::bigint
        and (v_summary->'figures'->>'last_activity_at')::timestamptz is not distinct from (v_row->>'last_activity_at')::timestamptz,
      format('the summary figures for %s equal the team overview row', (v_row->>'user_id')::uuid));

    select count(*) into v_count
    from public.project p
    where p.organization_id = v_org and p.owner_id = (v_row->>'user_id')::uuid and p.archived_at is null
      and p.stage::text in ('approved', 'planning', 'active')
      and p.reporting_cadence in ('weekly', 'monthly')
      and coalesce(p.last_status_update_at, p.created_at)
          < now() - case p.reporting_cadence when 'weekly' then interval '7 days' else interval '30 days' end;
    perform tests.ok((v_summary->'figures'->>'stale_projects')::int = v_count,
      format('stale project count for %s matches (%s / %s)', (v_row->>'user_id')::uuid,
             v_summary->'figures'->>'stale_projects', v_count));

    select count(*) into v_count
    from public.meeting_action a
    join public.meeting m on m.id = a.meeting_id
    left join public.task t on t.id = a.task_id
    where m.organization_id = v_org and a.owner_id = (v_row->>'user_id')::uuid and m.status <> 'cancelled'
      and (a.task_id is null or (t.status not in ('completed', 'cancelled') and t.archived_at is null));
    perform tests.ok((v_summary->'figures'->>'open_meeting_actions')::int = v_count,
      format('open meeting action count for %s matches (%s / %s)', (v_row->>'user_id')::uuid,
             v_summary->'figures'->>'open_meeting_actions', v_count));

    perform tests.ok(jsonb_array_length(v_summary->'tasks') = (v_summary->'figures'->>'open_tasks')::int,
      format('every open task of %s is listed once', (v_row->>'user_id')::uuid));
    v_checked := v_checked + 1;
  end loop;
  perform tests.ok(v_checked >= 3, format('compared %s people', v_checked));

  -- The staff fixture, spelled out.
  perform tests.authenticate(v_staff, 'aal1');
  v_summary := public.person_work_summary(v_staff, v_today);
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_summary is not null, 'staff read their own summary without MFA');
  perform tests.ok((v_summary->'figures'->>'stale_projects')::int >= 1, 'the late report is counted');
  perform tests.ok((v_summary->'figures'->>'open_meeting_actions')::int >= 2,
    'open meeting actions include the open one and the one without a task');
  perform tests.ok(
    (select count(*) from jsonb_array_elements(v_summary->'meeting_actions') a
      where a->>'title' in ('Summary: done action', 'Summary: action from a cancelled meeting')) = 0,
    'done actions and cancelled meetings are not listed');
  perform tests.ok(
    (select a->>'group' from jsonb_array_elements(v_summary->'tasks') a where a->>'title' = 'summary: overdue and blocked') = 'overdue'
      and (select a->>'group' from jsonb_array_elements(v_summary->'tasks') a where a->>'title' = 'summary: blocked old') = 'blocked'
      and (select a->>'group' from jsonb_array_elements(v_summary->'tasks') a where a->>'title' = 'summary: due today') = 'this_week'
      and (select a->>'group' from jsonb_array_elements(v_summary->'tasks') a where a->>'title' = 'summary: this week') = 'this_week'
      and (select a->>'group' from jsonb_array_elements(v_summary->'tasks') a where a->>'title' = 'summary: later') = 'later'
      and (select a->>'group' from jsonb_array_elements(v_summary->'tasks') a where a->>'title' = 'summary: no due date, stale') = 'later'
      and (select (a->>'no_recent_update')::boolean from jsonb_array_elements(v_summary->'tasks') a where a->>'title' = 'summary: no due date, stale'),
    'open tasks are grouped overdue, blocked, this week, later');
  perform tests.ok(
    not exists (select 1 from jsonb_array_elements(v_summary->'tasks') a where a->>'title' = 'summary: archived'),
    'archived tasks are not listed');
  perform tests.ok(
    (select count(*) from jsonb_array_elements(v_summary->'projects') p
      where p->>'name' like 'Summary fixture:%') = 2
      and (select (p->>'report_overdue')::boolean from jsonb_array_elements(v_summary->'projects') p
            where p->>'name' = 'Summary fixture: late report')
      and not (select (p->>'report_overdue')::boolean from jsonb_array_elements(v_summary->'projects') p
                where p->>'name' = 'Summary fixture: no cadence'),
    'owned projects carry their reporting status');
  perform tests.ok(
    (select count(*) from jsonb_array_elements(v_summary->'decisions') d
      where d->>'context' like 'Summary:%') = 2,
    'open decisions assigned to them are listed');

  -- The timeline: work events only, inside the retention window, paged.
  perform tests.ok(
    not exists (select 1 from jsonb_array_elements(v_summary->'activity') e
                where e->>'source_type' = 'message' or e->>'summary' like '%private%'),
    'message events never reach the timeline');
  perform tests.ok(
    not exists (select 1 from jsonb_array_elements(v_summary->'activity') e
                where e->>'summary' = 'Summary: too old to show'),
    'entries older than the retention window are not shown');
  perform tests.ok((v_summary->>'activity_since')::timestamptz <= now() - interval '364 days'
                   and (v_summary->>'activity_since')::timestamptz >= now() - interval '366 days',
    'the default window is the 365-day activity retention default');

  perform tests.authenticate(v_staff, 'aal1');
  v_page := public.person_work_summary(v_staff, v_today, null, 2);
  perform tests.ok(jsonb_array_length(v_page->'activity') = 2 and (v_page->>'activity_has_more')::boolean,
    'the first page holds two entries and says there are more');
  v_page := public.person_work_summary(v_staff, v_today, (v_page->'activity'->1->>'created_at')::timestamptz, 2);
  perform tests.clear_auth();
  reset role;
  perform tests.ok(jsonb_array_length(v_page->'activity') = 1
                   and v_page->'activity'->0->>'summary' = 'Summary: created a task'
                   and not (v_page->>'activity_has_more')::boolean,
    'the next page continues after the last entry shown');

  -- An enabled, shorter retention policy shortens the window.
  insert into public.retention_policy (organization_id, subject_key, retain_days, enabled)
  values (v_org, 'activity_event', 90, true)
  on conflict (organization_id, subject_key) do update set retain_days = 90, enabled = true;
  perform tests.authenticate(v_staff, 'aal1');
  v_summary := public.person_work_summary(v_staff, v_today);
  perform tests.clear_auth();
  reset role;
  perform tests.ok((v_summary->>'activity_since')::timestamptz <= now() - interval '89 days'
                   and (v_summary->>'activity_since')::timestamptz >= now() - interval '91 days',
    'an enabled activity retention policy sets the window');

  -- Who may read whose summary.
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(public.person_work_summary(v_staff, v_today) is not null,
    'an admin with MFA reads a staff member''s summary');
  perform tests.ok(public.person_work_summary(v_volunteer, v_today) is null,
    'an admin with MFA gets nothing for a volunteer');
  perform tests.ok(public.person_work_summary(v_guest, v_today) is null,
    'an admin with MFA gets nothing for a guest');
  perform tests.clear_auth();
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(public.person_work_summary(v_staff, v_today) is null,
    'an owner without MFA cannot read someone else''s summary');
  perform tests.ok(public.person_work_summary(v_owner, v_today) is not null,
    'an owner without MFA can still read their own summary');
  perform tests.clear_auth();
  reset role;

  perform tests.authenticate(v_staff, 'aal2');
  perform tests.ok(public.person_work_summary(v_owner, v_today) is null,
    'staff cannot read an owner''s summary');
  perform tests.ok(public.person_work_summary(v_lead, v_today) is null,
    'staff cannot read another staff member''s summary');
  perform tests.clear_auth();
  reset role;

  for r in select unnest(array[v_volunteer, v_guest]) as uid loop
    perform tests.authenticate(r.uid, 'aal2');
    perform tests.ok(public.person_work_summary(r.uid, v_today) is null,
      format('%s has no summary, not even their own', r.uid));
    perform tests.ok(public.person_work_summary(v_staff, v_today) is null,
      format('%s cannot read a staff member''s summary', r.uid));
    perform tests.clear_auth();
    reset role;
  end loop;

  -- Signed out, the function cannot be called at all.
  begin
    set local role anon;
    perform public.person_work_summary(v_staff, v_today);
    reset role;
    perform tests.ok(false, 'anon cannot call person_work_summary');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call person_work_summary');
  end;
end
$$;

rollback;
