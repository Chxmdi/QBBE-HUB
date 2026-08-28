-- QBBE Hub — intake: proposing work, and asking someone to decide.
--
-- Two tables, because they answer different questions.
--
--   project_request — somebody proposes work that does not exist yet. It has
--     its own fields (what, why, who it serves) and one transition that
--     matters: on approval it becomes a project, and the request keeps a
--     pointer to it. That pointer is the whole point — six months later the
--     question "why are we doing this" has an answer with a name on it.
--
--   approval_request — somebody asks a named person to decide about a record
--     that already exists. It carries no domain fields of its own; it carries
--     who was asked, what they said, and why.
--
-- Why approval_request is not polymorphic. The obvious shape is
-- (subject_type text, subject_id uuid), and it is a referential-integrity
-- hole: nothing stops a row pointing at a record that was deleted last year,
-- and no cascade can help. Instead there is one nullable foreign key per
-- subject and a CHECK that exactly one is set. Adding a fourth subject is one
-- column and one edit to that CHECK — a real cost, paid once, in exchange for
-- the database refusing to hold a dangling approval.

-- ---------------------------------------------------------------------------
-- Project requests
-- ---------------------------------------------------------------------------

create type project_request_status as enum (
  'submitted', 'in_review', 'approved', 'declined', 'withdrawn'
);

create table project_request (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,

  title text not null,
  -- What is being proposed, in the proposer's words. Required: a request with
  -- only a title is not a request, it is a note to self.
  summary text not null,
  rationale text,
  -- Who it serves. A charity's intake question, and the one most often left
  -- out of a generic "new project" form.
  beneficiaries text,

  program_id uuid references program (id) on delete set null,
  requested_by uuid not null references user_profile (id),
  -- A staff member willing to carry it. Optional at submission, because
  -- requiring a sponsor up front stops volunteers proposing anything.
  sponsor_id uuid references user_profile (id),

  status project_request_status not null default 'submitted',
  needed_by date,
  -- Free text on purpose: a small charity estimates in "a few weekends", not
  -- story points, and a number here would be false precision.
  estimated_effort text,

  decision_note text,
  decided_by uuid references user_profile (id),
  decided_at timestamptz,

  -- Provenance. Set when the request is approved and the project created.
  project_id uuid references project (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An approved request that produced nothing is an approval nobody acted on.
  constraint approved_requests_become_projects check (
    status <> 'approved' or project_id is not null
  ),
  -- A refusal is worth more than its status: it tells the next person why.
  constraint refused_requests_explain_themselves check (
    status not in ('declined', 'withdrawn') or decision_note is not null
  ),
  -- Somebody decided this. Say who, and when.
  constraint decided_requests_are_attributable check (
    status in ('submitted', 'in_review')
      or (decided_by is not null and decided_at is not null)
  ),
  constraint open_requests_have_no_decision check (
    status not in ('submitted', 'in_review')
      or (decided_by is null and decided_at is null)
  )
);

create index idx_project_request_queue
  on project_request (organization_id, status, created_at desc);
create index idx_project_request_mine on project_request (requested_by, status);
create index idx_project_request_project on project_request (project_id)
  where project_id is not null;

create trigger trg_project_request_updated_at before update on project_request
  for each row execute function set_updated_at();

comment on table project_request is
  'A proposal for work that does not exist yet; on approval it becomes a project.';
comment on column project_request.project_id is
  'The project this request became. Preserves why the project exists.';

alter table project_request enable row level security;

-- Anyone in the organization may propose work — that is what intake is for —
-- but only as themselves.
create policy project_request_insert on project_request for insert to authenticated
  with check (app.is_org_member(organization_id) and requested_by = auth.uid());

-- You can always read your own request, whatever your role.
create policy project_request_read_own on project_request for select to authenticated
  using (requested_by = auth.uid());

-- While it is still untouched, you can edit or withdraw your own request.
create policy project_request_edit_own on project_request for update to authenticated
  using (requested_by = auth.uid() and status = 'submitted')
  with check (requested_by = auth.uid());

-- Staff run the queue.
create policy project_request_staff on project_request for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));

-- ---------------------------------------------------------------------------
-- Approval requests
-- ---------------------------------------------------------------------------

create type approval_decision as enum (
  'pending', 'approved', 'rejected', 'withdrawn'
);

