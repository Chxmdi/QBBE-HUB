-- Approval records.
--
-- Intake requests and approval requests could be created already decided
-- and attributed to someone else, a requester could name themselves
-- approver, the approver could rewrite who decided and when or flip a
-- settled decision, and staff could decide their own intake request. Report
-- managers could create a report already "approved by" someone else, mark
-- their own report approved, or change the figures of an approved report,
-- since report_instance had no guard and its policies only checked project
-- management. A meeting attendee could add an agenda item already accepted.
--
-- Now, for members' own statements: a request or approval request starts
-- undecided; nobody approves a request they made; a decision is stamped
-- with the person deciding and the time; a settled approval stays settled;
-- report status, approver and figures change only through the report
-- functions (which run as definer with the same checks their tables'
-- policies made); an attendee's agenda item starts as proposed.

drop policy if exists approval_request_insert on public.approval_request;
create policy approval_request_insert on public.approval_request
  for insert to authenticated
  with check (
    app.is_org_staff(organization_id)
    and requested_by = (select auth.uid())
    and approver_id is distinct from (select auth.uid())
    and decision = 'pending'
    and decided_by is null
    and decided_at is null
  );

create or replace function app.guard_approval_request_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (new.organization_id, new.project_request_id, new.report_id, new.opportunity_id,
      new.requested_by, new.approver_id, new.created_at)
     is distinct from
     (old.organization_id, old.project_request_id, old.report_id, old.opportunity_id,
      old.requested_by, old.approver_id, old.created_at) then
    raise exception 'Only the decision on an approval request can change.' using errcode = '42501';
  end if;
  if old.decision <> 'pending'
     and (new.decision, new.decision_note, new.decided_by, new.decided_at)
         is distinct from (old.decision, old.decision_note, old.decided_by, old.decided_at) then
    raise exception 'This approval request has already been decided.' using errcode = '42501';
  end if;
  if new.decision is distinct from old.decision then
    -- The requester may withdraw their request, never decide it.
    if old.requested_by = (select auth.uid()) and new.decision <> 'withdrawn' then
      raise exception 'Nobody approves their own request.' using errcode = '42501';
    end if;
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;
  return new;
end;
$$;

revoke all on function app.guard_approval_request_write() from public, anon, authenticated;

drop trigger if exists approval_request_guard_write on public.approval_request;
create trigger approval_request_guard_write
  before update on public.approval_request
  for each row execute function app.guard_approval_request_write();

drop policy if exists project_request_insert on public.project_request;
create policy project_request_insert on public.project_request
  for insert to authenticated
  with check (
    app.is_org_member(organization_id)
    and requested_by = (select auth.uid())
    and status = 'submitted'
    and decided_by is null
    and decided_at is null
    and project_id is null
  );

create or replace function app.guard_project_request_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (new.organization_id, new.requested_by, new.created_at)
     is distinct from (old.organization_id, old.requested_by, old.created_at) then
    raise exception 'A request keeps its organization and requester.' using errcode = '42501';
  end if;
  if (new.status, new.decision_note, new.decided_by, new.decided_at)
     is distinct from (old.status, old.decision_note, old.decided_by, old.decided_at) then
    -- The requester may only resubmit a returned request or withdraw an
    -- open one; deciding, or rewording someone else's decision, is not
    -- theirs.
    if old.requested_by = (select auth.uid())
       and not (old.status = 'returned' and new.status = 'submitted')
       and not (old.status in ('submitted', 'returned') and new.status = 'withdrawn')
       and not (new.status = old.status and old.status in ('submitted', 'returned')
                and new.decided_by is not distinct from old.decided_by
                and new.decided_at is not distinct from old.decided_at) then
      raise exception 'Nobody decides their own request.' using errcode = '42501';
    end if;
    -- Whoever records or rewords a decision is the one who made it, now.
    if new.decided_by is not null then
      new.decided_by := (select auth.uid());
      new.decided_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app.guard_project_request_write() from public, anon, authenticated;

drop trigger if exists project_request_guard_write on public.project_request;
create trigger project_request_guard_write
  before update on public.project_request
  for each row execute function app.guard_project_request_write();

