-- QBBE Hub — retention policies, and the things they may not touch.
--
-- Keeping everything forever is a liability; deleting the wrong thing is
-- worse. So this is built around a whitelist rather than a free-form rule
-- engine: `retention_subject` names the record types a policy may govern, and
-- carries a floor below which nobody can set one.
--
-- Why a whitelist. A retention system that can be pointed at any table is a
-- compliance hole waiting for a well-meaning administrator: an audit trail set
-- to thirty days, or funder evidence deleted the year before the audit that
-- needed it. Adding a subject here is a deliberate act by somebody who has
-- thought about whether that record type is safe to lose.
--
-- Why floors are a trigger and not a CHECK. The minimum lives in a row of
-- another table, and a CHECK constraint cannot read one. The trigger below is
-- the honest version of the same rule.
--
-- Everything here is off by default. A policy that started deleting the moment
-- it was created would be a footgun with a compliance report attached.

create type retention_action as enum ('delete', 'anonymise');

-- ---------------------------------------------------------------------------
-- What may be governed, and the floor for each
-- ---------------------------------------------------------------------------

create table retention_subject (
  key text primary key,
  label text not null,
  description text not null,
  -- Nobody may set a policy below this. The numbers are deliberately
  -- conservative: this is the last line before data a charity may need is
  -- gone, and a floor that is too high costs storage while one that is too
  -- low costs evidence.
  minimum_days int not null check (minimum_days >= 1),
  default_days int not null check (default_days >= 1),
  allowed_actions retention_action[] not null,
  -- What the row would say to somebody about to switch it on.
  caution text,

  constraint default_is_not_below_the_floor check (default_days >= minimum_days),
  constraint at_least_one_action check (array_length(allowed_actions, 1) >= 1)
);

comment on table retention_subject is
  'The whitelist. A retention policy may only govern a record type named here.';
comment on column retention_subject.minimum_days is
  'The floor. Enforced by trigger, because a CHECK cannot read another table.';

alter table retention_subject enable row level security;

-- Reference data: every signed-in member may read it, nobody may change it
-- from the application. Adding a subject is a migration, which is the point.
create policy retention_subject_read on retention_subject for select to authenticated
  using (true);

insert into retention_subject
  (key, label, description, minimum_days, default_days, allowed_actions, caution)
values
  ('activity_event',
   'Activity feed',
   'Who did what, shown on project and program timelines. Operational noise once it is old.',
   90, 365, array['delete']::retention_action[],
   'Project timelines lose their older entries. Nothing else depends on them.'),

  ('notification',
   'Notifications',
   'In-app alerts. Once read and old, they are of no use to anyone.',
   30, 180, array['delete']::retention_action[],
   'Only affects the bell menu and its history.'),

  ('crm_interaction',
   'CRM interaction notes',
   'Meetings, calls and notes recorded against a funder or partner.',
   730, 1825, array['delete', 'anonymise']::retention_action[],
   'Relationship continuity depends on these. Anonymising keeps the fact of contact and removes what was said.'),

  ('export_job',
   'Export records',
   'The log of who exported what. The files are deleted after seven days regardless; this is the record.',
   365, 1095, array['delete']::retention_action[],
   'This is the answer to "who took a copy". Keep it longer than you think you need.'),

  ('audit_event',
   'Audit trail',
   'Administrative actions: role changes, approvals, exports, sign-ins.',
   2190, 2555, array['delete']::retention_action[],
   'Six years is the floor here on purpose. Charity records are commonly required for that long, and an audit trail is the first thing an investigation asks for.')
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      minimum_days = excluded.minimum_days,
      default_days = excluded.default_days,
      allowed_actions = excluded.allowed_actions,
      caution = excluded.caution;

-- ---------------------------------------------------------------------------
-- The policies themselves
-- ---------------------------------------------------------------------------

create table retention_policy (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  subject_key text not null references retention_subject (key),

  retain_days int not null check (retain_days >= 1),
  action retention_action not null default 'delete',
  -- Off until somebody turns it on, having seen what it would remove.
  enabled boolean not null default false,

  last_run_at timestamptz,
  last_affected int,
  note text,

  created_by uuid references user_profile (id),
  updated_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One policy per record type per organization. Two rules for the same data
  -- is an argument the sweep would resolve arbitrarily.
  unique (organization_id, subject_key)
);

create index idx_retention_policy_due on retention_policy (enabled, last_run_at)
  where enabled;

create trigger trg_retention_policy_updated_at before update on retention_policy
  for each row execute function set_updated_at();

comment on table retention_policy is
  'How long one organization keeps one kind of record. Disabled until switched on.';

-- The floor, and the allowed action, enforced where they can actually read the
-- subject row.
create or replace function app.retention_policy_respects_its_subject()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_subject retention_subject;
begin
  select * into v_subject from retention_subject where key = new.subject_key;
  if not found then
    raise exception 'There is no retention subject called "%".', new.subject_key
      using errcode = 'foreign_key_violation';
  end if;

  if new.retain_days < v_subject.minimum_days then
    raise exception
      'Retention for % cannot be shorter than % days.',
      v_subject.label, v_subject.minimum_days
      using errcode = 'check_violation';
  end if;

  if not (new.action = any (v_subject.allowed_actions)) then
    raise exception '% cannot be set to "%" — allowed here: %.',
      v_subject.label, new.action,
      array_to_string(v_subject.allowed_actions, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_retention_policy_floor
  before insert or update on retention_policy
  for each row execute function app.retention_policy_respects_its_subject();

alter table retention_policy enable row level security;

-- Retention is an administrator's decision and everybody's business: staff can
-- see what the organization keeps, only an administrator can change it.
create policy retention_policy_read on retention_policy for select to authenticated
  using (app.is_org_staff(organization_id));

create policy retention_policy_manage on retention_policy for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- What the sweep did
-- ---------------------------------------------------------------------------

create table retention_run (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  policy_id uuid references retention_policy (id) on delete set null,
  subject_key text not null,
  action retention_action not null,
  cutoff timestamptz not null,
  affected int not null default 0,
  error text,
  ran_at timestamptz not null default now(),

  constraint affected_is_not_negative check (affected >= 0)
);

create index idx_retention_run_org on retention_run (organization_id, ran_at desc);

comment on table retention_run is
  'One pass of one policy. Deletion without a record of it is indistinguishable from data loss.';

alter table retention_run enable row level security;

create policy retention_run_read on retention_run for select to authenticated
  using (app.is_org_staff(organization_id));

-- Written by the job runner through the service role. Deliberately no insert,
-- update or delete policy: a hand-edited retention log is not a log.

-- ---------------------------------------------------------------------------
-- Registration with the job runtime
-- ---------------------------------------------------------------------------

insert into job_definition (name, description, schedule, queue, enabled, batch_size, max_attempts)
values
  ('apply-retention',
   'Applies enabled retention policies and records what each one removed.',
   '40 2 * * *', null, true, 50, 3)
on conflict (name) do update
  set description = excluded.description,
      schedule = excluded.schedule;

do $$
declare
  j record;
begin
  for j in select name, schedule from job_definition where name = 'apply-retention'
  loop
    perform cron.unschedule(j.name)
      where exists (select 1 from cron.job c where c.jobname = j.name);
    perform cron.schedule(j.name, j.schedule,
      format('select app.dispatch_job(%L)', j.name));
  end loop;
end;
$$;
