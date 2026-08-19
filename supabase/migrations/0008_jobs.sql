-- QBBE Hub — background job runtime (W1).
--
-- The database is both the scheduler and the queue: pg_cron ticks, pgmq holds
-- work, pg_net calls the application's job endpoint. There is no extra service
-- to operate, and a job's schedule lives in the same place as its data.
--
-- Delivery semantics (JOB-003): pgmq is at-least-once. Exactly-once *effects*
-- come from the handlers, which key every side effect on a dedupe key backed
-- by a unique index. A worker that dies mid-run leaves its message on the
-- queue; the visibility timeout re-delivers it, and the handler recognises the
-- already-recorded effect instead of repeating it.
--
-- Times below are UTC, because pg_cron evaluates in UTC. Jobs whose timing is
-- per-person (the digest) run hourly and compare against the recipient's own
-- timezone, so they stay correct across daylight saving.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgmq;

-- ---------------------------------------------------------------------------
-- Queues. One per failure domain, so a stuck integration cannot block mail.
-- ---------------------------------------------------------------------------
do $$
declare
  q text;
begin
  foreach q in array array['notifications', 'integrations', 'exports'] loop
    if not exists (select 1 from pgmq.list_queues() l where l.queue_name = q) then
      perform pgmq.create(q);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Job registry. These rows are the source of truth for what runs and when;
