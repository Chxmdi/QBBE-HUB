-- W0-7 timing: what app.can (spike_access.can) costs on a board, and what
-- keeping its cache current costs when access changes.
--
-- Builds a "Bench program" with two projects of 500 tasks each (1,000 tasks)
-- on top of the seed and the performance fixture, then measures:
--   board   one project's 500 tasks, read as three people, eight ways (see
--           the variant list below), 30 runs each after 5 warm-up runs;
--   refresh granting and removing access, moving a project, team changes,
--           inserting tasks, each timed as the single statement a person's
--           action would run, triggers included.
-- Needs the spike applied and the tests.* helpers. Everything is rolled back.

begin;

analyze spike_access.object;
analyze spike_access.access_grant;
analyze spike_access.access_cache;

create temp table timing_result (
  section text, label text, runs integer, median_ms numeric, p95_ms numeric, rows_returned integer
);
grant all on timing_result to authenticated;

-- Run a query p_runs times (after 5 warm-ups) as the person, planning it each
-- time as PostgREST would, and materialising every column so no function in
-- the select list can be skipped.
create or replace function pg_temp.time_query(
  p_section text, p_label text, p_user uuid, p_level text, p_sql text, p_runs integer default 30
)
returns void
language plpgsql
as $$
declare
  v_times numeric[] := '{}';
  v_started timestamptz;
  v_rows integer;
  i integer;
begin
  perform tests.authenticate(p_user, p_level);
  for i in 1 .. p_runs + 5 loop
    v_started := clock_timestamp();
    execute format('select coalesce(cardinality(array_agg(q)), 0) from (%s) q', p_sql)
      into v_rows;
    if i > 5 then
      v_times := v_times || (extract(epoch from clock_timestamp() - v_started) * 1000)::numeric;
    end if;
  end loop;
  perform tests.clear_auth();
  perform set_config('role', 'postgres', true);
  insert into timing_result
  select p_section, p_label, p_runs,
         round(percentile_cont(0.5) within group (order by t)::numeric, 2),
         round(percentile_cont(0.95) within group (order by t)::numeric, 2),
         v_rows
  from unnest(v_times) as t;
end;
$$;

-- Time one statement, run as the database owner (triggers fire as in the app).
create or replace function pg_temp.time_statement(p_section text, p_label text, p_sql text)
returns void
language plpgsql
as $$
declare
  v_started timestamptz := clock_timestamp();
begin
  execute p_sql;
  insert into timing_result values (
    p_section, p_label, 1,
    round((extract(epoch from clock_timestamp() - v_started) * 1000)::numeric, 2), null, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Bench data. The inserts are timed too: that is the dual-write and cache
-- cost of creating tasks.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_program uuid;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Bench program', 'bench-program', v_owner, v_owner)
  returning id into v_program;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Bench other program', 'bench-other-program', v_owner);
  insert into public.project (organization_id, program_id, name, owner_id, stage, created_by)
  values (v_org, v_program, 'Bench board A', v_owner, 'planning', v_owner),
         (v_org, v_program, 'Bench board B', v_owner, 'planning', v_owner);
  -- Perf staff 01..05 are contributors on board A; perf volunteer 40 is
  -- assigned 20 of its tasks and has no other access to it.
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  select v_org, p.id, ('bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0'))::uuid, 'contributor', 'direct', v_owner
  from public.project p cross join generate_series(1, 5) n
  where p.name = 'Bench board A';
end
$$;

select pg_temp.time_statement('refresh', 'insert 500 tasks into board A (one statement)', $sql$
  insert into public.task (organization_id, project_id, title, status, priority, sort_key, created_by, assignee_id)
  select p.organization_id, p.id, 'Bench A task ' || n,
         (array['not_started', 'in_progress'])[1 + n % 2]::public.task_status,
         (array['low', 'medium', 'high', 'critical'])[1 + n % 4]::public.task_priority,
         n, p.owner_id,
         case when n <= 20 then 'bbbbbbbb-bbbb-bbbb-bbbb-000000000040'::uuid end
  from public.project p cross join generate_series(1, 500) n
  where p.name = 'Bench board A'
$sql$);

-- The same 500 tasks into board B with the spike's task trigger switched off:
-- the difference is the dual-write and cache cost of a bulk insert.
alter table public.task disable trigger a_spike_access_sync;
select pg_temp.time_statement('refresh', 'insert 500 tasks into board B, spike trigger off (baseline)', $sql$
  insert into public.task (organization_id, project_id, title, status, priority, sort_key, created_by)
  select p.organization_id, p.id, 'Bench B task ' || n,
         (array['not_started', 'in_progress'])[1 + n % 2]::public.task_status,
         (array['low', 'medium', 'high', 'critical'])[1 + n % 4]::public.task_priority,
         n, p.owner_id
  from public.project p cross join generate_series(1, 500) n
  where p.name = 'Bench board B'
$sql$);
alter table public.task enable trigger a_spike_access_sync;
-- Bring board B's tasks into the model (what the trigger would have done).
do $$ begin perform spike_access.sync_task(t) from public.task t where t.title like 'Bench B task %'; end $$;

