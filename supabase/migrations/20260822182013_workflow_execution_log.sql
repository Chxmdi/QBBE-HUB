-- QBBE Hub — an audit trail for workflow automation.
--
-- Workflow rules already fire on real events, but nothing recorded what they
-- did. That makes an automation feature unaccountable in exactly the way
-- automation must not be: when someone asks "why did I get this?" or "why
-- didn't this notify anyone?", the honest answer was a shrug.
--
-- One row per rule per triggering event, whether or not it reached anybody.
-- A rule that matched and then found no recipients is the single most useful
-- thing to be able to see, so `skipped` is a first-class outcome rather than
-- an absence of a row.

create table workflow_execution (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  rule_id uuid references workflow_rule (id) on delete set null,
  rule_name text not null,
  trigger_event text not null,
  source_type text not null,
  source_id uuid not null,
  outcome text not null check (outcome in ('notified', 'skipped', 'failed')),
  recipient_count int not null default 0,
  detail text,
  created_at timestamptz not null default now()
);

comment on table workflow_execution is
  'One row per workflow rule per triggering event. Answers "why did this fire?".';
comment on column workflow_execution.outcome is
  'notified = recipients were messaged; skipped = matched but nobody to tell; failed = the action errored.';

create index idx_workflow_execution_org
  on workflow_execution (organization_id, created_at desc);
create index idx_workflow_execution_rule
  on workflow_execution (rule_id, created_at desc);
create index idx_workflow_execution_source
  on workflow_execution (source_type, source_id, created_at desc);

alter table workflow_execution enable row level security;

-- Automation history is administrative: it names who was notified and why.
create policy workflow_execution_admin_read on workflow_execution
  for select to authenticated
  using (app.is_org_admin(organization_id));

-- Written by server actions acting as the signed-in member who caused the
-- event, so members may insert into their own organization and nothing else.
create policy workflow_execution_member_insert on workflow_execution
  for insert to authenticated
  with check (app.is_org_member(organization_id));
