-- Operator alerts.
--
-- Nothing told anyone when background jobs stopped or kept failing, a queue
-- backed up, webhooks were being refused, or the free-plan database neared
-- its 500 MB limit (it turns read-only there). The ops-watchdog job (every 15
-- minutes) reads this snapshot and notifies the organization's owners and
-- admins in the app and by email, once per condition per day.
--
-- The snapshot is server-only: it reads every job's history and the refusal
-- counters, which no signed-in person may read through the API.

create or replace function public.ops_health_snapshot()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', d.name,
        'schedule', d.schedule,
        'enabled', d.enabled,
        'last_started_at', (select max(r.started_at) from public.job_run r where r.job_name = d.name),
        -- Finished runs that dropped work, newest first, until the first clean one.
        'failures_in_a_row', (
          select count(*) from (
            select r.status = 'failed' or r.failed_count > 0 as bad,
                   bool_and(r.status = 'failed' or r.failed_count > 0)
                     over (order by r.started_at desc rows between unbounded preceding and current row) as streak
            from public.job_run r
            where r.job_name = d.name and r.status <> 'running'
            order by r.started_at desc
            limit 20
          ) s where s.streak
        )
      ) order by d.name)
      from public.job_definition d
    ), '[]'::jsonb),
    'refusals', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', c.bucket, 'count', c.count))
      from public.rate_limit_counter c
      where c.bucket like 'webhook-refused:%'
        and c.window_start >= pg_catalog.date_trunc('hour', pg_catalog.now()) - interval '1 hour'
    ), '[]'::jsonb)
  )
$function$;
revoke all on function public.ops_health_snapshot() from public, anon, authenticated;
grant execute on function public.ops_health_snapshot() to service_role;

insert into public.job_definition (name, description, schedule, queue, enabled, batch_size, max_attempts)
values ('ops-watchdog',
        'Alerts owners and admins when jobs stop or keep failing, queues back up, webhooks are refused, or the database nears its size limit.',
        '*/15 * * * *', null, true, 25, 1)
on conflict (name) do update set description = excluded.description, schedule = excluded.schedule;

select cron.schedule('ops-watchdog', '*/15 * * * *', $$select app.dispatch_job('ops-watchdog')$$);