-- the Admin → Jobs panel reads this table rather than a hard-coded list, and
-- the cron entries below are generated from it so the two cannot drift.
-- ---------------------------------------------------------------------------
create table job_definition (
  name text primary key,
  description text not null,
  schedule text not null,                       -- five-field cron expression, UTC
  queue text,                                   -- null when the job is not queue-backed
  enabled boolean not null default true,
  batch_size int not null default 25 check (batch_size between 1 and 1000),
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table job_definition is
  'Scheduled background jobs. The runtime refuses any job name absent from here.';

create table job_run (
  id uuid primary key default gen_random_uuid(),
  job_name text not null references job_definition (name) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int,
  processed_count int not null default 0,
  failed_count int not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  constraint finished_runs_have_a_timestamp
    check (status = 'running' or finished_at is not null)
);

create index idx_job_run_name on job_run (job_name, started_at desc);
create index idx_job_run_failures on job_run (started_at desc) where status = 'failed';

comment on table job_run is
  'One row per job execution. Admin → Jobs and alerting read from here.';

create trigger job_definition_set_updated_at
  before update on job_definition
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Access. Job telemetry is administrative: readable by admins, written only by
-- the service role (which bypasses RLS). No policy grants an end user write
-- access, so from the application's side these tables are append-only.
-- ---------------------------------------------------------------------------
alter table job_definition enable row level security;
alter table job_run enable row level security;

create policy job_definition_admin_read on job_definition
  for select using (app.is_admin());

create policy job_run_admin_read on job_run
  for select using (app.is_admin());

-- ---------------------------------------------------------------------------
-- Queue access for the worker.
--
-- pgmq lives in its own schema, which PostgREST does not expose. These
-- wrappers put a narrow, named surface in `public` and hand it to the service
-- role only — `anon` and `authenticated` are explicitly revoked, so a browser
-- session holding the publishable key can neither read nor write the queues.
-- ---------------------------------------------------------------------------
create or replace function public.job_queue_send(
  p_queue text,
  p_message jsonb,
  p_delay_seconds int default 0
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  select s into v_id from pgmq.send(p_queue, p_message, p_delay_seconds) s;
  return v_id;
end;
$$;

create or replace function public.job_queue_read(
  p_queue text,
  p_visibility_seconds int default 60,
  p_quantity int default 20
)
returns table (
  msg_id bigint,
  read_ct int,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message
    from pgmq.read(p_queue, p_visibility_seconds, p_quantity) m;
end;
$$;

create or replace function public.job_queue_delete(p_queue text, p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce(pgmq.delete(p_queue, p_msg_id), false);
end;
$$;

create or replace function public.job_queue_archive(p_queue text, p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce(pgmq.archive(p_queue, p_msg_id), false);
end;
$$;

-- Queue depth, oldest pending age and dead-letter count in one call, so the
-- Admin panel never needs direct access to pgmq (JOB-004).
create or replace function public.job_queue_health()
returns table (
  queue_name text,
  queue_length bigint,
  visible_length bigint,
  oldest_message_age_seconds int,
  total_messages bigint,
  archived_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  q text;
  v_archived bigint;
begin
  for q in select l.queue_name::text from pgmq.list_queues() l order by 1 loop
    execute format('select count(*) from pgmq.a_%I', q) into v_archived;
    return query
      select m.queue_name::text,
             m.queue_length,
             m.queue_visible_length,
             m.oldest_msg_age_sec,
             m.total_messages,
             v_archived
      from pgmq.metrics(q) m;
  end loop;
end;
$$;

-- Most recent dead-lettered payloads, for the Admin panel's failure drill-down.
create or replace function public.job_queue_dead_letters(p_limit int default 20)
returns table (
  queue_name text,
  msg_id bigint,
  read_ct int,
  enqueued_at timestamptz,
  archived_at timestamptz,
  message jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  q text;
begin
  for q in select l.queue_name::text from pgmq.list_queues() l order by 1 loop
    return query execute format(
      'select %L::text, a.msg_id, a.read_ct, a.enqueued_at, a.archived_at, a.message
         from pgmq.a_%I a
        order by a.archived_at desc
        limit %s',
      q, q, greatest(p_limit, 1)
    );
  end loop;
end;
$$;

revoke all on function public.job_queue_send(text, jsonb, int) from public, anon, authenticated;
revoke all on function public.job_queue_read(text, int, int) from public, anon, authenticated;
revoke all on function public.job_queue_delete(text, bigint) from public, anon, authenticated;
revoke all on function public.job_queue_archive(text, bigint) from public, anon, authenticated;
revoke all on function public.job_queue_health() from public, anon, authenticated;
revoke all on function public.job_queue_dead_letters(int) from public, anon, authenticated;

grant execute on function public.job_queue_send(text, jsonb, int) to service_role;
grant execute on function public.job_queue_read(text, int, int) to service_role;
grant execute on function public.job_queue_delete(text, bigint) to service_role;
grant execute on function public.job_queue_archive(text, bigint) to service_role;
grant execute on function public.job_queue_health() to service_role;
grant execute on function public.job_queue_dead_letters(int) to service_role;

-- Queue metrics have no PostgREST route. Admin → Jobs reads them through the
-- service role behind its own `requireAdmin()` gate; row data on that page is
-- still read as the signed-in administrator, with RLS deciding. (0011 removed
-- the signed-in wrappers this file originally shipped.)

-- ---------------------------------------------------------------------------
-- Dispatch. pg_cron holds no secrets: it calls app.dispatch_job, which reads
-- the endpoint and shared secret out of Vault at run time. Rotating either one
-- therefore needs no re-scheduling (ENV-003).
-- ---------------------------------------------------------------------------
create or replace function app.job_setting(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_value text;
begin
  select decrypted_secret into v_value
  from vault.decrypted_secrets
  where name = p_name
  limit 1;
  return v_value;
end;
$$;

revoke all on function app.job_setting(text) from public, anon, authenticated;

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
    -- Not configured yet. Record it, so the omission is visible in Admin
    -- instead of failing silently every minute.
    insert into job_run (job_name, status, finished_at, error)
    values (p_job_name, 'failed', now(),
            'Job runner is not configured. Run app.configure_job_runner(url, secret).');
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

-- One command wires a deployed environment to its scheduler. Documented in
-- docs/runbooks/jobs.md and run once per environment by an administrator.
create or replace function app.configure_job_runner(p_base_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  if p_base_url !~ '^https?://' then
    raise exception 'base url must include a scheme';
  end if;
  if length(coalesce(p_secret, '')) < 32 then
    raise exception 'job secret must be at least 32 characters';
  end if;

  select id into v_id from vault.secrets where name = 'qbbe_job_endpoint';
  if v_id is null then
    perform vault.create_secret(p_base_url, 'qbbe_job_endpoint',
      'Base URL of the QBBE Hub deployment that runs scheduled jobs');
  else
    perform vault.update_secret(v_id, p_base_url);
  end if;

  select id into v_id from vault.secrets where name = 'qbbe_job_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'qbbe_job_secret',
      'Shared secret sent as x-job-secret to the job endpoint');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
end;
$$;

revoke all on function app.configure_job_runner(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The schedule. Every recurring behaviour the product promises lives here.
-- ---------------------------------------------------------------------------
insert into job_definition (name, description, schedule, queue, batch_size, max_attempts)
values
  ('drain-notifications',
   'Delivers queued notification email and records every attempt.',
   '* * * * *', 'notifications', 25, 5),

  ('retry-failed-emails',
   'Recovers deliveries left in flight by a crashed run and retries transient failures with backoff.',
   '*/15 * * * *', 'notifications', 50, 5),

  ('daily-digest',
   'Builds and queues each person''s digest of unread notifications at their own local digest hour.',
   '0 * * * *', 'notifications', 200, 3),

  ('announcement-nudge',
   'Reminds people who have not acknowledged a required announcement.',
   '0 13 * * *', 'notifications', 200, 3),

  ('due-date-reminders',
   'Notifies assignees of tasks due today, due tomorrow, or overdue.',
   '0 12 * * *', 'notifications', 500, 3),

  ('stale-project-sweep',
   'Flags active projects with no activity in fourteen days to their lead.',
   '0 10 * * 1', 'notifications', 200, 3),

  ('purge-job-history',
   'Trims job_run history and archived queue messages past retention.',
   '0 6 * * *', null, 1, 3)
on conflict (name) do nothing;

do $$
declare
  j record;
begin
  for j in select name, schedule from job_definition loop
    perform cron.unschedule(j.name)
      where exists (select 1 from cron.job c where c.jobname = j.name);
    perform cron.schedule(j.name, j.schedule,
      format('select app.dispatch_job(%L)', j.name));
  end loop;
end;
$$;
