-- Job schedules and cron history retention (migration 20261119010000).
--
-- REL-009: two registered jobs (retry-workflow-executions,
-- decision-revisit-reminders) had a job_definition row and a handler but no
-- cron entry, so they never ran while Admin > Jobs showed them as enabled.
-- These checks hold the registry and pg_cron in step in both directions.
--
-- OPS-001: pg_cron logs every run in cron.job_run_details and nothing deleted
-- them, about 4 MB a day on a 500 MB free database. A daily cron entry now
-- trims anything older than 7 days.
--
-- Run after qa-users.sql and rls.sql. All changes are rolled back.
begin;

do $$
declare
  v_missing text;
  v_doubled text;
  v_orphans text;
  v_command text;
  v_old bigint;
begin
  -- Every enabled job has exactly one cron entry that dispatches it.
  select string_agg(d.name, ', ' order by d.name) into v_missing
  from public.job_definition d
  where d.enabled
    and not exists (
      select 1 from cron.job c
      where c.command = format('select app.dispatch_job(%L)', d.name));
  perform tests.ok(v_missing is null,
    format('every enabled job is scheduled (missing: %s)', coalesce(v_missing, 'none')));

  select string_agg(d.name, ', ' order by d.name) into v_doubled
  from public.job_definition d
  where (select count(*) from cron.job c
         where c.command = format('select app.dispatch_job(%L)', d.name)) > 1;
  perform tests.ok(v_doubled is null,
    format('no job is scheduled twice (doubled: %s)', coalesce(v_doubled, 'none')));

  -- Every cron entry that dispatches a job dispatches one that exists.
  select string_agg(c.jobname, ', ' order by c.jobname) into v_orphans
  from cron.job c
  where c.command ilike '%app.dispatch_job(%'
    and not exists (
      select 1 from public.job_definition d
      where c.command = format('select app.dispatch_job(%L)', d.name));
  perform tests.ok(v_orphans is null,
    format('every dispatch_job cron entry has a job definition (orphans: %s)',
      coalesce(v_orphans, 'none')));

  -- The two jobs REL-009 found, by name, so the checks above cannot pass by
  -- both lists being empty.
  perform tests.ok(
    (select count(*) from cron.job
     where command in ('select app.dispatch_job(''retry-workflow-executions'')',
                       'select app.dispatch_job(''decision-revisit-reminders'')')) = 2,
    'retry-workflow-executions and decision-revisit-reminders are scheduled');

  -- Each cron entry runs on the schedule its definition (and Admin > Jobs) states.
  select string_agg(d.name, ', ' order by d.name) into v_doubled
  from public.job_definition d
  join cron.job c on c.command = format('select app.dispatch_job(%L)', d.name)
  where c.schedule <> d.schedule;
  perform tests.ok(v_doubled is null,
    format('cron schedules match job_definition (drifted: %s)', coalesce(v_doubled, 'none')));

  -- Cron history is trimmed daily.
  select command into v_command from cron.job where jobname = 'purge-cron-history';
  perform tests.ok(v_command is not null, 'purge-cron-history is scheduled');
  perform tests.ok(v_command ilike '%delete from cron.job_run_details%'
                   and v_command ilike '%7 days%',
    'purge-cron-history deletes cron history older than 7 days');

  -- Running its command removes old history and keeps recent history.
  insert into cron.job_run_details
    (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
  values
    (0, -900001, 0, 'postgres', 'postgres', 'select 1', 'succeeded', '1 row',
     now() - interval '9 days', now() - interval '9 days'),
    (0, -900002, 0, 'postgres', 'postgres', 'select 1', 'succeeded', '1 row',
     now() - interval '1 day', now() - interval '1 day');
  execute v_command;
  select count(*) into v_old from cron.job_run_details
  where end_time < now() - interval '8 days';
  perform tests.ok(v_old = 0, format('no cron history older than 8 days is left (%s)', v_old));
  perform tests.ok(exists (select 1 from cron.job_run_details where runid = -900002),
    'recent cron history is kept');
end;
$$;

rollback;
