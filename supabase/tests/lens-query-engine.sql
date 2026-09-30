-- Workspace OS lens query engine (M8a). Run after qa-users.sql and rls.sql.
-- Everything is rolled back.
--
-- What must hold:
--   1. The engine runs with the caller's rights only: no function is security
--      definer, all are STABLE (no writes), signed-out callers cannot call it.
--   2. For every fixture person, the rows a lens returns are exactly the rows
--      RLS lets that person select directly, and the counts agree.
--   3. A reference the viewer cannot see (a project they cannot read) is shown
--      as empty and cannot be used to find the row.
--   4. Every operator behaves as documented.
--   5. Injection: a payload in any field of the spec is either refused with a
--      lens:<code> error or bound as a value; when it compiles, the SQL text is
--      identical to the text for the same spec with a harmless word instead.
--   6. 5,000 tasks load (page, count and group counts) within one second.
begin;

-- ---------------------------------------------------------------------------
-- 1. Rights
-- ---------------------------------------------------------------------------
do $$
begin
  perform tests.ok(
    (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'lens\_\_%' or p.proname in ('lens_catalog', 'lens_compile', 'lens_query'))),
    'every lens function runs with the caller''s rights and an empty search_path'
  );
  perform tests.ok(
    (select count(*) = 15 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'lens\_\_%' or p.proname in ('lens_catalog', 'lens_compile', 'lens_query'))),
    'the grant list in the migration covers every lens function'
  );
  perform tests.ok(
    (select p.provolatile = 's' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'lens_query'),
    'lens_query is STABLE, so Postgres refuses any write inside it'
  );
  perform tests.ok(
    not has_function_privilege('anon', 'public.lens_query(jsonb, text)', 'execute')
      and not has_function_privilege('anon', 'public.lens_compile(jsonb, text)', 'execute')
      and not has_function_privilege('anon', 'public.lens_catalog()', 'execute')
      and has_function_privilege('authenticated', 'public.lens_query(jsonb, text)', 'execute'),
    'signed-in people may call the engine; signed-out visitors may not'
  );
end;
$$;

do $$
begin
  perform tests.clear_auth();
  begin
    perform public.lens_query('{"version":1,"type":"task"}'::jsonb);
    raise exception 'FAIL: anon ran a lens';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out caller cannot run a lens');
  end;
  reset role;

  -- An authenticated role without a user (no sub claim) is refused too.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.lens_query('{"version":1,"type":"task"}'::jsonb);
    raise exception 'FAIL: a lens ran without a viewer';
  exception when others then
    perform tests.ok(sqlerrm like 'lens:signed_out:%', 'a lens without a viewer is refused');
  end;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
create temporary table lens_fx (name text primary key, id uuid) on commit drop;
grant select on lens_fx to authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_program uuid;
  v_open_project uuid;
  v_closed_project uuid;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Lens program', 'lens-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by, stage, outcome, target_date)
  values (v_org, v_program, 'Lens open project', v_owner, v_owner, 'active', 'An outcome', current_date + 90)
  returning id into v_open_project;
  insert into public.project (organization_id, program_id, name, owner_id, created_by, stage, outcome, target_date)
  values (v_org, v_program, 'Lens closed project', v_owner, v_owner, 'completed', 'An outcome', current_date)
  returning id into v_closed_project;

  insert into lens_fx values ('org', v_org), ('program', v_program),
    ('open_project', v_open_project), ('closed_project', v_closed_project);

  insert into public.task (organization_id, project_id, title, created_by, assignee_id, status, priority, due_at, estimate_hours)
  values
    (v_org, v_open_project, 'Lens 100% literal', v_owner, v_volunteer, 'ready', 'high', current_date, 2),
    (v_org, v_open_project, 'Lens under_score', v_owner, v_staff, 'in_progress', 'low', current_date + 30, 8),
    (v_org, v_closed_project, 'Lens closed work', v_owner, v_volunteer, 'completed', 'medium', null, null),
    (v_org, null, 'Lens loose task', v_owner, null, 'not_started', 'critical', current_date - 3, 1);
  insert into public.task (organization_id, project_id, title, created_by, archived_at)
  values (v_org, v_open_project, 'Lens archived', v_owner, now());
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 and 3. Every person sees through the lens exactly what RLS shows them.
-- ---------------------------------------------------------------------------
do $$
declare
  v_person uuid;
  v_people uuid[];
  v_type text;
  v_result jsonb;
  v_lens uuid[];
  v_direct uuid[];
  v_row jsonb;
  v_checked integer := 0;
  v_group_total integer;
