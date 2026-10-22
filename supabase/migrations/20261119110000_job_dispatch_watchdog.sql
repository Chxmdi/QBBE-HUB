-- Job dispatch watchdog and an accurate job health summary.
--
-- app.dispatch_job fires an HTTP call to the app and returns; nothing read the
-- answer. When the app is down, Caddy or TLS is broken, the secret is wrong
-- (403) or the call times out, no job_run row was written, so Admin > Jobs
-- kept showing the last good run. pg_net keeps each answer in
-- net._http_response for a few hours. dispatch_job now records the request id
-- of every call, and a watchdog every five minutes turns each failed answer
-- into a failed job_run row ("Dispatch failed: HTTP 403"), at most one per job
-- per 15 minutes, then forgets answered calls. A call still unanswered after
-- ten minutes (pg_net stuck or down) is recorded as "no answer". A timed-out
-- call whose run the app did start is not a dispatch failure: the run's own
-- row tells the truth.
--
-- Admin > Jobs read the newest 300 runs across all jobs, which on a normal day
-- covers about half an hour: daily jobs read "Never run" and "Failures (24h)"
-- counted half an hour. public.job_health_summary() returns the newest run of
-- every job and its real 24-hour failure count. It runs as the caller, so
-- row-level security on job_run still limits it to administrators.

create table app.job_dispatch (
  request_id bigint primary key,
  job_name text not null,
  dispatched_at timestamptz not null default now()
);
create index job_dispatch_dispatched_at_idx on app.job_dispatch (dispatched_at);
alter table app.job_dispatch enable row level security;
-- Written by dispatch_job and read by the watchdog, both as the owner. No
-- API role may read or write it.
revoke all on table app.job_dispatch from public, anon, authenticated, service_role;

create or replace function app.dispatch_job(p_job_name text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
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

  -- Remembered so the watchdog can read the answer.
  -- pg_net's request ids restart after a crash; a reused id is a new call.
  insert into app.job_dispatch (request_id, job_name) values (v_request, p_job_name)
  on conflict (request_id) do update set job_name = excluded.job_name, dispatched_at = now();

  return v_request;
end;
$function$;
revoke all on function app.dispatch_job(text) from public, anon, authenticated, service_role;

create or replace function app.record_dispatch_failures()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_recorded integer := 0;
  v_row record;
  v_handled bigint[];
begin
  -- Work on a fixed set of calls: an answer pg_net commits while this runs is
  -- left for the next pass instead of being cleared unread.
  select coalesce(array_agg(d.request_id), '{}') into v_handled
  from app.job_dispatch d
  where exists (select 1 from net._http_response r where r.id = d.request_id)
     or d.dispatched_at < now() - interval '10 minutes';

  for v_row in
    select distinct on (d.job_name)
      d.job_name,
      d.dispatched_at,
      case
        when r.id is null then 'Dispatch failed: no answer'
        when r.timed_out then 'Dispatch failed: timed out' || coalesce(' (' || left(r.error_msg, 200) || ')', '')
        when r.status_code is null then 'Dispatch failed: ' || coalesce(left(r.error_msg, 200), 'no answer')
        else 'Dispatch failed: HTTP ' || r.status_code
      end as error
    from app.job_dispatch d
    left join net._http_response r on r.id = d.request_id
    where d.request_id = any (v_handled)
      and (r.id is null or r.timed_out or r.status_code is null or r.status_code not between 200 and 299)
      -- The app started the run (it outlived pg_net's wait): its row is the record.
      and not exists (
        select 1 from public.job_run j
        where j.job_name = d.job_name
          and j.started_at between d.dispatched_at and d.dispatched_at + interval '1 minute'
          and coalesce(j.metadata ->> 'source', '') <> 'dispatch-watchdog'
      )
    order by d.job_name, d.dispatched_at desc
  loop
    if not exists (
      select 1 from public.job_run
      where job_name = v_row.job_name
        and status = 'failed'
        and error like 'Dispatch failed:%'
        and started_at > now() - interval '15 minutes'
    ) and exists (select 1 from public.job_definition where name = v_row.job_name) then
      -- Stamped with the call's time, so a later real run stays the latest.
      insert into public.job_run (job_name, status, started_at, finished_at, error, metadata)
      values (v_row.job_name, 'failed', v_row.dispatched_at, now(), v_row.error,
              jsonb_build_object('source', 'dispatch-watchdog'));
      v_recorded := v_recorded + 1;
    end if;
  end loop;

  delete from app.job_dispatch where request_id = any (v_handled);
  return v_recorded;
end;
$function$;
revoke all on function app.record_dispatch_failures() from public, anon, authenticated, service_role;

select cron.schedule('job-dispatch-watchdog', '*/5 * * * *', 'select app.record_dispatch_failures()');

create or replace function public.job_health_summary()
returns table (
  job_name text,
  last_run_id uuid,
  last_status text,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_duration_ms integer,
  last_processed_count integer,
  last_failed_count integer,
  last_error text,
  last_metadata jsonb,
  failures_24h integer
)
language sql
stable
security invoker
set search_path to ''
as $function$
  select
    d.name,
    l.id, l.status, l.started_at, l.finished_at, l.duration_ms,
    l.processed_count, l.failed_count, l.error, l.metadata,
    (select count(*)::integer from public.job_run f
      where f.job_name = d.name
        and f.started_at >= now() - interval '24 hours'
        and (f.status = 'failed' or f.failed_count > 0))
  from public.job_definition d
  cross join lateral (
    select r.* from public.job_run r
    where r.job_name = d.name
    order by r.started_at desc
    limit 1
  ) l
$function$;
revoke all on function public.job_health_summary() from public, anon;
grant execute on function public.job_health_summary() to authenticated, service_role;
