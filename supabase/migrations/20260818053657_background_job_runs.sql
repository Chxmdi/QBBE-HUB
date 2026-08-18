-- Per-organization execution ledger. Details deliberately contain counters and
-- provider names only; credentials, recipient addresses, and payloads stay out.
create table background_job_run (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  job_name text not null,
  status text not null check (status in ('succeeded', 'failed')),
  details jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  check (char_length(error) <= 1000)
);

create index idx_background_job_run_org_recent
  on background_job_run (organization_id, finished_at desc);

revoke all on table background_job_run from anon, authenticated;
grant select on table background_job_run to authenticated;
alter table background_job_run enable row level security;

create policy background_job_run_admin_read on background_job_run
  for select to authenticated
  using (
    exists (
      select 1
      from organization_membership m
      where m.organization_id = background_job_run.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );
