-- Operator alerts (migration 20261119120000). Proves ops_health_snapshot()
-- reports what the ops-watchdog job alerts on (database size, each job's last
-- start and failures in a row, refused webhook calls in the last hour), that
-- only the service role may read it, and that the job is registered and
-- scheduled every 15 minutes. Run after qa-users.sql and rls.sql. All changes
-- are rolled back.
begin;

do $$
declare
  v_snapshot jsonb;
  v_job jsonb;
begin
  delete from public.job_run where job_name in ('scan-documents', 'apply-retention');
  insert into public.job_run (job_name, status, started_at, finished_at, error) values
    ('scan-documents', 'failed', now() - interval '3 minutes', now(), 'one'),
    ('scan-documents', 'failed', now() - interval '2 minutes', now(), 'two'),
    ('scan-documents', 'failed', now() - interval '1 minute', now(), 'three'),
    ('apply-retention', 'failed', now() - interval '2 days', now(), 'old'),
    ('apply-retention', 'succeeded', now() - interval '1 day', now(), null);
  insert into public.rate_limit_counter (bucket, window_start, count)
  values ('webhook-refused:zeffy_webhook:signature_invalid', date_trunc('hour', now()), 12);

  set local role service_role;
  v_snapshot := public.ops_health_snapshot();
  reset role;

  perform tests.ok((v_snapshot ->> 'database_bytes')::bigint > 0, 'the snapshot reports the database size');
  select j into v_job from jsonb_array_elements(v_snapshot -> 'jobs') j where j ->> 'name' = 'scan-documents';
  perform tests.ok((v_job ->> 'failures_in_a_row')::int = 3, format('three failures in a row are counted (%s)', v_job ->> 'failures_in_a_row'));
  select j into v_job from jsonb_array_elements(v_snapshot -> 'jobs') j where j ->> 'name' = 'apply-retention';
  perform tests.ok((v_job ->> 'failures_in_a_row')::int = 0 and v_job ->> 'last_started_at' is not null,
    'a success ends the run of failures');
  perform tests.ok(exists (
      select 1 from jsonb_array_elements(v_snapshot -> 'refusals') r
      where r ->> 'bucket' = 'webhook-refused:zeffy_webhook:signature_invalid' and (r ->> 'count')::int = 12),
    'refused webhook calls in the last hour are reported');

  perform tests.ok(not has_function_privilege('anon', 'public.ops_health_snapshot()', 'execute')
      and not has_function_privilege('authenticated', 'public.ops_health_snapshot()', 'execute')
      and has_function_privilege('service_role', 'public.ops_health_snapshot()', 'execute'),
    'only the service role reads the operations snapshot');
  perform tests.ok(exists (select 1 from public.job_definition where name = 'ops-watchdog' and enabled and schedule = '*/15 * * * *'),
    'the ops-watchdog job is registered');
  perform tests.ok(exists (select 1 from cron.job where jobname = 'ops-watchdog' and schedule = '*/15 * * * *'),
    'the ops-watchdog job is scheduled every 15 minutes');
end;
$$;

rollback;
