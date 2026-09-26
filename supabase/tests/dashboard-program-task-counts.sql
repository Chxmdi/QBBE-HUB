-- dashboard_program_task_counts returns the per-program totals the dashboard
-- used to count with two queries per program (#115, migration
-- 20260926080000), for every member: the same filters, under the same
-- row-level security. Run after qa-users.sql and rls.sql. All mutations are
-- rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program uuid;
  v_programs uuid[];
  v_user record;
  v_level text;
  p record;
  v_total bigint;
  v_completed bigint;
  v_got_total bigint;
  v_got_completed bigint;
  v_rows integer;
  v_checks integer := 0;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_volunteer;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Program counts fixture', 'program-counts-fixture', v_owner)
  returning id into v_program;

  -- Open, completed and archived tasks in one program, assigned to the
  -- volunteer so a non-administrator sees some of them.
  insert into public.task (organization_id, program_id, title, created_by, assignee_id, status, completed_at, archived_at, blocked_reason)
  select v_org, v_program, 'program counts: ' || st.status || ' ' || arch, v_owner, v_volunteer,
         st.status::public.task_status,
         case when st.status = 'completed' then now() end,
         case when arch = 'archived' then now() end,
         case when st.status = 'blocked' then 'Waiting on the venue' end
  from unnest(array['not_started', 'in_progress', 'blocked', 'completed', 'completed']) as st(status)
  cross join unnest(array['live', 'archived']) as arch;

  select array_agg(id) into v_programs from public.program;

  for v_user in select distinct user_id from public.organization_membership loop
    foreach v_level in array array['aal1', 'aal2'] loop
      perform tests.authenticate(v_user.user_id, v_level);

      for p in select unnest(v_programs) as id loop
        select count(*) into v_total from public.task
        where program_id = p.id and archived_at is null;
        select count(*) into v_completed from public.task
        where program_id = p.id and archived_at is null and status = 'completed';

        select c.total, c.completed into v_got_total, v_got_completed
        from public.dashboard_program_task_counts(v_programs) c
        where c.program_id = p.id;
        get diagnostics v_rows = row_count;

        -- A program with no readable tasks has no row; the dashboard shows 0.
        perform tests.ok(
          coalesce(v_got_total, 0) = v_total and coalesce(v_got_completed, 0) = v_completed
            and (v_rows = 1) = (v_total > 0),
          format('program %s for %s at %s: total %s/%s, completed %s/%s',
                 p.id, v_user.user_id, v_level,
                 coalesce(v_got_total, 0), v_total, coalesce(v_got_completed, 0), v_completed)
        );
        v_checks := v_checks + 1;
        v_got_total := null;
        v_got_completed := null;
      end loop;
      perform tests.clear_auth();
    end loop;
  end loop;

  -- The volunteer, a non-administrator, sees the fixture through assignment:
  -- five live tasks, two of them completed; archived ones are not counted.
  perform tests.authenticate(v_volunteer, 'aal1');
  select c.total, c.completed into v_got_total, v_got_completed
  from public.dashboard_program_task_counts(array[v_program]) c;
  perform tests.ok(v_got_total >= 5 and v_got_completed >= 2,
    format('the fixture is visible to an assignee (total %s, completed %s)', v_got_total, v_got_completed));
  perform tests.clear_auth();

  -- Signed out, the function is not callable at all.
  begin
    set local role anon;
    perform public.dashboard_program_task_counts(array[v_program]);
    reset role;
    perform tests.ok(false, 'anon cannot call dashboard_program_task_counts');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot call dashboard_program_task_counts');
  end;

  perform tests.ok(v_checks >= 10, format('compared %s program/person pairs', v_checks));
end
$$;

rollback;