create table approval_request (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,

  -- Exactly one of these is set. See the note at the top of this file.
  project_request_id uuid references project_request (id) on delete cascade,
  report_id uuid references report_instance (id) on delete cascade,
  opportunity_id uuid references opportunity (id) on delete cascade,

  requested_by uuid not null references user_profile (id),
  -- The person being asked. Only they can answer — enforced by policy below,
  -- which is the point of naming them rather than notifying a group.
  approver_id uuid not null references user_profile (id),
  note text,
  due_at date,

  decision approval_decision not null default 'pending',
  decided_by uuid references user_profile (id),
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint exactly_one_subject check (
    num_nonnulls(project_request_id, report_id, opportunity_id) = 1
  ),
  constraint decisions_are_attributable check (
    decision = 'pending' or (decided_by is not null and decided_at is not null)
  ),
  constraint pending_requests_have_no_decision check (
    decision <> 'pending' or (decided_by is null and decided_at is null)
  ),
  -- A rejection without a reason sends the requester back to guess.
  constraint rejections_explain_themselves check (
    decision <> 'rejected' or decision_note is not null
  )
);

-- One open ask per subject. A second request while the first is unanswered is
-- a nudge, not a new decision, and a queue full of duplicates is a queue
-- nobody works. Once decided, a fresh request is allowed.
create unique index uq_one_pending_approval_per_subject
  on approval_request (
    coalesce(project_request_id, report_id, opportunity_id)
  )
  where decision = 'pending';

create index idx_approval_waiting_on_me
  on approval_request (approver_id, decision, due_at);
create index idx_approval_org on approval_request (organization_id, decision, created_at desc);

create trigger trg_approval_request_updated_at before update on approval_request
  for each row execute function set_updated_at();

comment on table approval_request is
  'A named person is asked to decide about one existing record.';
comment on constraint exactly_one_subject on approval_request is
  'One nullable FK per subject instead of a polymorphic id, so a deleted subject cannot leave a dangling approval.';

alter table approval_request enable row level security;

-- The requester, the approver, and staff. Nobody else needs to know that a
-- decision is pending.
create policy approval_request_read on approval_request for select to authenticated
  using (
    approver_id = auth.uid()
    or requested_by = auth.uid()
    or app.is_org_staff(organization_id)
  );

create policy approval_request_insert on approval_request for insert to authenticated
  with check (
    app.is_org_staff(organization_id) and requested_by = auth.uid()
  );

-- Only the person who was asked can answer. An admin can also act, because
-- somebody has to be able to unblock a queue when an approver leaves.
create policy approval_request_decide on approval_request for update to authenticated
  using (approver_id = auth.uid() or app.is_org_admin(organization_id))
  with check (approver_id = auth.uid() or app.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- Approving a request, atomically
-- ---------------------------------------------------------------------------

-- Approval creates a project and stamps the request in one statement. Doing it
-- as two round trips from the application would leave an orphaned project
-- behind whenever the second one failed, and `approved_requests_become_projects`
-- would reject the request anyway — so the work belongs in one transaction.
--
-- SECURITY INVOKER (the default): the caller's policies decide whether they may
-- create a project and update the request. An unauthorized caller fails on the
-- insert and the whole thing rolls back.
create or replace function public.approve_project_request(
  p_request_id uuid,
  p_project_name text default null,
  p_decision_note text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_request project_request;
  v_project_id uuid;
begin
  select * into v_request from project_request where id = p_request_id;
  if not found then
    raise exception 'That request is not available to you.'
      using errcode = 'no_data_found';
  end if;
  if v_request.status = 'approved' then
    -- Idempotent on purpose: a double-click must not create a second project.
    return v_request.project_id;
  end if;
  if v_request.status in ('declined', 'withdrawn') then
    raise exception 'That request was already settled.'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into project (
    organization_id, program_id, name, outcome, description,
    owner_id, stage, created_by
  )
  values (
    v_request.organization_id,
    v_request.program_id,
    coalesce(nullif(trim(p_project_name), ''), v_request.title),
    v_request.summary,
    v_request.rationale,
    coalesce(v_request.sponsor_id, v_request.requested_by),
    'approved',
    auth.uid()
  )
  returning id into v_project_id;

  update project_request
     set status = 'approved',
         project_id = v_project_id,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = coalesce(p_decision_note, decision_note)
   where id = p_request_id;

  -- Any approval still waiting on this request has been answered by the act
  -- of approving it; leaving it pending would keep it in somebody's queue.
  update approval_request
     set decision = 'approved',
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = coalesce(decision_note, 'Approved with the request.')
   where project_request_id = p_request_id and decision = 'pending';

  return v_project_id;
end;
$$;

revoke all on function public.approve_project_request(uuid, text, text) from public;
grant execute on function public.approve_project_request(uuid, text, text) to authenticated;

comment on function public.approve_project_request(uuid, text, text) is
  'Creates the project and settles the request in one transaction. Idempotent for an already-approved request.';
