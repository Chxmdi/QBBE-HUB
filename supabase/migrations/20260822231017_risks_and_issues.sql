-- QBBE Hub — the project risk and issue log.
--
-- Two tables rather than one, because they answer different questions:
--
--   risk  — something that might happen, carrying a likelihood and an impact.
--           Managed by reducing one or accepting both.
--   issue — something that has happened, carrying a severity and a resolution.
--           Managed by fixing it.
--
-- The one relationship worth modelling between them is escalation: when a risk
-- materialises, the issue it becomes points back at it. That preserves the
-- history — "we saw this coming" — which a status change on a single row would
-- erase.
--
-- Both inherit project visibility through the existing predicates, so a person
-- who cannot see a project cannot see its risks, and a guessed UUID crosses no
-- boundary.

create type risk_likelihood as enum ('low', 'medium', 'high');
create type risk_impact as enum ('low', 'medium', 'high');
create type risk_status as enum ('open', 'mitigating', 'accepted', 'closed');
create type issue_severity as enum ('low', 'medium', 'high', 'critical');
create type issue_status as enum ('open', 'investigating', 'resolved', 'closed');

create table risk (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  project_id uuid not null references project (id) on delete cascade,
  title text not null,
  description text,
  likelihood risk_likelihood not null default 'medium',
  impact risk_impact not null default 'medium',
  status risk_status not null default 'open',
  mitigation text,
  owner_id uuid references user_profile (id),
  review_at date,
  closed_at timestamptz,
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Sorting by "how worried should I be" needs one number, and deriving it in
  -- the database keeps every reader agreeing on the answer.
  score int generated always as (
    (case likelihood when 'low' then 1 when 'medium' then 2 else 3 end)
    * (case impact when 'low' then 1 when 'medium' then 2 else 3 end)
  ) stored,

  -- An accepted or closed risk is a decision, and a decision needs a reason.
  constraint settled_risks_explain_themselves
    check (status not in ('accepted', 'closed') or mitigation is not null)
);

create index idx_risk_project on risk (project_id, status, score desc);
create index idx_risk_owner on risk (owner_id, status) where owner_id is not null;
create index idx_risk_review on risk (review_at)
  where review_at is not null and status in ('open', 'mitigating');

comment on table risk is 'Things that might happen to a project, with likelihood and impact.';
comment on column risk.score is 'likelihood x impact, 1-9. Derived, so every reader agrees.';

create table issue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  project_id uuid not null references project (id) on delete cascade,
  -- Set when this issue is a risk that materialised.
  risk_id uuid references risk (id) on delete set null,
  title text not null,
  description text,
  severity issue_severity not null default 'medium',
  status issue_status not null default 'open',
  owner_id uuid references user_profile (id),
  resolution text,
  due_at date,
  resolved_at timestamptz,
  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A resolved issue that says nothing about how is not resolved, it is closed.
  constraint resolved_issues_record_the_resolution
    check (status not in ('resolved', 'closed') or resolution is not null),
  constraint resolved_issues_have_a_timestamp
    check (status not in ('resolved', 'closed') or resolved_at is not null)
);

create index idx_issue_project on issue (project_id, status, severity desc);
create index idx_issue_owner on issue (owner_id, status) where owner_id is not null;
create index idx_issue_risk on issue (risk_id) where risk_id is not null;

comment on table issue is 'Things that have happened to a project, with severity and a resolution.';
comment on column issue.risk_id is 'The risk this issue came from, when it was one we saw coming.';

create trigger risk_set_updated_at
  before update on risk
  for each row execute function set_updated_at();
create trigger issue_set_updated_at
  before update on issue
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Access: whatever the parent project allows. Reading a project's risks is
-- reading the project; changing them is managing it.
-- ---------------------------------------------------------------------------
alter table risk enable row level security;
alter table issue enable row level security;

create policy risk_read on risk
  for select to authenticated
  using (app.can_read_project(project_id));
create policy risk_manage on risk
  for all to authenticated
  using (app.can_manage_project(project_id))
  with check (app.can_manage_project(project_id));

create policy issue_read on issue
  for select to authenticated
  using (app.can_read_project(project_id));
create policy issue_manage on issue
  for all to authenticated
  using (app.can_manage_project(project_id))
  with check (app.can_manage_project(project_id));