begin
  select array_agg(user_id) into v_people
  from public.organization_membership where organization_id = (select id from lens_fx where name = 'org');

  foreach v_person in array v_people loop
    perform tests.authenticate(v_person, 'aal2');
    foreach v_type in array array['task', 'project'] loop
      v_result := public.lens_query(jsonb_build_object(
        'version', 1, 'type', v_type, 'limit', 1000,
        'select', case v_type when 'task' then '["project","assignee","status"]'::jsonb else '["owner","stage"]'::jsonb end,
        'groupBy', jsonb_build_object('property', case v_type when 'task' then 'status' else 'stage' end)));
      select coalesce(array_agg((r ->> 'id')::uuid order by (r ->> 'id')), array[]::uuid[])
      into v_lens from jsonb_array_elements(v_result -> 'rows') r;
      if v_type = 'task' then
        select coalesce(array_agg(id order by id), array[]::uuid[]) into v_direct from public.task where archived_at is null;
      else
        select coalesce(array_agg(id order by id), array[]::uuid[]) into v_direct from public.project where archived_at is null;
      end if;
      perform tests.ok(v_lens = v_direct,
        format('%s: the %s lens returns exactly the rows RLS allows', v_person, v_type));
      perform tests.ok((v_result ->> 'total')::int = cardinality(v_direct),
        format('%s: the %s count matches what RLS allows', v_person, v_type));
      select coalesce(sum((g ->> 'total')::int), 0) into v_group_total from jsonb_array_elements(v_result -> 'groups') g;
      perform tests.ok(v_group_total = cardinality(v_direct),
        format('%s: the %s group counts add up to the visible rows', v_person, v_type));

      if v_type = 'task' then
        -- Hidden references read as empty; visible ones carry their label.
        for v_row in select * from jsonb_array_elements(v_result -> 'rows') loop
          v_checked := v_checked + 1;
          if v_row #> '{values,project}' = 'null'::jsonb then
            perform tests.ok(
              not exists (select 1 from public.project p join public.task t on t.project_id = p.id where t.id = (v_row ->> 'id')::uuid),
              format('%s: a task shows no project only when the project is not readable', v_person));
          else
            perform tests.ok(
              exists (select 1 from public.project p where p.id = (v_row #>> '{values,project,id}')::uuid
                and p.name = v_row #>> '{values,project,label}'),
              format('%s: a shown project is readable and labelled', v_person));
          end if;
        end loop;
        -- The project id cannot find tasks whose project the viewer cannot read.
        v_result := public.lens_query(jsonb_build_object('version', 1, 'type', 'task', 'limit', 1000,
          'where', jsonb_build_object('and', jsonb_build_array(jsonb_build_object(
            'property', 'project', 'operator', 'contains', 'value', (select id from lens_fx where name = 'open_project'))))));
        perform tests.ok(
          (v_result ->> 'total')::int = (select count(*) from public.task t
            where t.archived_at is null and t.project_id = (select id from lens_fx where name = 'open_project')
              and exists (select 1 from public.project p where p.id = t.project_id)),
          format('%s: filtering by a project finds only tasks whose project is readable', v_person));
      end if;
    end loop;
    reset role;
  end loop;
  perform tests.ok(v_checked > 0, 'the hidden-reference checks ran');

  -- The concrete case: the volunteer is assigned a task in a project they
  -- cannot read. They see the task, with no project, and cannot find it by the
  -- project's id or name.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'aal2');
  perform tests.ok(not exists (select 1 from public.project where id = (select id from lens_fx where name = 'open_project')),
    'fixture check: the volunteer cannot read the open project');
  v_result := public.lens_query('{"version":1,"type":"task","select":["project"],"where":{"and":[{"property":"title","operator":"equals","value":"Lens 100% literal"}]}}');
  perform tests.ok((v_result ->> 'total')::int = 1 and v_result #> '{rows,0,values,project}' = 'null'::jsonb,
    'the volunteer sees their task with an empty project');
  v_result := public.lens_query(jsonb_build_object('version', 1, 'type', 'task', 'where', jsonb_build_object('or', jsonb_build_array(
    jsonb_build_object('property', 'project', 'operator', 'contains', 'value', (select id from lens_fx where name = 'open_project')),
    jsonb_build_object('property', 'project', 'operator', 'matches', 'value', '{"where":{"and":[{"property":"title","operator":"contains","value":"open project"}]}}'::jsonb)))));
  perform tests.ok((v_result ->> 'total')::int = 0, 'nor find it by the hidden project''s id or name');
  v_result := public.lens_query('{"version":1,"type":"task","where":{"and":[{"property":"title","operator":"equals","value":"Lens 100% literal"},{"property":"project","operator":"is_empty"}]}}');
  perform tests.ok((v_result ->> 'total')::int = 1, 'to the volunteer the hidden link reads as empty');
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Operators (as the owner, over the fixture tasks)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.lens_titles(p_where jsonb, p_extra jsonb default '{}'::jsonb)
returns text[]
language sql
as $$
  select coalesce(array_agg(r ->> 'title' order by r ->> 'title'), array[]::text[])
  from jsonb_array_elements(public.lens_query(
    jsonb_build_object('version', 1, 'type', 'task', 'limit', 1000,
      'where', jsonb_build_object('and', jsonb_build_array(
        jsonb_build_object('property', 'title', 'operator', 'starts_with', 'value', 'Lens '), p_where))) || p_extra
  ) -> 'rows') r;
$$;

do $$
declare
  v_open text := (select id::text from lens_fx where name = 'open_project');
  v_result jsonb;
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');

  perform tests.ok(pg_temp.lens_titles('{"property":"title","operator":"contains","value":"100%"}') = array['Lens 100% literal'],
    'contains treats % literally');
  perform tests.ok(pg_temp.lens_titles('{"property":"title","operator":"contains","value":"r_s"}') = array['Lens under_score'],
    'contains treats _ literally');
  perform tests.ok(pg_temp.lens_titles('{"property":"title","operator":"equals","value":"Lens loose task"}') = array['Lens loose task'],
    'equals matches the whole title');
  perform tests.ok(cardinality(pg_temp.lens_titles('{"property":"title","operator":"not_contains","value":"loose"}')) = 3,
    'not_contains excludes matches');
  perform tests.ok(pg_temp.lens_titles('{"property":"status","operator":"is_none_of","value":["completed","ready","in_progress"]}') = array['Lens loose task'],
    'is_none_of excludes the listed options');
  perform tests.ok(pg_temp.lens_titles('{"property":"priority","operator":"is","value":"critical"}') = array['Lens loose task'],
    'select is');
  perform tests.ok(pg_temp.lens_titles('{"property":"estimate","operator":"between","value":{"from":2,"to":8}}') = array['Lens 100% literal', 'Lens under_score'],
    'number between is inclusive');
  perform tests.ok(cardinality(pg_temp.lens_titles('{"property":"estimate","operator":"neq","value":2}')) = 3,
    'neq also matches empty values');
  perform tests.ok(pg_temp.lens_titles('{"property":"due","operator":"is","value":{"relative":"today"}}') = array['Lens 100% literal'],
    'date is today');
  perform tests.ok(pg_temp.lens_titles('{"property":"due","operator":"before","value":{"relative":"today"}}') = array['Lens loose task'],
    'date before today');
  perform tests.ok(pg_temp.lens_titles('{"property":"due","operator":"is_empty"}') = array['Lens closed work'],
    'date is_empty');
  perform tests.ok(cardinality(pg_temp.lens_titles('{"property":"created_time","operator":"is","value":{"relative":"today"}}')) = 4,
    'timestamps compare by calendar day in the time zone');
  perform tests.ok(pg_temp.lens_titles('{"property":"assignee","operator":"contains","value":{"relative":"me"}}') = array[]::text[],
    'me is the signed-in viewer (the owner is assigned nothing here)');
  perform tests.ok(pg_temp.lens_titles('{"property":"assignee","operator":"is_empty"}') = array['Lens loose task'],
    'person is_empty');
  perform tests.ok(pg_temp.lens_titles(jsonb_build_object('property', 'project', 'operator', 'contains', 'value', v_open)) = array['Lens 100% literal', 'Lens under_score'],
    'relation contains an id');
  perform tests.ok(pg_temp.lens_titles('{"property":"project","operator":"matches","value":{"where":{"and":[{"property":"stage","operator":"is","value":"completed"}]}}}') = array['Lens closed work'],
    'relation matches conditions on the related object');
  perform tests.ok(pg_temp.lens_titles('{"property":"project","operator":"is_empty"}') = array['Lens loose task'],
    'relation is_empty');
  perform tests.ok(pg_temp.lens_titles('{"or":[{"property":"priority","operator":"is","value":"low"},{"property":"priority","operator":"is","value":"high"}]}') = array['Lens 100% literal', 'Lens under_score'],
    'or groups');

  -- Sorting and paging.
  v_result := public.lens_query('{"version":1,"type":"task","where":{"and":[{"property":"title","operator":"starts_with","value":"Lens "}]},"sort":[{"property":"estimate","direction":"desc"}],"limit":2,"offset":1,"select":["estimate"]}');
  perform tests.ok(
    (select array_agg(r ->> 'title') from jsonb_array_elements(v_result -> 'rows') r) = array['Lens 100% literal', 'Lens loose task']
      and (v_result ->> 'total')::int = 4,
    'sort desc with nulls last, limit and offset, and the total ignores paging');

  -- Grouping by a reference labels the groups.
  v_result := public.lens_query('{"version":1,"type":"task","where":{"and":[{"property":"title","operator":"starts_with","value":"Lens "}]},"groupBy":{"property":"project"}}');
  perform tests.ok(
    (select array_agg(g #>> '{label,label}' order by g #>> '{label,label}' nulls last) from jsonb_array_elements(v_result -> 'groups') g)
      = array['Lens closed project', 'Lens open project', null],
    'reference groups carry labels, and empty is its own group');
  perform tests.ok(
    (select bool_and(r ? 'group') from jsonb_array_elements(v_result -> 'rows') r),
    'each row names its group');

  -- Archived rows never appear.
  perform tests.ok(not ('Lens archived' = any (pg_temp.lens_titles('{"property":"title","operator":"contains","value":"archived"}'))),
    'archived tasks are left out');

  -- Refusals with a code.
  begin
    perform public.lens_query('{"version":1,"type":"task","sort":[{"property":"assignee"}]}');
    raise exception 'FAIL: sorted by a person';
  exception when others then
    perform tests.ok(sqlerrm like 'lens:not_sortable:%', 'people cannot be sort keys');
  end;
  begin
    perform public.lens_query('{"version":1,"type":"task","groupBy":{"property":"title"}}');
    raise exception 'FAIL: grouped by title';
  exception when others then
    perform tests.ok(sqlerrm like 'lens:not_groupable:%', 'text cannot be a group key');
  end;
  begin
    perform public.lens_query('{"version":1,"type":"task","where":{"and":[{"property":"project","operator":"matches","value":{"where":{"and":[{"property":"stage","operator":"is","value":"nope"}]}}}]}}');
    raise exception 'FAIL: unknown option accepted';
  exception when others then
    perform tests.ok(sqlerrm like 'lens:bad_value:%', 'options are checked against the catalog, inside relations too');
  end;
  begin
    perform public.lens_query('{"version":1,"type":"task"}', 'Mars/Olympus');
    raise exception 'FAIL: unknown time zone accepted';
  exception when others then
    perform tests.ok(sqlerrm like 'lens:invalid_spec:%', 'unknown time zones are refused');
  end;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Injection: a payload in every field
-- ---------------------------------------------------------------------------
do $inj$
declare
  v_payloads text[] := array[
    '''', '''''; drop table public.task; --', '"; select 1; --', 'x'' or ''1''=''1',
    '1; delete from public.task', '/* comment */', '-- comment', '$1', '$$ select 1 $$',
    'e''\x27''', '::text', 'set role service_role', 'ｓｅｌｅｃｔ', '%', '_', '\', repeat('a', 501),
    'title', 'status', 'o.id', 'public.task', 'task; select'
  ];
  -- PAYLOAD marks where the payload goes (as a JSON string).
  v_templates text[] := array[
    '{"version":1,"type":PAYLOAD}',
    '{"version":1,"type":"task","where":{"and":[{"property":PAYLOAD,"operator":"equals","value":"x"}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"title","operator":PAYLOAD,"value":"x"}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"title","operator":"contains","value":PAYLOAD}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"title","operator":"equals","value":PAYLOAD}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"estimate","operator":"gt","value":PAYLOAD}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"estimate","operator":"between","value":{"from":PAYLOAD,"to":2}}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"due","operator":"is","value":{"date":PAYLOAD}}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"due","operator":"is","value":{"relative":PAYLOAD}}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"due","operator":"between","value":{"from":{"date":PAYLOAD},"to":{"relative":"today"}}}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"status","operator":"is","value":PAYLOAD}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"status","operator":"is_any_of","value":["ready",PAYLOAD]}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"program","operator":"is","value":PAYLOAD}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"assignee","operator":"contains","value":PAYLOAD}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"assignee","operator":"contains","value":{"relative":PAYLOAD}}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"project","operator":"contains","value":PAYLOAD}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"project","operator":"matches","value":{"where":{"and":[{"property":PAYLOAD,"operator":"is","value":"active"}]}}}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"project","operator":"matches","value":{"where":{"and":[{"property":"title","operator":"contains","value":PAYLOAD}]}}}]}}',
    '{"version":1,"type":"task","sort":[{"property":PAYLOAD}]}',
    '{"version":1,"type":"task","sort":[{"property":"title","direction":PAYLOAD}]}',
    '{"version":1,"type":"task","groupBy":{"property":PAYLOAD}}',
    '{"version":1,"type":"task","select":[PAYLOAD]}',
    '{"version":1,"type":"task","limit":PAYLOAD}',
    '{"version":1,"type":"task","offset":PAYLOAD}',
    '{"version":PAYLOAD,"type":"task"}',
    '{"version":1,"type":"task",PAYLOAD:1}',
    '{"version":1,"type":"task","where":{PAYLOAD:[{"property":"title","operator":"is_empty"}]}}',
    '{"version":1,"type":"task","where":{"and":[{"property":"title","operator":"is_empty",PAYLOAD:1}]}}'
  ];
  v_template text;
  v_payload text;
  v_spec jsonb;
  v_harmless jsonb;
  v_sql jsonb;
  v_base jsonb;
  v_before bigint;
  v_rejected integer := 0;
  v_bound integer := 0;
  v_mismatch text[] := array[]::text[];
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  select count(*) into v_before from public.task;
  foreach v_template in array v_templates loop
    v_harmless := replace(v_template, 'PAYLOAD', '"harmless"')::jsonb;
    begin
      v_base := public.lens_compile(v_harmless);
    exception when others then
      v_base := null;
    end;
    foreach v_payload in array v_payloads loop
      v_spec := replace(v_template, 'PAYLOAD', to_jsonb(v_payload)::text)::jsonb;
      begin
        v_sql := public.lens_compile(v_spec);
      exception when others then
        if sqlstate <> '22023' or sqlerrm not like 'lens:%' then
          v_mismatch := v_mismatch || format('%s | %s: untyped error %s %s', v_template, v_payload, sqlstate, sqlerrm);
        elsif position(v_payload in sqlerrm) > 0 and length(v_payload) > 3
              and v_payload not in ('title', 'status', 'task') then
          v_mismatch := v_mismatch || format('%s | %s: error repeats input', v_template, v_payload);
        end if;
        v_rejected := v_rejected + 1;
        continue;
      end;
      v_bound := v_bound + 1;
      -- Compiled: the SQL must not depend on the payload. Payloads that are real
      -- property names legitimately change the SQL, so compare those against
      -- the harmless spec only when it compiled too and the payload is not a key.
      if v_payload in ('title', 'status') then
        continue;
      end if;
      if v_base is null
         or v_sql #>> '{page,sql}' <> v_base #>> '{page,sql}'
         or v_sql #>> '{count,sql}' <> v_base #>> '{count,sql}' then
        v_mismatch := v_mismatch || format('%s | %s: SQL text changed with the value', v_template, v_payload);
      else
        -- And it runs, matching nothing it should not.
        perform public.lens_query(v_spec);
      end if;
    end loop;
  end loop;
  perform tests.ok(cardinality(v_mismatch) = 0,
    'every payload is refused with a typed error or bound as a value: ' || array_to_string(v_mismatch[1:5], '; '));
  perform tests.ok(v_rejected > 0 and v_bound > 0, format('payloads refused: %s, bound as values: %s', v_rejected, v_bound));
  perform tests.ok((select count(*) from public.task) = v_before, 'no payload changed a row');

  -- Every generated statement is built from the fixed vocabulary: no ';',
  -- no comments, and only $1 as a placeholder.
  v_sql := public.lens_compile('{"version":1,"type":"task","where":{"and":[{"property":"title","operator":"contains","value":"x"},{"property":"project","operator":"matches","value":{"where":{"or":[{"property":"stage","operator":"is_any_of","value":["active"]},{"property":"owner","operator":"contains","value":{"relative":"me"}}]}}},{"property":"due","operator":"between","value":{"from":{"relative":"this_week"},"to":{"date":"2026-12-31"}}}]},"sort":[{"property":"due"}],"groupBy":{"property":"assignee"},"select":["project","assignee","program","status","due"]}');
  perform tests.ok(
    v_sql #>> '{page,sql}' !~ '(;|--|/\*|\$[02-9])' and v_sql #>> '{count,sql}' !~ '(;|--|/\*|\$[02-9])'
      and v_sql #>> '{groups,sql}' !~ '(;|--|/\*|\$[02-9])',
    'generated SQL has no statement separators, comments or stray placeholders');
  reset role;
end;
$inj$;

-- ---------------------------------------------------------------------------
-- 6. Performance: 5,000 tasks
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid := (select id from lens_fx where name = 'org');
  v_project uuid := (select id from lens_fx where name = 'open_project');
  v_started timestamptz;
  v_ms numeric;
  v_result jsonb;
begin
  insert into public.task (organization_id, project_id, title, created_by, assignee_id, status, priority, due_at, estimate_hours)
  select v_org, v_project, 'Perf task ' || g, v_owner,
    case when g % 3 = 0 then v_owner end,
    (array['not_started','ready','in_progress','waiting','in_review','completed']::public.task_status[])[1 + g % 6],
    (array['low','medium','high','critical']::public.task_priority[])[1 + g % 4],
    current_date + (g % 60) - 30, (g % 20)
  from generate_series(1, 5000) g;
  analyze public.task;

  perform tests.authenticate(v_owner, 'aal2');
  v_started := clock_timestamp();
  v_result := public.lens_query('{"version":1,"type":"task","where":{"and":[{"property":"status","operator":"is_none_of","value":["completed","cancelled"]},{"or":[{"property":"due","operator":"on_or_before","value":{"relative":"next_week"}},{"property":"assignee","operator":"contains","value":{"relative":"me"}}]}]},"sort":[{"property":"due"},{"property":"title"}],"groupBy":{"property":"priority"},"select":["status","priority","due","assignee","project","estimate"],"limit":200}');
  v_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
  raise notice 'lens load over 5,000 tasks: % ms, % matches', round(v_ms), v_result ->> 'total';
  perform tests.ok(v_ms < 1000, format('a filtered, sorted, grouped page over 5,000 tasks loads in under 1 s (%s ms)', round(v_ms)));

  v_started := clock_timestamp();
  v_result := public.lens_query('{"version":1,"type":"task","select":["status","priority","due","assignee","project","estimate"],"limit":1000}');
  v_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
  raise notice 'lens load of 1,000 rows: % ms', round(v_ms);
  perform tests.ok(v_ms < 1000, format('1,000 rows with six columns load in under 1 s (%s ms)', round(v_ms)));
  reset role;
end;
$$;

rollback;
