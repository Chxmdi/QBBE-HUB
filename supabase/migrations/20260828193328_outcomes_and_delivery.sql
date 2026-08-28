-- QBBE Hub — what we did, and what changed because of it.
--
-- Two different questions, and a charity is asked both. A funder's report has
-- an outputs half — "we ran 42 sessions and 380 young people attended" — and
-- an outcomes half — "reading confidence rose from 4.1 to 6.8". Reporting on
-- the first while calling it the second is the most common failure in the
-- sector, so the schema keeps them apart:
--
--   program_operation    — one delivery: a session, a workshop, a drop-in.
--                          The output. Counted, dated, attributable.
--   outcome_metric       — something the program is trying to change, with a
--                          baseline and a target.
--   outcome_measurement  — one reading of one metric on one date.
--
-- Measurements are a separate table rather than a "current value" column
-- because the shape of the change is the evidence. A single number that gets
-- overwritten each quarter can show a target being met and hide that it was
-- met, lost, and met again.

-- ---------------------------------------------------------------------------
-- Delivery
-- ---------------------------------------------------------------------------

create type operation_status as enum ('planned', 'delivered', 'cancelled');

create table program_operation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  program_id uuid not null references program (id) on delete cascade,
  project_id uuid references project (id) on delete set null,

  title text not null,
  occurred_on date not null,
  location text,
  status operation_status not null default 'planned',

  -- Headcounts, not names. This table is for the numbers a funder asks for;
  -- who attended is personal data that belongs with the people who need it,
  -- not in a reporting aggregate every staff member can read.
  attendee_count int,
  volunteer_count int,
  -- Hours the session ran for, to one decimal place. Combined with attendance
  -- it gives contact hours, which is the unit most funders actually fund.
  duration_hours numeric(5, 1),
  staff_hours numeric(6, 1),

  notes text,
  -- Required when cancelled: a cancelled session with no reason is a gap in
  -- next year's application that nobody can explain.
  cancellation_reason text,

  led_by uuid references user_profile (id),
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Derived so that every list, total and report agrees. Null when either
  -- input is missing, which is honest: an unknown contact-hours figure should
  -- read as unknown rather than as zero.
  contact_hours numeric(10, 1) generated always as (
    attendee_count * duration_hours
  ) stored,

  constraint counts_are_not_negative check (
    coalesce(attendee_count, 0) >= 0
    and coalesce(volunteer_count, 0) >= 0
    and coalesce(duration_hours, 0) >= 0
    and coalesce(staff_hours, 0) >= 0
  ),
  constraint cancelled_operations_explain_themselves check (
    status <> 'cancelled' or cancellation_reason is not null
  ),
  -- A delivered session with no attendance is an unanswered question, and it
  -- is the number the whole table exists to hold.
  constraint delivered_operations_are_counted check (
    status <> 'delivered' or attendee_count is not null
  ),
  -- A cancelled session had no attendance. Leaving a count on one would put
  -- people in a funder report who were never there.
  constraint cancelled_operations_had_no_attendance check (
    status <> 'cancelled' or attendee_count is null
  )
);

create index idx_operation_program on program_operation (program_id, occurred_on desc);
create index idx_operation_org on program_operation (organization_id, occurred_on desc);
create index idx_operation_project on program_operation (project_id)
  where project_id is not null;
create index idx_operation_delivered on program_operation (organization_id, occurred_on)
  where status = 'delivered';

create trigger trg_operation_updated_at before update on program_operation
  for each row execute function set_updated_at();

comment on table program_operation is
  'One delivery of a program: the output half of a funder report.';
comment on column program_operation.contact_hours is
  'attendees x duration. Derived, so no two reports disagree.';
comment on column program_operation.attendee_count is
  'A headcount. Names belong with the people who need them, not in a reporting aggregate.';

alter table program_operation enable row level security;

-- Everyone in the organization can see what was delivered — volunteers run
-- these sessions, and a delivery record they cannot see is one they cannot
-- check. Only staff record and amend them.
create policy operation_read on program_operation for select to authenticated
  using (app.is_org_member(organization_id));

create policy operation_manage on program_operation for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));

-- ---------------------------------------------------------------------------
-- Change
-- ---------------------------------------------------------------------------

-- Which way is good. Without it, a chart cannot say whether a falling line is
-- progress or a problem, and half of what a charity measures is a reduction.
create type metric_direction as enum ('increase', 'decrease');

create table outcome_metric (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  program_id uuid not null references program (id) on delete cascade,

  name text not null,
  description text,
  -- Free text: charities measure in people, percentages, scores out of ten and
  -- hours, and an enum here would be wrong within a year.
  unit text not null default 'people',
  direction metric_direction not null default 'increase',

  baseline numeric(14, 2),
  baseline_on date,
  target numeric(14, 2),
  target_on date,

  owner_id uuid references user_profile (id),
  retired_at timestamptz,
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A target that matches the baseline is not a target.
  constraint target_differs_from_baseline check (
    baseline is null or target is null or target <> baseline
  ),
  -- The direction has to agree with the numbers, or every chart drawn from
  -- this metric will be labelled backwards.
  constraint direction_agrees_with_the_target check (
    baseline is null or target is null
    or (direction = 'increase' and target > baseline)
    or (direction = 'decrease' and target < baseline)
  )
);

create index idx_metric_program on outcome_metric (program_id)
  where retired_at is null;
create index idx_metric_org on outcome_metric (organization_id, created_at desc);

create trigger trg_metric_updated_at before update on outcome_metric
  for each row execute function set_updated_at();

comment on table outcome_metric is
  'Something a program is trying to change, with a baseline, a target and a direction.';
comment on constraint direction_agrees_with_the_target on outcome_metric is
  'Stops a metric whose target contradicts its direction, which would label every chart backwards.';

alter table outcome_metric enable row level security;

create policy metric_read on outcome_metric for select to authenticated
  using (app.is_org_member(organization_id));

create policy metric_manage on outcome_metric for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));

create table outcome_measurement (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  metric_id uuid not null references outcome_metric (id) on delete cascade,

  measured_on date not null,
  value numeric(14, 2) not null,
  -- Where the number came from. A measurement without a source is an
  -- assertion, and a funder will ask.
  source text,
  -- How many people the reading is drawn from. "Confidence rose to 6.8" means
  -- something different across nine respondents than across ninety.
  sample_size int,
  note text,

  recorded_by uuid references user_profile (id),
  created_at timestamptz not null default now(),

  constraint sample_sizes_are_positive check (sample_size is null or sample_size > 0)
);

-- One reading per metric per date. A second reading for the same day is a
-- correction, not another data point, and two of them would quietly double a
-- trend line.
create unique index uq_measurement_per_day
  on outcome_measurement (metric_id, measured_on);
create index idx_measurement_metric on outcome_measurement (metric_id, measured_on);

comment on table outcome_measurement is
  'One reading of one metric on one date. The series is the evidence; a single current value would hide the shape of the change.';

alter table outcome_measurement enable row level security;

create policy measurement_read on outcome_measurement for select to authenticated
  using (app.is_org_member(organization_id));

create policy measurement_manage on outcome_measurement for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));
