-- QBBE Hub — keep job logs from filling the database, and schedule the two
-- jobs that never ran.
--
-- OPS-001. pg_cron writes one row to cron.job_run_details for every run of
-- every scheduled job, about 12,700 rows (4 MB) a day, and nothing ever
-- deleted them. On Supabase's Free plan the database turns read-only at
-- 500 MB, which these logs alone would reach in roughly three months, after
-- which every write in the Hub fails for everyone. A daily cron entry now
-- deletes history older than 7 days. It is plain SQL inside the database
-- rather than an app job, so it keeps working even when the app's job runner
-- is the thing that is broken (which is exactly when failures pile up).
-- The app-side retention (public.job_run and public.background_job_run) is in
-- src/features/jobs/services/handlers/purge-job-history.ts.
--
-- REL-009. retry-workflow-executions (20260926050000) and
-- decision-revisit-reminders (20261105110200) were registered in
-- job_definition, and have handlers, but neither migration called
-- cron.schedule, so neither ever ran: failed workflow notifications were saved
-- for a retry that never came. Rather than naming the two, this schedules
-- every registered job that has no cron entry dispatching it, the same way
-- 20260819165607_jobs.sql generated the first entries, so any other gap of
-- the same kind is closed too. Jobs that already have an entry are left as
-- they are. supabase/tests/job-schedules.sql now checks the registry and
-- pg_cron agree in both directions.

-- ---------------------------------------------------------------------------
-- 1. Schedule every registered job that nothing dispatches (REL-009).
-- ---------------------------------------------------------------------------
do $$
declare
  j record;
begin
  for j in
    select d.name, d.schedule
    from public.job_definition d
    where not exists (
      select 1 from cron.job c
      where c.command = format('select app.dispatch_job(%L)', d.name))
    order by d.name
  loop
    perform cron.schedule(j.name, j.schedule,
      format('select app.dispatch_job(%L)', j.name));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Trim pg_cron's own run history daily (OPS-001).
-- ---------------------------------------------------------------------------
-- 05:47 UTC: off the hour, and before purge-job-history at 06:00.
-- coalesce covers a run that never recorded an end time.
do $$
begin
  perform cron.unschedule('purge-cron-history')
    where exists (select 1 from cron.job where jobname = 'purge-cron-history');
  perform cron.schedule('purge-cron-history', '47 5 * * *',
    $cmd$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days'$cmd$);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Say what purge-job-history now keeps (shown in Admin > Jobs).
-- ---------------------------------------------------------------------------
-- Same text as jobs.descriptions in src/lib/i18n/messages/workspace/ops.en.ts.
update public.job_definition
set description = 'Trims job history past retention: successful runs after 7 days '
  || '(1 day if they did nothing), failed runs after 180 days, always keeping each '
  || 'job''s latest run. Also trims old job records, sent email records and '
  || 'rate-limit counters.'
where name = 'purge-job-history';
