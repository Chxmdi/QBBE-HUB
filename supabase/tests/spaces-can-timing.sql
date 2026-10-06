-- Workspace OS app.can (M10c): speed. On a 500-task board, reading the new
-- cache through the list form must add under 20 ms to the board query.
-- Medians of repeated runs, alternating the two queries so a noisy moment
-- hits both. Also reports (does not gate) one-record app.can and the refresh
-- cost of a 500-task insert. Run after qa-users.sql and rls.sql. Rolled back.
begin;

-- The list-form pieces are called by policies as the signed-in role. This
-- measurement calls them in a plain query instead, so it needs the schema
-- inside this transaction only.
grant usage on schema app to authenticated;

create function tests.tm_board(p_project uuid, p_new boolean)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_new then
    select count(*) into v_rows from (
      select t.id, t.title, t.status, t.priority, t.due_at, t.assignee_id
      from public.task t
      where t.project_id = p_project and t.archived_at is null
        and (t.organization_id = any ((select app.access_orgs_where('view'))::uuid[])
             or t.id in (select app.access_cached_ids('view')))
      order by t.sort_key nulls last, t.created_at
      limit 500) b;
  else
    select count(*) into v_rows from (
      select t.id, t.title, t.status, t.priority, t.due_at, t.assignee_id
      from public.task t
      where t.project_id = p_project and t.archived_at is null
      order by t.sort_key nulls last, t.created_at
      limit 500) b;
  end if;
  return v_rows;
end;
$$;
grant execute on function tests.tm_board(uuid, boolean) to authenticated;

create function tests.tm_median(p_values double precision[])
returns double precision
language sql immutable
as $$
  select percentile_cont(0.5) within group (order by v) from unnest(p_values) v;
$$;
grant execute on function tests.tm_median(double precision[]) to authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_person uuid;
  v_label text;
  v_old double precision[];
  v_new double precision[];
  v_started timestamptz;
  v_rows_old integer;
  v_rows_new integer;
  v_added double precision;
  v_i integer;
  v_ms double precision;
  v_task uuid;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Timing program', 'timing-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Timing board', v_owner, v_owner) returning id into v_project;

  v_started := clock_timestamp();
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  select v_org, v_project, 'Timing ' || n, v_owner, case when n <= 20 then v_volunteer end
  from generate_series(1, 500) n;
  raise notice 'INFO: inserting 500 tasks in one statement, all access triggers included: % ms',
    round(extract(epoch from clock_timestamp() - v_started) * 1000);

  v_started := clock_timestamp();
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source)
  values (v_org, v_project, v_staff, 'contributor', 'direct');
  raise notice 'INFO: giving a person a 500-task project: % ms',
    round(extract(epoch from clock_timestamp() - v_started) * 1000);
  analyze public.task;
  analyze app.access_cache;

  foreach v_person in array array[v_owner, v_staff, v_volunteer] loop
    v_label := case v_person when v_owner then 'owner (two-step sign-in)' when v_staff then 'staff with a project grant'
               else 'volunteer with 20 assigned tasks' end;
    perform tests.authenticate(v_person);
    v_old := array[]::double precision[];
    v_new := array[]::double precision[];
    for v_i in 1..30 loop
      v_started := clock_timestamp();
      v_rows_old := tests.tm_board(v_project, false);
      v_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
      if v_i > 5 then v_old := v_old || v_ms; end if;
      v_started := clock_timestamp();
      v_rows_new := tests.tm_board(v_project, true);
      v_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
      if v_i > 5 then v_new := v_new || v_ms; end if;
    end loop;
    v_added := tests.tm_median(v_new) - tests.tm_median(v_old);
    perform tests.ok(v_rows_old = v_rows_new,
      format('500-task board, %s: the cache form returns the same %s rows as today''s policy', v_label, v_rows_old));
    perform tests.ok(v_added < 20,
      format('500-task board, %s: today %s ms, with the cache %s ms, added %s ms (limit 20)',
        v_label, round(tests.tm_median(v_old)::numeric, 2), round(tests.tm_median(v_new)::numeric, 2),
        round(v_added::numeric, 2)));

    -- One record at a time: reported, not gated.
    select id into v_task from public.task where project_id = v_project limit 1;
    v_started := clock_timestamp();
    for v_i in 1..200 loop
      perform public.can(v_task, 'edit_content');
    end loop;
    raise notice 'INFO: one-record app.can, %: % µs a call', v_label,
      round(extract(epoch from clock_timestamp() - v_started) * 1000000 / 200);
    reset role;
  end loop;
end;
$$;

rollback;
