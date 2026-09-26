-- Gmail Pub/Sub pushes need a durable worker, not a 15-minute polling delay.
-- The webhook writes a queue message and asks the worker to run immediately;
-- this one-minute schedule is the recovery path if the web process dies after
-- acknowledging Pub/Sub but before the post-response worker starts.

insert into job_definition (name, description, schedule, queue, batch_size, max_attempts)
values (
  'gmail-push-sync',
  'Reconciles Gmail history immediately after authenticated Pub/Sub push notifications.',
  '* * * * *',
  'integrations',
  25,
  5
)
on conflict (name) do update set
  description = excluded.description,
  schedule = excluded.schedule,
  queue = excluded.queue,
  batch_size = excluded.batch_size,
  max_attempts = excluded.max_attempts,
  enabled = true;

do $block$
begin
  perform cron.unschedule('gmail-push-sync')
    where exists (select 1 from cron.job where jobname = 'gmail-push-sync');
  perform cron.schedule(
    'gmail-push-sync',
    '* * * * *',
    $$select app.dispatch_job('gmail-push-sync')$$
  );
end;
$block$;
