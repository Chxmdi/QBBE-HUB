-- A CASE expression produces text, and report_instance.status is an enum, so
-- the assignment failed with a type error the moment the function was first
-- called. A bare literal coerces; the result of a CASE does not.
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
     set status = (case when p_decision = 'approved' then 'approved'
                        else 'in_review' end)::report_status,
         approved_by = case when p_decision = 'approved' then v_actor else null end,
         approved_at = case when p_decision = 'approved' then now() else null end
   where id = v_version.report_id;

  return v_approval_id;
end;
$$;

revoke all on function public.decide_report_version(uuid, report_decision, text) from public;
grant execute on function public.decide_report_version(uuid, report_decision, text) to authenticated;
