-- Workspace OS timeline lens: reschedule several tasks at once (V1-2, epic
-- #199, stream S4).
--
-- Dragging a bar on the timeline can move the task and, after the person
-- confirms, the tasks that depend on it. Those moves must land together or
-- not at all, so they run in one call, inside one transaction.
--
-- Caller's rights: each update goes through the task table's own RLS and its
-- triggers (enforce_scoped_task_update, the audit and history triggers), as an
-- edit from the task drawer would. If any task cannot be updated by this
-- person, nothing is changed and the call reports which one.

create or replace function public.lens_shift_tasks(p_moves jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_move jsonb;
  v_id uuid;
  v_start date;
  v_due date;
  v_count integer := 0;
  v_rows integer;
begin
  if (select auth.uid()) is null then
    raise exception 'lens:signed_out: Sign in to move tasks.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves) = 0
     or jsonb_array_length(p_moves) > 200 then
    raise exception 'lens:invalid_spec: Between 1 and 200 moves.' using errcode = '22023';
  end if;
  for v_move in select * from jsonb_array_elements(p_moves) loop
    if jsonb_typeof(v_move) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_move) k where k not in ('id', 'start', 'due')) then
      raise exception 'lens:invalid_spec: A move is not in the expected format.' using errcode = '22023';
    end if;
    begin
      v_id := (v_move ->> 'id')::uuid;
      v_start := case when v_move ? 'start' and v_move -> 'start' <> 'null'::jsonb then (v_move ->> 'start')::date end;
      v_due := case when v_move ? 'due' and v_move -> 'due' <> 'null'::jsonb then (v_move ->> 'due')::date end;
    exception when others then
      raise exception 'lens:bad_value: A move has an invalid id or date.' using errcode = '22023';
    end;
    if v_id is null or (v_start is not null and v_due is not null and v_start > v_due) then
      raise exception 'lens:bad_value: A task cannot start after it is due.' using errcode = '22023';
    end if;

    update public.task t
    set start_at = case when v_move ? 'start' then v_start else t.start_at end,
        due_at = case when v_move ? 'due' then v_due else t.due_at end
    where t.id = v_id and t.archived_at is null;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      -- Not visible, not editable, or archived: undo everything.
      raise exception 'lens:forbidden: One of the tasks cannot be moved by you (%).', v_id using errcode = '42501';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.lens_shift_tasks(jsonb) from public, anon;
grant execute on function public.lens_shift_tasks(jsonb) to authenticated, service_role;

comment on function public.lens_shift_tasks(jsonb) is
  'Workspace OS timeline (V1-2): move tasks'' start and due dates together, all or nothing, under RLS.';
