-- QBBE Hub — quieten the unconfigured-runner signal.
--
-- 0008 recorded a failed `job_run` every time a job fired before an
-- administrator had pointed the database at a deployment. Correct, but
-- `drain-notifications` fires every minute, so a database waiting to be wired
-- up produced 1,440 identical rows a day and buried real failures in Admin →
-- Jobs.
--
-- The condition still has to be visible — an operator must be able to see that
-- nothing is running and why — so it is recorded at most once an hour per job
-- instead of being dropped.

create or replace function app.dispatch_job(p_job_name text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_endpoint text;
  v_secret   text;
  v_enabled  boolean;
  v_request  bigint;
begin
  select enabled into v_enabled from job_definition where name = p_job_name;
  if v_enabled is distinct from true then
    return null;                          -- unknown or disabled: nothing to do
  end if;

  v_endpoint := app.job_setting('qbbe_job_endpoint');
  v_secret   := app.job_setting('qbbe_job_secret');

  if v_endpoint is null or v_secret is null then
    -- Report the misconfiguration, but at most hourly per job: the state is
    -- persistent, so repeating it every minute is noise, not information.
    if not exists (
      select 1 from job_run
      where job_name = p_job_name
        and status = 'failed'
        and error like 'Job runner is not configured%'
        and started_at > now() - interval '1 hour'
    ) then
      insert into job_run (job_name, status, finished_at, error)
      values (p_job_name, 'failed', now(),
              'Job runner is not configured. Run app.configure_job_runner(url, secret).');
    end if;
    return null;
  end if;

  select net.http_post(
    url := rtrim(v_endpoint, '/') || '/api/jobs/' || p_job_name,
    body := jsonb_build_object('job', p_job_name, 'trigger', 'cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-job-secret', v_secret
    ),
    timeout_milliseconds := 55000
  ) into v_request;

  return v_request;
end;
$$;

revoke all on function app.dispatch_job(text) from public, anon, authenticated;

-- Index supporting the hourly check above and the Admin panel's failure list.
create index if not exists idx_job_run_recent_failures
  on job_run (job_name, started_at desc) where status = 'failed';
