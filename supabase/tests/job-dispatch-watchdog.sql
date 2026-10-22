-- Job dispatch watchdog and job health summary (migration 20261119110000).
-- Proves that a scheduler call the app refused or never answered becomes a
-- failed job_run row (at most one per job per 15 minutes), that a successful
-- call does not, and that Admin > Jobs reads the latest run of every job and
-- its real 24-hour failure count whatever the volume of other jobs' runs.
-- Run after qa-users.sql and rls.sql. All changes are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_count int;
  v_error text;
  v_row record;
begin
  delete from public.job_run;
  delete from app.job_dispatch;

  -- A refused call (HTTP 403), a timed-out call and a successful call.
  insert into app.job_dispatch (request_id, job_name, dispatched_at) values
    (-9001, 'scan-documents', now() - interval '2 minutes'),
    (-9002, 'apply-retention', now() - interval '2 minutes'),
    (-9003, 'drain-notifications', now() - interval '2 minutes');
  insert into net._http_response (id, status_code, timed_out, error_msg, created) values
    (-9001, 403, false, null, now() - interval '1 minute'),
    (-9002, null, true, 'Timeout of 55000 ms reached', now() - interval '1 minute'),
    (-9003, 200, false, null, now() - interval '1 minute');

  perform app.record_dispatch_failures();

  select error into v_error from public.job_run where job_name = 'scan-documents' and status = 'failed';
  perform tests.ok(v_error = 'Dispatch failed: HTTP 403', format('a refused call is recorded as failed (%s)', coalesce(v_error, 'none')));
  select error into v_error from public.job_run where job_name = 'apply-retention' and status = 'failed';
  perform tests.ok(v_error like 'Dispatch failed: timed out%', format('a timed-out call is recorded as failed (%s)', coalesce(v_error, 'none')));
  select count(*) into v_count from public.job_run where job_name = 'drain-notifications';
  perform tests.ok(v_count = 0, 'a successful call writes nothing');

  -- A second refusal within 15 minutes adds no row.
  insert into app.job_dispatch (request_id, job_name, dispatched_at) values (-9004, 'scan-documents', now() - interval '1 minute');
  insert into net._http_response (id, status_code, timed_out, created) values (-9004, 403, false, now());
  perform app.record_dispatch_failures();
  select count(*) into v_count from public.job_run where job_name = 'scan-documents';
  perform tests.ok(v_count = 1, format('one failed row per job per 15 minutes (%s)', v_count));

  -- Handled dispatches are not read twice.
  select count(*) into v_count from app.job_dispatch where request_id in (-9001, -9002, -9003, -9004);
  perform tests.ok(v_count = 0, 'answered dispatches are cleared');

  -- A call that timed out while the app ran the job is not a failure; a call
  -- nobody answered for ten minutes is.
  delete from public.job_run;
  insert into app.job_dispatch (request_id, job_name, dispatched_at) values
    (-9005, 'apply-retention', now() - interval '3 minutes'),
    (-9006, 'vms-sync', now() - interval '11 minutes');
  insert into net._http_response (id, status_code, timed_out, error_msg, created)
  values (-9005, null, true, 'Timeout of 55000 ms reached', now() - interval '2 minutes');
  insert into public.job_run (job_name, status, started_at, finished_at)
  values ('apply-retention', 'succeeded', now() - interval '3 minutes' + interval '1 second', now() - interval '2 minutes');
  perform app.record_dispatch_failures();
  select count(*) into v_count from public.job_run where job_name = 'apply-retention' and status = 'failed';
  perform tests.ok(v_count = 0, 'a slow run that the app started is not reported as a failed dispatch');
  select error into v_error from public.job_run where job_name = 'vms-sync';
  perform tests.ok(v_error = 'Dispatch failed: no answer', format('an unanswered call is recorded (%s)', coalesce(v_error, 'none')));

  -- A reused request id is tracked as the new call.
  insert into app.job_dispatch (request_id, job_name, dispatched_at) values (-9007, 'vms-sync', now() - interval '30 minutes');
  insert into app.job_dispatch (request_id, job_name) values (-9007, 'scan-receipts')
  on conflict (request_id) do update set job_name = excluded.job_name, dispatched_at = now();
  perform tests.ok((select job_name from app.job_dispatch where request_id = -9007) = 'scan-receipts',
    'a reused request id belongs to the newest call');

  -- Only the database itself runs the watchdog.
  perform tests.ok(not has_function_privilege('authenticated', 'app.record_dispatch_failures()', 'execute')
      and not has_function_privilege('anon', 'app.record_dispatch_failures()', 'execute')
      and not has_function_privilege('service_role', 'app.record_dispatch_failures()', 'execute'),
    'no API role can run the watchdog');
  perform tests.ok(not has_table_privilege('authenticated', 'app.job_dispatch', 'select')
      and not has_table_privilege('anon', 'app.job_dispatch', 'select'),
    'no API role reads the dispatch log');
  perform tests.ok(exists (select 1 from cron.job where jobname = 'job-dispatch-watchdog' and schedule = '*/5 * * * *'),
    'the watchdog runs every five minutes');

  -- Health summary: a day of per-minute runs must not hide a daily failure.
  delete from public.job_run;
  insert into public.job_run (job_name, status, started_at, finished_at)
  select 'drain-notifications', 'succeeded', now() - make_interval(mins => g), now() - make_interval(mins => g)
  from generate_series(1, 1440) g;
  insert into public.job_run (job_name, status, started_at, finished_at, error) values
    ('apply-retention', 'failed', now() - interval '10 hours', now() - interval '10 hours', 'boom'),
    ('apply-retention', 'failed', now() - interval '30 hours', now() - interval '30 hours', 'older');

  perform tests.authenticate(v_owner);
  set local role authenticated;
  select * into v_row from public.job_health_summary() where job_name = 'apply-retention';
  reset role;
  perform tests.ok(v_row.last_status = 'failed' and v_row.failures_24h = 1,
    format('the daily job shows its failed run and one failure in 24 hours (%s, %s)', v_row.last_status, v_row.failures_24h));

  perform tests.authenticate(v_owner);
  set local role authenticated;
  select count(*) into v_count from public.job_health_summary();
  reset role;
  perform tests.ok(v_count = 2, format('one row per job that has run (%s)', v_count));

  -- Row-level security still decides: staff see nothing.
  perform tests.authenticate(v_staff);
  set local role authenticated;
  select count(*) into v_count from public.job_health_summary();
  reset role;
  perform tests.ok(v_count = 0, 'staff read no job health');
  perform tests.ok(not has_function_privilege('anon', 'public.job_health_summary()', 'execute'),
    'signed-out visitors cannot call job_health_summary');
end;
$$;

rollback;