create or replace function app.guard_report_instance_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.approved_by := null;
    new.approved_at := null;
    return new;
  end if;
  if (new.status, new.approved_by, new.approved_at, new.snapshot, new.generated_by, new.organization_id)
     is distinct from
     (old.status, old.approved_by, old.approved_at, old.snapshot, old.generated_by, old.organization_id) then
    raise exception 'A report''s figures and approval change only through a new version and its decision.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_report_instance_write() from public, anon, authenticated;

drop trigger if exists report_instance_guard_write on public.report_instance;
create trigger report_instance_guard_write
  before insert or update on public.report_instance
  for each row execute function app.guard_report_instance_write();

CREATE OR REPLACE FUNCTION public.decide_report_version(p_version_id uuid, p_decision report_decision, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Runs as definer (so report_instance's guard lets the approval through);
  -- the administrator-with-MFA rule the approval table's policy applied is
  -- checked here.
  if not app.is_org_admin(v_version.organization_id) then
    raise exception 'Only an administrator with MFA can decide a report.'
      using errcode = 'insufficient_privilege';
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
     set status = (case when p_decision = 'approved' then 'approved'
                        else 'in_review' end)::report_status,
         approved_by = case when p_decision = 'approved' then v_actor else null end,
         approved_at = case when p_decision = 'approved' then now() else null end
   where id = v_version.report_id;

  return v_approval_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_report_version(p_report_id uuid, p_snapshot jsonb, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Runs as definer; the report-manager rule the version table's policy
  -- applied is checked here.
  if not app.can_manage_report(p_report_id) then
    raise exception 'That report is not available to you.'
      using errcode = 'insufficient_privilege';
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
$function$;

-- Versions are recorded only through record_report_version (above), so a
-- version's number and figures cannot be written directly.
drop policy if exists report_version_insert on public.report_version;

revoke all on function public.decide_report_version(uuid, public.report_decision, text) from public, anon;
grant execute on function public.decide_report_version(uuid, public.report_decision, text) to authenticated;
revoke all on function public.record_report_version(uuid, jsonb, text) from public, anon;
grant execute on function public.record_report_version(uuid, jsonb, text) to authenticated;

-- An attendee's agenda item starts as a proposal; the organizer triages it
-- (updates were already guarded by app.agenda_status_is_the_organizers).
create or replace function app.agenda_item_starts_proposed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'authenticated'
     and not app.can_manage_meeting(new.meeting_id) then
    new.status := 'proposed';
  end if;
  return new;
end;
$$;

revoke all on function app.agenda_item_starts_proposed() from public, anon, authenticated;

drop trigger if exists agenda_item_starts_proposed on public.agenda_item;
create trigger agenda_item_starts_proposed
  before insert on public.agenda_item
  for each row execute function app.agenda_item_starts_proposed();

-- Approving an intake request settles approvals still waiting on it. One the
-- approver had requested themselves is recorded as withdrawn: nobody
-- approves their own request.
CREATE OR REPLACE FUNCTION public.approve_project_request(p_request_id uuid, p_project_name text DEFAULT NULL::text, p_decision_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_request project_request;
  v_project_id uuid;
begin
  if v_actor is null then
    raise exception 'Approving a request requires a signed-in person.'
      using errcode = 'insufficient_privilege';
  end if;

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
    v_actor
  )
  returning id into v_project_id;

  update project_request
     set status = 'approved',
         project_id = v_project_id,
         decided_by = v_actor,
         decided_at = now(),
         decision_note = coalesce(p_decision_note, decision_note)
   where id = p_request_id;

  -- Any approval still waiting on this request has been answered by the act
  -- of approving it; leaving it pending would keep it in somebody's queue.
  -- An approval the approver had asked someone else for is withdrawn, not
  -- approved by themselves.
  update approval_request
     set decision = (case when requested_by = v_actor then 'withdrawn' else 'approved' end)::approval_decision,
         decided_by = v_actor,
         decided_at = now(),
         decision_note = coalesce(decision_note, 'Approved with the request.')
   where project_request_id = p_request_id and decision = 'pending';

  return v_project_id;
end;
$function$;

revoke all on function public.approve_project_request(uuid, text, text) from public, anon;
grant execute on function public.approve_project_request(uuid, text, text) to authenticated;
