-- An approval is a decision, and a decision needs somebody's name on it.
--
-- Without this guard, a call with no authenticated caller (a service-role
-- script, a future job) reached the UPDATE with a null decider and failed on
-- `decided_requests_are_attributable` — the right outcome, reported as an
-- unreadable constraint violation. Refusing up front says what is actually
-- wrong, and keeps the constraint as the backstop it is meant to be.
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
  update approval_request
     set decision = 'approved',
         decided_by = v_actor,
         decided_at = now(),
         decision_note = coalesce(decision_note, 'Approved with the request.')
   where project_request_id = p_request_id and decision = 'pending';

  return v_project_id;
end;
$$;

revoke all on function public.approve_project_request(uuid, text, text) from public;
grant execute on function public.approve_project_request(uuid, text, text) to authenticated;
