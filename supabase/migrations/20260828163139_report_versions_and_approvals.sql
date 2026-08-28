-- QBBE Hub — report versions and the approval trail.
--
-- The problem this fixes. A report carried one `snapshot` column and one pair
-- of approval fields. Regenerating it overwrote the snapshot, which meant the
-- numbers behind an approved report could change after approval without
-- leaving a trace — and a funder report approved in March has to still say in
-- November what it said in March. The approval fields recorded who signed off
-- but never what they signed off, and nothing recorded a refusal at all.
--
--   report_version  — one immutable snapshot per generation.
--   report_approval — one decision about one version.
--
-- How immutability is enforced: report_version has SELECT and INSERT policies
-- and no UPDATE or DELETE policy at all. Under row-level security that is a
-- refusal, not an omission — no signed-in role can alter a version once it is
-- written, approved or not. A trigger would do the same job with more moving
-- parts and one more thing to forget.

create table report_version (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  report_id uuid not null references report_instance (id) on delete cascade,
  -- 1, 2, 3… per report. Two generations racing collide on the unique index
  -- below and one fails cleanly, which is the right outcome: a lost version is
  -- worse than a refused one.
  version_number int not null,
  snapshot jsonb not null,
  note text,
  generated_by uuid not null references user_profile (id),
  generated_at timestamptz not null default now(),

  constraint versions_are_numbered_from_one check (version_number >= 1)
);

create unique index uq_report_version on report_version (report_id, version_number);
create index idx_report_version_report on report_version (report_id, version_number desc);

comment on table report_version is
  'An immutable snapshot of a report. Append-only: there is no update policy.';

alter table report_version enable row level security;

create policy report_version_read on report_version for select to authenticated
  using (app.is_org_staff(organization_id));

create policy report_version_insert on report_version for insert to authenticated
  with check (app.is_org_staff(organization_id) and generated_by = auth.uid());

-- Deliberately no update or delete policy. See the note above.

-- Every report that already exists becomes version 1, so no snapshot is lost
-- and every report has a version from this migration onward.
insert into report_version (organization_id, report_id, version_number,
                            snapshot, generated_by, generated_at, note)
select r.organization_id, r.id, 1, r.snapshot, r.generated_by, r.created_at,
       'Recorded when report versioning was introduced.'
from report_instance r;

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------

create type report_decision as enum ('approved', 'rejected');

create table report_approval (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  report_version_id uuid not null references report_version (id) on delete cascade,
  decision report_decision not null,
  note text,
  decided_by uuid not null references user_profile (id),
  decided_at timestamptz not null default now(),

  -- A refusal that says nothing sends the author back to guess.
  constraint rejections_explain_themselves check (
    decision <> 'rejected' or note is not null
  )
);

-- One decision per version. Changing your mind means a new version, which is
-- exactly the audit trail a funder or trustee expects to see.
create unique index uq_report_approval_version on report_approval (report_version_id);
create index idx_report_approval_org on report_approval (organization_id, decided_at desc);

comment on table report_approval is
  'One decision about one version. A second opinion means a new version.';

alter table report_approval enable row level security;

create policy report_approval_read on report_approval for select to authenticated
  using (app.is_org_staff(organization_id));

-- Only an administrator signs a report off, matching the existing rule on
-- report_instance. Append-only for the same reason versions are.
create policy report_approval_insert on report_approval for insert to authenticated
  with check (app.is_org_admin(organization_id) and decided_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Writing a version, and deciding on one
-- ---------------------------------------------------------------------------

-- Appends the next version and mirrors it onto report_instance.snapshot.
--
-- The mirror is deliberate: report_instance.snapshot predates this table and
-- is read by code and by anybody with a SQL prompt. Keeping it equal to the
-- latest version means it is never stale — which is the only honest option
-- short of dropping it, and dropping a column that existing rows depend on is
-- a separate, riskier change.
create or replace function public.record_report_version(
  p_report_id uuid,
  p_snapshot jsonb,
  p_note text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_next int;
  v_version_id uuid;
begin
  if v_actor is null then
    raise exception 'Recording a report version requires a signed-in person.'
      using errcode = 'insufficient_privilege';
  end if;

  select organization_id into v_org from report_instance where id = p_report_id;
  if not found then
    raise exception 'That report is not available to you.'
      using errcode = 'no_data_found';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from report_version where report_id = p_report_id;

  insert into report_version (organization_id, report_id, version_number,
                              snapshot, note, generated_by)
  values (v_org, p_report_id, v_next, p_snapshot, p_note, v_actor)
  returning id into v_version_id;

  -- A new version is an unapproved one: a report whose numbers have moved is
  -- not still approved, and leaving the old sign-off in place would say it was.
  update report_instance
     set snapshot = p_snapshot,
         status = 'draft',
         approved_by = null,
         approved_at = null
   where id = p_report_id;

  return v_version_id;
end;
$$;

revoke all on function public.record_report_version(uuid, jsonb, text) from public;
grant execute on function public.record_report_version(uuid, jsonb, text) to authenticated;

-- Records the decision and moves the report to match, together.
create or replace function public.decide_report_version(
  p_version_id uuid,
  p_decision report_decision,
  p_note text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_version report_version;
  v_latest int;
  v_approval_id uuid;
begin
  if v_actor is null then
    raise exception 'Deciding a report requires a signed-in person.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_version from report_version where id = p_version_id;
  if not found then
    raise exception 'That report version is not available to you.'
      using errcode = 'no_data_found';
  end if;

  select max(version_number) into v_latest
  from report_version where report_id = v_version.report_id;

  -- Signing off a superseded version would put an approval against numbers
  -- nobody is looking at any more.
  if v_version.version_number <> v_latest then
    raise exception 'That version has been superseded — decide on the latest one.'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into report_approval (organization_id, report_version_id, decision,
                               note, decided_by)
  values (v_version.organization_id, p_version_id, p_decision, p_note, v_actor)
  returning id into v_approval_id;

  update report_instance
     set status = case when p_decision = 'approved' then 'approved' else 'in_review' end,
         approved_by = case when p_decision = 'approved' then v_actor else null end,
         approved_at = case when p_decision = 'approved' then now() else null end
   where id = v_version.report_id;

  return v_approval_id;
end;
$$;

revoke all on function public.decide_report_version(uuid, report_decision, text) from public;
grant execute on function public.decide_report_version(uuid, report_decision, text) to authenticated;

comment on function public.record_report_version(uuid, jsonb, text) is
  'Appends the next version and resets the report to draft, because moved numbers are not still approved.';
comment on function public.decide_report_version(uuid, report_decision, text) is
  'Records one decision about the latest version and moves the report to match.';
