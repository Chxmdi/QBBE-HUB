-- QBBE Hub — data exports that run in the background and expire.
--
-- The CSV and PDF routes answer inside a request because a single report is
-- small. The exports people actually ask for are not: "everything we hold
-- about this volunteer" for a subject access request, or "the whole
-- organization" before a funding audit. Those cannot finish inside a request
-- timeout, and building them synchronously would mean a spinner that dies.
--
-- So an export is a job: requested here, run by the existing job runtime,
-- written to a private bucket, and handed back as a short-lived signed URL.
--
-- The part that matters is not the queueing. An export is a copy of the most
-- sensitive data the organization holds, sitting outside every row-level
-- policy that normally protects it — a file, in a bucket, that anyone with the
-- link can read. So the record carries the things a data protection officer
-- will ask for: who asked, who it is about, when it expires, and how many
-- times it has been downloaded since.

create type export_kind as enum (
  'organization_data',
  'person_data',
  'crm_contacts',
  'task_history',
  'report_bundle'
);

create type export_status as enum ('queued', 'running', 'ready', 'failed', 'expired');

create table export_job (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  kind export_kind not null,
  requested_by uuid not null references user_profile (id),
  -- For a subject access request: the person the export is about, who is very
  -- often not the person who asked for it.
  subject_user_id uuid references user_profile (id),
  params jsonb not null default '{}'::jsonb,

  status export_status not null default 'queued',
  started_at timestamptz,
  completed_at timestamptz,

  -- The object inside the private `exports` bucket. Never a URL: a URL in a
  -- column outlives the signature that made it safe.
  storage_path text,
  byte_size bigint,
  row_count int,
  error text,

  -- An export expires whether or not anybody remembers it exists. Seven days
  -- is long enough to fetch a file and short enough that a forgotten copy of
  -- the volunteer database does not sit in a bucket for a year.
  expires_at timestamptz not null default now() + interval '7 days',
  downloaded_at timestamptz,
  download_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A ready export without a file is a download that 404s.
  constraint ready_exports_have_a_file check (
    status <> 'ready' or storage_path is not null
  ),
  -- A failure that says nothing leaves an administrator with no next step.
  constraint failed_exports_say_why check (status <> 'failed' or error is not null),
  constraint finished_exports_have_a_time check (
    status in ('queued', 'running') or completed_at is not null
  ),
  -- An export about a person has to name the person.
  constraint person_exports_name_a_subject check (
    kind <> 'person_data' or subject_user_id is not null
  ),
  constraint downloads_are_not_negative check (download_count >= 0)
);

create index idx_export_job_queue on export_job (status, created_at)
  where status in ('queued', 'running');
create index idx_export_job_mine on export_job (requested_by, created_at desc);
create index idx_export_job_org on export_job (organization_id, created_at desc);
-- The sweep's index: what is ready and past its date.
create index idx_export_job_expiring on export_job (expires_at)
  where status = 'ready';

create trigger trg_export_job_updated_at before update on export_job
  for each row execute function set_updated_at();

comment on table export_job is
  'A background data export: who asked, who it is about, when it expires, and how often it was fetched.';
comment on column export_job.storage_path is
  'Object path in the private exports bucket. Signed URLs are minted per download and never stored.';
comment on column export_job.download_count is
  'Every fetch is counted, because "who took a copy of this" is the question asked after an incident.';

alter table export_job enable row level security;

-- You can see what you asked for; an administrator can see everything the
-- organization has exported. A person_data export is visible to its subject
-- too — being told what was extracted about you is the point of the right.
create policy export_job_read on export_job for select to authenticated
  using (
    requested_by = auth.uid()
    or subject_user_id = auth.uid()
    or app.is_org_admin(organization_id)
  );

-- Staff may export the operational sets; only an administrator may export
-- everything, or anything about a named person.
create policy export_job_request on export_job for insert to authenticated
  with check (
    requested_by = auth.uid()
    and (
      (app.is_org_staff(organization_id)
        and kind in ('crm_contacts', 'task_history', 'report_bundle'))
      or app.is_org_admin(organization_id)
    )
  );

-- Nobody edits an export by hand. The runner writes through the service role,
-- which bypasses these policies; a person changing `status` to 'ready' or
-- pushing `expires_at` out is not a thing the product should allow.
-- Deliberately no update or delete policy.

-- ---------------------------------------------------------------------------
-- The private bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

-- No read, insert, update or delete policy for `authenticated` on this bucket.
-- Exports are written by the job runner and read through signed URLs minted
-- server-side after the export_job row has been checked. An obscure path is
-- never authorization, and here it is not even reachable.

-- Why there is no download-counting function here.
--
-- The obvious shape — a SECURITY INVOKER function that bumps the counter —
-- cannot work: with no update policy on this table, its UPDATE matches zero
-- rows and the count silently stays at zero. Making it SECURITY DEFINER would
-- work but adds a privileged entry point to the API surface for something the
-- application already has to do privileged work for: the exports bucket has no
-- policies at all, so only the service role can mint a signed URL for an
-- object in it. The permission check and the counter therefore live together
-- in the download route, next to the thing they guard.

-- ---------------------------------------------------------------------------
-- Registration with the job runtime
-- ---------------------------------------------------------------------------

insert into job_definition (name, description, schedule, queue, enabled, batch_size, max_attempts)
values
  ('run-exports',
   'Builds queued data exports and writes them to the private exports bucket.',
   '*/5 * * * *', 'exports', true, 3, 3),
  ('expire-exports',
   'Expires exports past their date and deletes the files behind them.',
   '17 3 * * *', null, true, 100, 3)
on conflict (name) do update
  set description = excluded.description,
      schedule = excluded.schedule,
      queue = excluded.queue;

-- Registering a definition is not enough: the cron entry is what actually
-- fires it. Same shape as the integration jobs, so a job added here behaves
-- exactly like the ones already running.
do $$
declare
  j record;
begin
  for j in
    select name, schedule from job_definition
    where name in ('run-exports', 'expire-exports')
  loop
    perform cron.unschedule(j.name)
      where exists (select 1 from cron.job c where c.jobname = j.name);
    perform cron.schedule(j.name, j.schedule,
      format('select app.dispatch_job(%L)', j.name));
  end loop;
end;
$$;