analyze public.task;
analyze spike_access.object;
analyze spike_access.access_grant;
analyze spike_access.access_cache;

-- ---------------------------------------------------------------------------
-- Board variants:
--   a. today             task_read as it is (the #115 set-based policy)
--   b. + can(view)       today's policy, plus spike_access.can(id,'view') per row
--   c. + can(edit) flag  today's policy, plus an edit flag per row from app.can
--   d. + today's flag    today's policy, plus the same flag from
--                        has_task_capability (what a board would call today)
--   e. cache policy      task_read replaced by the cache-based policy
--   f. + set-based flag  the cache policy, plus an edit flag from the cache
-- ---------------------------------------------------------------------------
create temp table bench_board as
  select id from public.project where name = 'Bench board A';
grant select on bench_board to authenticated;

do $$
declare
  v_people constant jsonb := jsonb_build_array(
    jsonb_build_object('who', 'owner (org-wide, MFA)', 'id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal', 'aal2'),
    jsonb_build_object('who', 'staff contributor (project grant)', 'id', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'aal', 'aal1'),
    jsonb_build_object('who', 'volunteer (20 assigned tasks)', 'id', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000040', 'aal', 'aal1'));
  -- Two shapes: one project's board (all 500 of board A's tasks), and the
  -- workspace /board as src/features/tasks/services/task.queries.ts builds it
  -- (every unarchived task the person can read, by sort order), at 500 rows.
  v_boards constant text[] := array[
    'project board|select t.id, t.title, t.status, t.priority, t.assignee_id, t.due_at%s from public.task t '
    'where t.project_id = (select id from bench_board) and t.archived_at is null%s order by t.sort_key',
    'workspace board|select t.id, t.title, t.status, t.priority, t.assignee_id, t.due_at%s from public.task t '
    'where t.archived_at is null%s order by t.sort_key, t.created_at desc limit 500'];
  v_shape text;
  v_name text;
  v_board text;
  v_person jsonb;
begin
  foreach v_shape in array v_boards loop
  v_name := split_part(v_shape, '|', 1);
  v_board := split_part(v_shape, '|', 2);
  for v_person in select * from jsonb_array_elements(v_people) loop
    perform pg_temp.time_query('board', v_name || ' | ' || (v_person->>'who') || ' | a. today',
      (v_person->>'id')::uuid, v_person->>'aal', format(v_board, '', ''));
    perform pg_temp.time_query('board', v_name || ' | ' || (v_person->>'who') || ' | b. today + can(view) per row',
      (v_person->>'id')::uuid, v_person->>'aal',
      format(v_board, '', ' and spike_access.can(t.id, ''view'')'));
    perform pg_temp.time_query('board', v_name || ' | ' || (v_person->>'who') || ' | c. today + can(edit) flag per row',
      (v_person->>'id')::uuid, v_person->>'aal',
      format(v_board, ', spike_access.can(t.id, ''edit_content'') as can_edit', ''));
    perform pg_temp.time_query('board', v_name || ' | ' || (v_person->>'who') || ' | d. today + has_task_capability edit flag',
      (v_person->>'id')::uuid, v_person->>'aal',
      format(v_board,
        ', (public.has_task_capability(t.id, ''manage'') or public.has_task_capability(t.id, ''collaborate'')'
        ' or public.has_task_capability(t.id, ''review'') or public.has_task_capability(t.id, ''approve'')) as can_edit',
        ''), 10);
  end loop;
  end loop;
end
$$;

-- The cache-based policy, in place of today's task_read for the rest of this
-- transaction.
drop policy task_read on public.task;
create policy task_read on public.task for select to authenticated
  using (
    organization_id = any ((select spike_access.my_orgs())::uuid[])
    and (
      organization_id = any ((select spike_access.orgs_where('view'))::uuid[])
      or id in (select spike_access.cached_ids('view'))
    )
  );

do $$
declare
  v_people constant jsonb := jsonb_build_array(
    jsonb_build_object('who', 'owner (org-wide, MFA)', 'id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal', 'aal2'),
    jsonb_build_object('who', 'staff contributor (project grant)', 'id', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'aal', 'aal1'),
    jsonb_build_object('who', 'volunteer (20 assigned tasks)', 'id', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000040', 'aal', 'aal1'));
  v_boards constant text[] := array[
    'project board|select t.id, t.title, t.status, t.priority, t.assignee_id, t.due_at%s from public.task t '
    'where t.project_id = (select id from bench_board) and t.archived_at is null order by t.sort_key',
    'workspace board|select t.id, t.title, t.status, t.priority, t.assignee_id, t.due_at%s from public.task t '
    'where t.archived_at is null order by t.sort_key, t.created_at desc limit 500'];
  v_shape text;
  v_name text;
  v_board text;
  v_person jsonb;
begin
  foreach v_shape in array v_boards loop
  v_name := split_part(v_shape, '|', 1);
  v_board := split_part(v_shape, '|', 2);
  for v_person in select * from jsonb_array_elements(v_people) loop
    perform pg_temp.time_query('board', v_name || ' | ' || (v_person->>'who') || ' | e. cache policy',
      (v_person->>'id')::uuid, v_person->>'aal', format(v_board, ''));
    perform pg_temp.time_query('board', v_name || ' | ' || (v_person->>'who') || ' | f. cache policy + set-based edit flag',
      (v_person->>'id')::uuid, v_person->>'aal',
      format(v_board,
        ', (t.organization_id = any ((select spike_access.orgs_where(''edit_content''))::uuid[])'
        ' or t.id in (select spike_access.cached_ids(''edit_content''))) as can_edit'));
  end loop;
  end loop;
end
$$;


-- ---------------------------------------------------------------------------
-- Refresh: the statement an admin's or owner's action runs, triggers included.
-- ---------------------------------------------------------------------------
select pg_temp.time_statement('refresh', 'add a person to the 1,000-task program (program grant)', $sql$
  insert into public.program_access_grant (organization_id, program_id, user_id, role, source, created_by)
  select p.organization_id, p.id, 'bbbbbbbb-bbbb-bbbb-bbbb-000000000041', 'contributor', 'direct', p.lead_id
  from public.program p where p.slug = 'bench-program'
$sql$);
select pg_temp.time_statement('refresh', 'remove that program grant', $sql$
  delete from public.program_access_grant
  where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000041'
    and program_id = (select id from public.program where slug = 'bench-program')
$sql$);
select pg_temp.time_statement('refresh', 'add a person to one 500-task project (project grant)', $sql$
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  select p.organization_id, p.id, 'bbbbbbbb-bbbb-bbbb-bbbb-000000000042', 'contributor', 'direct', p.owner_id
  from public.project p where p.name = 'Bench board A'
$sql$);
select pg_temp.time_statement('refresh', 'change the program lead (program-level only, 0 tasks)', $sql$
  update public.program set lead_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002' where slug = 'bench-program'
$sql$);
select pg_temp.time_statement('refresh', 'move a 500-task project to another program (all people)', $sql$
  update public.project set program_id = (select id from public.program where slug = 'bench-other-program')
  where name = 'Bench board B'
$sql$);
select pg_temp.time_statement('refresh', 'change one task''s assignee', $sql$
  update public.task set assignee_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000043'
  where id = (select id from public.task where title = 'Bench A task 250')
$sql$);
select pg_temp.time_statement('refresh', 'insert one task', $sql$
  insert into public.task (organization_id, project_id, title, created_by)
  select p.organization_id, p.id, 'Bench single', p.owner_id from public.project p where p.name = 'Bench board A'
$sql$);

-- A team with a (new-model) grant on the 1,000-task program: a person joining
-- the team is one cache refresh for them.
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_team uuid;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.team (organization_id, name, owner_id)
  values (v_org, 'Bench team', v_owner) returning id into v_team;
  insert into spike_access.access_grant (organization_id, object_id, principal_kind, team_id, role_key, source)
  select v_org, p.id, 'team', v_team, 'contributor', 'direct'
  from public.program p where p.slug = 'bench-program';
end
$$;
select pg_temp.time_statement('refresh', 'a person joins a team that has the 1,000-task program', $sql$
  insert into public.team_member (team_id, user_id, organization_id)
  select t.id, 'bbbbbbbb-bbbb-bbbb-bbbb-000000000044', t.organization_id
  from public.team t where t.name = 'Bench team'
$sql$);
select pg_temp.time_statement('refresh', 'full cache rebuild (every person, every object)',
  'select spike_access.rebuild()');

\echo
\echo 'Board: 500 tasks (ms per query, planning included)'
select label, runs, median_ms, p95_ms, rows_returned from timing_result where section = 'board' order by label;
\echo 'Same rows: today''s policy (a) against the cache policy (e), per board and person'
select split_part(a.label, ' | ', 1) as board, split_part(a.label, ' | ', 2) as person,
       a.rows_returned as today_rows, e.rows_returned as cache_policy_rows,
       a.rows_returned = e.rows_returned as same
from timing_result a
join timing_result e
  on split_part(e.label, ' | ', 1) = split_part(a.label, ' | ', 1)
 and split_part(e.label, ' | ', 2) = split_part(a.label, ' | ', 2)
 and split_part(e.label, ' | ', 3) = 'e. cache policy'
where split_part(a.label, ' | ', 3) = 'a. today'
order by 1, 2;
\echo 'Refresh: one statement each, triggers included (ms)'
select label, median_ms as ms from timing_result where section = 'refresh' order by label;
\echo 'Cache size after the bench data'
select count(*) as cache_rows,
       count(distinct user_id) as people,
       round(count(*)::numeric / nullif(count(distinct user_id), 0)) as rows_per_person,
       pg_size_pretty(pg_total_relation_size('spike_access.access_cache')) as table_and_indexes,
       (select count(*) from spike_access.object) as objects,
       (select count(*) from spike_access.access_grant) as grants
from spike_access.access_cache;

rollback;
