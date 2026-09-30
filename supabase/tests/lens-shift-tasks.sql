-- Workspace OS timeline moves (V1-2): all or nothing, under RLS. Rolled back.
begin;

create temporary table shift_fx (name text primary key, id uuid) on commit drop;
grant select on shift_fx to authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_a uuid;
  v_b uuid;
  v_mine uuid;
  v_moved integer;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  insert into public.task (organization_id, title, created_by, start_at, due_at)
  values (v_org, 'Shift A', v_owner, date '2026-11-02', date '2026-11-04') returning id into v_a;
  insert into public.task (organization_id, title, created_by, start_at, due_at)
  values (v_org, 'Shift B', v_owner, date '2026-11-05', date '2026-11-09') returning id into v_b;
  insert into public.task (organization_id, title, created_by, assignee_id, start_at, due_at)
  values (v_org, 'Shift volunteer', v_owner, v_volunteer, date '2026-11-02', date '2026-11-03') returning id into v_mine;
  insert into shift_fx values ('a', v_a), ('b', v_b), ('mine', v_mine);

  perform tests.ok(
    (select not p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
     where p.proname = 'lens_shift_tasks' and p.pronamespace = 'public'::regnamespace)
      and not has_function_privilege('anon', 'public.lens_shift_tasks(jsonb)', 'execute'),
    'lens_shift_tasks runs with the caller''s rights; signed-out visitors cannot call it');

  -- The owner moves two tasks together.
  perform tests.authenticate(v_owner, 'aal2');
  v_moved := public.lens_shift_tasks(jsonb_build_array(
    jsonb_build_object('id', v_a, 'start', '2026-11-03', 'due', '2026-11-05'),
    jsonb_build_object('id', v_b, 'start', '2026-11-06', 'due', '2026-11-10')));
  perform tests.ok(v_moved = 2
      and (select start_at = '2026-11-03' and due_at = '2026-11-05' from public.task where id = v_a)
      and (select start_at = '2026-11-06' and due_at = '2026-11-10' from public.task where id = v_b),
    'the owner moves a task and its dependent together');

  -- Only the due date, leaving the start.
  perform public.lens_shift_tasks(jsonb_build_array(jsonb_build_object('id', v_a, 'due', '2026-11-07')));
  perform tests.ok((select start_at = '2026-11-03' and due_at = '2026-11-07' from public.task where id = v_a),
    'a move that names only the due date keeps the start');

  begin
    perform public.lens_shift_tasks(jsonb_build_array(jsonb_build_object('id', v_a, 'start', '2026-11-20', 'due', '2026-11-10')));
    raise exception 'FAIL: start after due accepted';
  exception when others then
    perform tests.ok(sqlerrm like 'lens:bad_value:%', 'a task cannot start after it is due');
  end;
  begin
    perform public.lens_shift_tasks(jsonb_build_array(jsonb_build_object('id', v_a, 'due', 'soon', 'extra', 1)));
    raise exception 'FAIL: bad move accepted';
  exception when others then
    perform tests.ok(sqlerrm like 'lens:invalid_spec:%', 'unknown keys in a move are refused');
  end;
  begin
    perform public.lens_shift_tasks('[]'::jsonb);
    raise exception 'FAIL: empty accepted';
  exception when others then
    perform tests.ok(sqlerrm like 'lens:invalid_spec:%', 'an empty list of moves is refused');
  end;
  reset role;

  -- The volunteer may move their own task, but a batch that includes a task
  -- they cannot edit changes nothing at all.
  perform tests.authenticate(v_volunteer, 'aal2');
  begin
    perform public.lens_shift_tasks(jsonb_build_array(
      jsonb_build_object('id', v_mine, 'due', '2026-11-12'),
      jsonb_build_object('id', v_b, 'due', '2026-12-01')));
    raise exception 'FAIL: volunteer moved the owner''s task';
  exception when others then
    perform tests.ok(sqlerrm like 'lens:forbidden:%' or sqlstate = '42501', 'a batch with a task the volunteer cannot move is refused');
  end;
  reset role;
  perform tests.ok((select due_at = '2026-11-03' from public.task where id = v_mine)
      and (select due_at = '2026-11-10' from public.task where id = v_b),
    'and nothing in that batch changed, not even the volunteer''s own task');
end;
$$;

rollback;
