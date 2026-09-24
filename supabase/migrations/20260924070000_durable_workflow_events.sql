-- Durable workflow events and per-event idempotency.
--
-- Business actions persist a workflow_event before emitting notifications.
-- A failed/pending event is retried by a scheduled worker. workflow_execution
-- becomes one row per rule per durable event rather than one row per invocation.

create table public.workflow_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id) on delete cascade,
  event_key text not null,
  event_type text not null,
  source_type text not null,
  source_id uuid not null,
  actor_id uuid not null references public.user_profile(id),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  attempt integer not null default 0 check (attempt >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (organization_id, event_key)
);

create index workflow_event_retry_idx
  on public.workflow_event (status, created_at)
  where status in ('pending','failed');
create index workflow_event_source_idx
  on public.workflow_event (organization_id, source_type, source_id, created_at desc);

alter table public.workflow_event enable row level security;
create policy workflow_event_actor_read on public.workflow_event
  for select to authenticated
  using (actor_id = auth.uid() or app.is_org_admin(organization_id));
create policy workflow_event_member_insert on public.workflow_event
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and app.is_org_member(organization_id)
  );
create policy workflow_event_actor_update on public.workflow_event
  for update to authenticated
  using (actor_id = auth.uid() or app.is_org_admin(organization_id))
  with check (actor_id = auth.uid() or app.is_org_admin(organization_id));

grant select, insert, update on public.workflow_event to authenticated, service_role;
revoke all on public.workflow_event from anon;

alter table public.workflow_execution
  add column workflow_event_id uuid references public.workflow_event(id) on delete set null,
  add column event_key text;

update public.workflow_execution
set event_key = 'legacy:' || id::text
where event_key is null;

alter table public.workflow_execution alter column event_key set not null;

create unique index workflow_execution_rule_event_key
  on public.workflow_execution (rule_id, event_key);

create index workflow_execution_event_idx
  on public.workflow_execution (workflow_event_id, created_at desc);

comment on column public.workflow_execution.event_key is
  'Stable business-event key used to make rule side effects idempotent across retries.';

insert into public.job_definition (
  name, description, schedule, queue, batch_size, max_attempts
) values (
  'retry-workflows',
  'Retries durable workflow events that did not finish cleanly.',
  '* * * * *',
  null,
  50,
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
  perform cron.unschedule('retry-workflows')
    where exists (select 1 from cron.job where jobname = 'retry-workflows');
  perform cron.schedule(
    'retry-workflows',
    '* * * * *',
    $$select app.dispatch_job('retry-workflows')$$
  );
end;
$block$;
