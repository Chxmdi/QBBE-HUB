-- Insight what-if timeline (V3-4, epic #199): apply a previewed milestone
-- shift in one transaction.
--
-- The preview is computed in the application and changes nothing. Applying it
-- writes new dates to several milestones and tasks, possibly across projects,
-- and that has to be all or nothing: half a rescheduled plan is worse than
-- either the old one or the new one. PostgREST gives one transaction per
-- call, so the writes go through this one function.
--
-- SECURITY INVOKER, so every update still passes the caller's own row-level
-- security. On top of that it asks for more than RLS alone would: the caller
-- must be able to manage (public.can ... 'edit_structure') every project whose
-- milestones move and every task that moves. Rescheduling someone else's plan
-- is a structural change, and a task collaborator's right to edit a task's
-- fields is not a right to move it on a timeline.
--
-- Each row carries the date the preview saw ("from"). If the row no longer
-- has that date, someone changed the schedule after the preview, and the
-- whole shift is refused (SQLSTATE 40001) so the person can preview again.

create or replace function public.insight_apply_schedule_shift(
  p_milestones jsonb,
  p_tasks jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_project uuid;
  v_count integer := 0;
  v_updated integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to change a schedule.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_milestones, '[]')) <> 'array' or jsonb_typeof(coalesce(p_tasks, '[]')) <> 'array' then
    raise exception 'A schedule change is two lists of rows.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_milestones, '[]')) + jsonb_array_length(coalesce(p_tasks, '[]')) > 2000 then
    raise exception 'That change moves too many dates at once.' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_milestones, '[]')) loop
    select m.project_id into v_project from public.milestone m where m.id = (v_row ->> 'id')::uuid;
    if v_project is null or not public.can(v_project, 'edit_structure') then
      raise exception 'You cannot reschedule this milestone.' using errcode = '42501';
    end if;
    update public.milestone
       set due_date = (v_row ->> 'to')::date, updated_at = now()
     where id = (v_row ->> 'id')::uuid
       and due_date is not distinct from (v_row ->> 'from')::date;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'The schedule changed after the preview.' using errcode = '40001';
    end if;
    v_count := v_count + 1;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_tasks, '[]')) loop
    if not public.can((v_row ->> 'id')::uuid, 'edit_structure') then
      raise exception 'You cannot reschedule this task.' using errcode = '42501';
    end if;
    update public.task
       set due_at = (v_row ->> 'to')::date,
           start_at = case when v_row ? 'startTo' then (v_row ->> 'startTo')::date else start_at end,
           updated_at = now()
     where id = (v_row ->> 'id')::uuid
       and due_at is not distinct from (v_row ->> 'from')::date
       and (not v_row ? 'startFrom' or start_at is not distinct from (v_row ->> 'startFrom')::date);
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'The schedule changed after the preview.' using errcode = '40001';
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.insight_apply_schedule_shift(jsonb, jsonb) from public, anon;
grant execute on function public.insight_apply_schedule_shift(jsonb, jsonb) to authenticated, service_role;

comment on function public.insight_apply_schedule_shift(jsonb, jsonb) is
  'What-if timeline (V3-4): applies a previewed milestone shift atomically. Invoker rights; '
  'requires edit_structure on every project and task it moves; refuses with 40001 if any date '
  'changed since the preview.';
