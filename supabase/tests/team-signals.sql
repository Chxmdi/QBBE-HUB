-- Team signals (#136 phase 3, migration 20261003091000): the rules follow
-- the organization's thresholds, the digest lists only people with open
-- signals, a standing signal is reminded once rather than daily, and only
-- the job runner can run any of it. Settings are changed only by owners and
-- admins with MFA. Run after qa-users.sql and rls.sql. All mutations roll back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_lead uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_project uuid;
  v_today date := current_date;
  v_kinds text[];
  v_count integer;
  v_first uuid[];
  v_ok boolean;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  -- Start from a clean slate: nobody else in the organization has work, so
  -- the only signals are the ones this file creates.
  update public.task set archived_at = now()
  where organization_id = v_org and archived_at is null;
  update public.decision_request set status = 'declined'
  where organization_id = v_org and status = 'open';
  update public.project set reporting_cadence = 'none'
  where organization_id = v_org;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_volunteer;

  insert into public.project (organization_id, name, owner_id, created_by, stage,
                              reporting_cadence, last_status_update_at)
  values (v_org, 'Signals fixture', v_staff, v_owner, 'planning', 'weekly', now() - interval '9 days')
  returning id into v_project;

  -- Staff: one task 12 days overdue, one blocked with no update for 6 days,
  -- one in progress with no update for 8 days, one overdue decision, and the
  -- project above with its weekly report overdue. The lead: two tasks two
  -- days overdue (below every default). The volunteer: plenty overdue, but
  -- volunteers are never listed.
  insert into public.task (organization_id, project_id, title, created_by, assignee_id,
                           status, due_at, blocked_reason, updated_at)
  values
    (v_org, v_project, 'signals: overdue 12d', v_owner, v_staff, 'not_started', v_today - 12, null, now()),
    (v_org, v_project, 'signals: blocked 6d', v_owner, v_staff, 'blocked', null, 'Waiting', now() - interval '6 days 2 hours'),
    (v_org, v_project, 'signals: in progress 8d', v_owner, v_staff, 'in_progress', null, null, now() - interval '8 days'),
    (v_org, v_project, 'signals: lead overdue a', v_owner, v_lead, 'not_started', v_today - 2, null, now()),
    (v_org, v_project, 'signals: lead overdue b', v_owner, v_lead, 'not_started', v_today - 2, null, now()),
    (v_org, v_project, 'signals: volunteer 1', v_owner, v_volunteer, 'not_started', v_today - 20, null, now()),
    (v_org, v_project, 'signals: volunteer 2', v_owner, v_volunteer, 'not_started', v_today - 20, null, now()),
    (v_org, v_project, 'signals: volunteer 3', v_owner, v_volunteer, 'not_started', v_today - 20, null, now());
  insert into public.decision_request (organization_id, project_id, requester_id, assignee_id, due_at, context)
  values (v_org, v_project, v_owner, v_staff, v_today - 1, 'Signals: overdue decision');

  -- Defaults (no settings row): every rule fires for the staff member,
  -- nothing for the lead, and the volunteer is not evaluated at all.
  select f.kinds into v_kinds from app.team_signal_figures(v_org, v_today) f where f.user_id = v_staff;
  perform tests.ok(v_kinds = array['overdue', 'blocked', 'in_progress', 'project_reports', 'decisions'],
    format('defaults: the staff member has every signal (%s)', v_kinds));
  select f.kinds into v_kinds from app.team_signal_figures(v_org, v_today) f where f.user_id = v_lead;
  perform tests.ok(cardinality(v_kinds) = 0, format('defaults: two tasks 2 days overdue is not a signal (%s)', v_kinds));
  perform tests.ok(not exists (select 1 from app.team_signal_figures(v_org, v_today) f where f.user_id = v_volunteer),
    'volunteers are never evaluated');

  -- The figures behind the signals match the records.
  select * into r from app.team_signal_figures(v_org, v_today) f where f.user_id = v_staff;
  perform tests.ok(r.overdue = 1 and r.oldest_overdue_days = 12 and r.blocked_stale = 1
                   and r.in_progress_stale = 1 and r.stale_projects = 1 and r.overdue_decisions = 1,
    format('the staff figures match the records (overdue %s, oldest %s, blocked %s, in progress %s, projects %s, decisions %s)',
           r.overdue, r.oldest_overdue_days, r.blocked_stale, r.in_progress_stale, r.stale_projects, r.overdue_decisions));

  -- The digest lists only people with a signal.
  select count(*) into v_count from public.team_signal_digest(v_org, v_today);
  perform tests.ok(v_count = 1, format('the digest lists one person (%s)', v_count));
  perform tests.ok(exists (select 1 from public.team_signal_digest(v_org, v_today) d where d.user_id = v_staff),
    'the digest lists the staff member with signals');
  perform tests.ok(not exists (select 1 from public.team_signal_digest(v_org, v_today) d
                               where cardinality(d.kinds) = 0 or d.user_id in (v_lead, v_owner, v_admin, v_volunteer)),
    'the digest names nobody without a signal');

  -- Thresholds are respected. Raise every age above the fixture and switch
  -- off the two flags: the staff member no longer has any signal.
  insert into public.team_signal_settings (organization_id, overdue_count, overdue_age_days,
    blocked_no_update_days, in_progress_no_update_days, flag_project_reports, flag_overdue_decisions)
  values (v_org, 3, 30, 10, 10, false, false);
  select f.kinds into v_kinds from app.team_signal_figures(v_org, v_today) f where f.user_id = v_staff;
  perform tests.ok(cardinality(v_kinds) = 0, format('raised thresholds and flags off: no signal (%s)', v_kinds));
  select count(*) into v_count from public.team_signal_digest(v_org, v_today);
  perform tests.ok(v_count = 0, format('with no signals the digest is empty (%s)', v_count));

  -- Lower the overdue count to 2: the lead's two overdue tasks now count.
  update public.team_signal_settings set overdue_count = 2 where organization_id = v_org;
  select f.kinds into v_kinds from app.team_signal_figures(v_org, v_today) f where f.user_id = v_lead;
  perform tests.ok(v_kinds = array['overdue'], format('an overdue count of 2 flags the lead (%s)', v_kinds));

  -- Lower the blocked age to 6 days: the staff member's blocked task counts.
  update public.team_signal_settings set blocked_no_update_days = 6 where organization_id = v_org;
  select f.kinds into v_kinds from app.team_signal_figures(v_org, v_today) f where f.user_id = v_staff;
  perform tests.ok(v_kinds = array['blocked'], format('a 6-day blocked threshold flags the blocked task (%s)', v_kinds));

  -- The overview applies the same blocked and in-progress ages.
  perform tests.authenticate(v_owner, 'aal2');
  select o.blocked_stale, o.in_progress_stale into r from public.team_overview(v_today) o where o.user_id = v_staff;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(r.blocked_stale = 1 and r.in_progress_stale = 0,
    format('team_overview uses the organization''s ages (blocked %s, in progress %s)', r.blocked_stale, r.in_progress_stale));

  -- Back to the defaults for the reminder checks.
  delete from public.team_signal_settings where organization_id = v_org;

  -- First daily run: every signal is new, so every one needs a reminder.
  select array_agg(s.signal_id order by s.kind) into v_first
  from public.sync_team_signals(v_org, v_today) s where s.user_id = v_staff;
  perform tests.ok(cardinality(v_first) = 5, format('first run: five new signals for the staff member (%s)', cardinality(v_first)));
  update public.team_signal set reminded_at = now() where id = any (v_first);

  -- The next day nothing has changed: no reminder, and the same signals stay open.
  select count(*) into v_count from public.sync_team_signals(v_org, v_today + 1) s where s.user_id = v_staff;
  perform tests.ok(v_count = 0, format('a standing signal is not reminded again (%s)', v_count));
  select count(*) into v_count from public.team_signal
  where organization_id = v_org and user_id = v_staff and closed_on is null;
  perform tests.ok(v_count = 5, format('the five signals stay open (%s)', v_count));
  select bool_and(last_seen_on = v_today + 1) into v_ok from public.team_signal
  where organization_id = v_org and user_id = v_staff and closed_on is null;
  perform tests.ok(v_ok, 'standing signals record when they were last seen');

  -- A reminder that was not recorded is offered again on the next run.
  update public.team_signal set reminded_at = null
  where organization_id = v_org and user_id = v_staff and kind = 'decisions' and closed_on is null;
  select count(*) into v_count from public.sync_team_signals(v_org, v_today + 1) s where s.user_id = v_staff;
  perform tests.ok(v_count = 1, format('an unsent reminder is offered again (%s)', v_count));
  update public.team_signal set reminded_at = now() where organization_id = v_org and closed_on is null;

  -- The decision is made: that signal closes.
  update public.decision_request set status = 'declined'
  where organization_id = v_org and context = 'Signals: overdue decision';
  perform public.sync_team_signals(v_org, v_today + 2);
  select count(*) into v_count from public.team_signal
  where organization_id = v_org and user_id = v_staff and kind = 'decisions' and closed_on = v_today + 2;
  perform tests.ok(v_count = 1, 'a signal that no longer holds is closed');

  -- A new overdue decision later is a new signal, and a new reminder.
  insert into public.decision_request (organization_id, project_id, requester_id, assignee_id, due_at, context)
  values (v_org, v_project, v_owner, v_staff, v_today - 1, 'Signals: another overdue decision');
  select count(*) into v_count from public.sync_team_signals(v_org, v_today + 3) s
  where s.user_id = v_staff and s.kind = 'decisions';
  perform tests.ok(v_count = 1, 'a signal that comes back is reminded once more');
  select count(*) into v_count from public.team_signal
  where organization_id = v_org and user_id = v_staff and kind = 'decisions';
  perform tests.ok(v_count = 2, 'the earlier, closed signal is kept as history');

  -- Only the job runner can run the rules, the sync and the digest.
  for r in select unnest(array[v_owner, v_staff]) as uid loop
    perform tests.authenticate(r.uid, 'aal2');
    begin
      perform public.team_signal_digest(v_org, v_today);
      perform tests.ok(false, format('%s cannot list the digest', r.uid));
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot list the digest', r.uid));
    end;
    begin
      perform public.sync_team_signals(v_org, v_today);
      perform tests.ok(false, format('%s cannot run the sync', r.uid));
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot run the sync', r.uid));
    end;
    begin
      perform app.team_signal_figures(v_org, v_today);
      perform tests.ok(false, format('%s cannot evaluate the rules', r.uid));
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot evaluate the rules', r.uid));
    end;
    perform tests.clear_auth();
    reset role;
  end loop;

  begin
    set local role anon;
    perform public.team_signal_digest(v_org, v_today);
    reset role;
    perform tests.ok(false, 'anon cannot list the digest');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot list the digest');
  end;

  begin
    set local role service_role;
    perform public.team_signal_digest(v_org, v_today);
    perform public.sync_team_signals(v_org, v_today + 3);
    reset role;
    perform tests.ok(true, 'the job runner (service role) runs the digest and the sync');
  exception when others then
    reset role;
    perform tests.ok(false, format('the service role could not run the jobs: %s', sqlerrm));
  end;

  -- Who reads the signals table: the person their own, admins with MFA all.
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.team_signal where user_id <> v_staff;
  perform tests.ok(v_count = 0, 'staff see only their own signals');
  select count(*) into v_count from public.team_signal where user_id = v_staff;
  perform tests.ok(v_count > 0, 'staff see their own signals');
  perform tests.clear_auth();
  reset role;
  perform tests.authenticate(v_owner, 'aal1');
  select count(*) into v_count from public.team_signal;
  perform tests.ok(v_count = 0, 'an owner without MFA sees no signals');
  perform tests.clear_auth();
  reset role;
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_count from public.team_signal where user_id = v_staff;
  perform tests.ok(v_count > 0, 'an admin with MFA sees the staff member''s signals');
  perform tests.clear_auth();
  reset role;

  -- Settings: owners and admins with MFA change them; nobody else does.
  perform tests.authenticate(v_admin, 'aal2');
  insert into public.team_signal_settings (organization_id, overdue_count)
  values (v_org, 4)
  on conflict (organization_id) do update set overdue_count = 4;
  perform tests.clear_auth();
  reset role;
  select overdue_count into v_count from public.team_signal_settings where organization_id = v_org;
  perform tests.ok(v_count = 4, 'an admin with MFA saves the thresholds');

  perform tests.authenticate(v_staff, 'aal2');
  update public.team_signal_settings set overdue_count = 9 where organization_id = v_org;
  select overdue_count into v_count from public.team_signal_settings where organization_id = v_org;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_count = 4, 'staff can read the thresholds but not change them');

  perform tests.authenticate(v_owner, 'aal1');
  update public.team_signal_settings set overdue_count = 9 where organization_id = v_org;
  perform tests.clear_auth();
  reset role;
  select overdue_count into v_count from public.team_signal_settings where organization_id = v_org;
  perform tests.ok(v_count = 4, 'an owner without MFA cannot change the thresholds');

  perform tests.authenticate(v_volunteer, 'aal2');
  select count(*) into v_count from public.team_signal_settings;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_count = 0, 'volunteers cannot read the thresholds');

  begin
    update public.team_signal_settings set overdue_count = 0 where organization_id = v_org;
    perform tests.ok(false, 'a threshold below 1 is refused');
  exception when check_violation then
    perform tests.ok(true, 'a threshold below 1 is refused');
  end;

  -- The two jobs are registered and scheduled.
  select count(*) into v_count from public.job_definition
  where name in ('team-signal-reminders', 'team-signal-digest');
  perform tests.ok(v_count = 2, 'both jobs are registered');
  select count(*) into v_count from cron.job
  where jobname in ('team-signal-reminders', 'team-signal-digest');
  perform tests.ok(v_count = 2, 'both jobs are scheduled');
end
$$;

rollback;
