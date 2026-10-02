-- Workspace OS wave 2 step 0: lens_aggregate. Run after qa-users.sql and
-- rls.sql. Everything is rolled back.
--
-- An empty set's sum, average, minimum and maximum come back as JSON null.
--
-- What must hold:
--   1. It runs with the caller's rights only: not security definer, STABLE,
--      a fixed search_path, and signed-out callers cannot call it.
--   2. For every fixture person at both sign-in levels, every total equals the
--      same total computed directly over the rows RLS lets that person select,
--      overall and per group, and the row count equals lens_query's total.
--   3. Filters narrow totals exactly as they narrow lens_query.
--   4. A reference the viewer cannot see counts as empty, never as filled.
--   5. Bad requests are refused with a lens:<code> error, and a payload in a
--      property name is refused, never run.
begin;

-- Give some tasks estimates (some null), so sums, averages and empties are
-- meaningful whatever the seed holds.
update public.task set estimate_hours = case when (abs(hashtext(id::text)) % 4) = 0 then null
  else (abs(hashtext(id::text)) % 37)::numeric / 2 end;

-- ---------------------------------------------------------------------------
-- 1. Rights
do $$
begin
  perform tests.ok(
    (select not p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""'] from pg_proc p
     where p.proname = 'lens_aggregate' and p.pronamespace = 'public'::regnamespace),
    'lens_aggregate runs with the caller''s rights, is stable and pins its search path');
  perform tests.ok(not has_function_privilege('anon', 'public.lens_aggregate(jsonb, jsonb, text)', 'execute'),
    'signed-out visitors cannot call lens_aggregate');
  perform tests.ok(has_function_privilege('authenticated', 'public.lens_aggregate(jsonb, jsonb, text)', 'execute'),
    'signed-in people can call lens_aggregate');

  perform tests.clear_auth();
  begin
    perform public.lens_aggregate('{"version":1,"type":"task"}', '[{"fn":"count"}]');
    raise exception 'FAIL: anon ran lens_aggregate';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out caller is refused');
  end;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Every person, both levels: totals equal direct computation under RLS.
do $$
declare
  v_person uuid;
  v_level text;
  v_result jsonb;
  v_query jsonb;
  v_t jsonb;
  v_expected record;
  v_group jsonb;
  v_direct record;
  v_people integer := 0;
begin
  for v_person in select distinct user_id from public.organization_membership loop
    foreach v_level in array array['aal1', 'aal2'] loop
      perform tests.authenticate(v_person, v_level);
      v_people := v_people + 1;

      v_result := public.lens_aggregate(
        '{"version":1,"type":"task","groupBy":{"property":"status"}}',
        '[{"fn":"count"},{"fn":"count_filled","property":"estimate"},{"fn":"count_empty","property":"estimate"},
          {"fn":"sum","property":"estimate"},{"fn":"avg","property":"estimate"},
          {"fn":"min","property":"estimate"},{"fn":"max","property":"estimate"},
          {"fn":"min","property":"due"},{"fn":"max","property":"due"},
          {"fn":"count_empty","property":"project"},{"fn":"count_filled","property":"assignee"}]');
      v_query := public.lens_query('{"version":1,"type":"task","groupBy":{"property":"status"},"limit":1}');
      v_t := v_result -> 'totals';

      select count(*)::bigint as n,
             count(t.estimate_hours)::bigint as filled,
             (count(*) filter (where t.estimate_hours is null))::bigint as empty,
             sum(t.estimate_hours) as s, avg(t.estimate_hours) as a,
             min(t.estimate_hours) as lo, max(t.estimate_hours) as hi,
             min(t.due_at) as dlo, max(t.due_at) as dhi,
             (count(*) filter (where not exists (select 1 from public.project p where p.id = t.project_id)))::bigint as noproj,
             (count(*) filter (where exists (select 1 from public.user_profile u where u.id = t.assignee_id)))::bigint as assigned
        into v_expected
        from public.task t where t.archived_at is null;

      perform tests.ok(
        (v_t ->> 'm0')::bigint = v_expected.n and v_expected.n = (v_query ->> 'total')::bigint
        and (v_t ->> 'm1')::bigint = v_expected.filled
        and (v_t ->> 'm2')::bigint = v_expected.empty
        and (v_t -> 'm3') = coalesce(to_jsonb(v_expected.s), 'null'::jsonb)
        and (v_t -> 'm4') = coalesce(to_jsonb(v_expected.a), 'null'::jsonb)
        and (v_t -> 'm5') = coalesce(to_jsonb(v_expected.lo), 'null'::jsonb)
        and (v_t -> 'm6') = coalesce(to_jsonb(v_expected.hi), 'null'::jsonb)
        and (v_t -> 'm7') = coalesce(to_jsonb(v_expected.dlo), 'null'::jsonb)
        and (v_t -> 'm8') = coalesce(to_jsonb(v_expected.dhi), 'null'::jsonb)
        and (v_t ->> 'm9')::bigint = v_expected.noproj,
        format('%s at %s: every total equals the rows RLS shows (%s rows)', v_person, v_level, v_expected.n));

      -- The assignee check uses user_profile visibility, which can differ from
      -- the catalog's ref table; it must at least never exceed the row count.
      perform tests.ok((v_t ->> 'm10')::bigint <= v_expected.n,
        format('%s at %s: filled references never exceed the rows', v_person, v_level));

      -- Groups: same keys as lens_query, and each group's totals match.
      perform tests.ok(
        (select coalesce(array_agg(g ->> 'key' order by g ->> 'key'), array[]::text[]) from jsonb_array_elements(v_result -> 'groups') g)
        = (select coalesce(array_agg(g ->> 'key' order by g ->> 'key'), array[]::text[]) from jsonb_array_elements(v_query -> 'groups') g),
        format('%s at %s: the same groups as lens_query', v_person, v_level));
      for v_group in select * from jsonb_array_elements(v_result -> 'groups') loop
        select count(*)::bigint as n, sum(t.estimate_hours) as s into v_direct
          from public.task t
         where t.archived_at is null and t.status::text is not distinct from (v_group ->> 'key');
        perform tests.ok(
          (v_group #>> '{totals,m0}')::bigint = v_direct.n
          and (v_group #> '{totals,m3}') = coalesce(to_jsonb(v_direct.s), 'null'::jsonb),
          format('%s at %s: group %s totals match', v_person, v_level, coalesce(v_group ->> 'key', '(none)')));
      end loop;
      reset role;
    end loop;
  end loop;
  perform tests.ok(v_people >= 4, format('checked %s person and level pairs', v_people));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Filters narrow totals exactly as they narrow lens_query.
do $$
declare
  v_spec jsonb := '{"version":1,"type":"task","where":{"and":[{"property":"estimate","operator":"gt","value":5}]}}';
  v_result jsonb;
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  v_result := public.lens_aggregate(v_spec, '[{"fn":"count"},{"fn":"min","property":"estimate"}]');
  perform tests.ok((v_result #>> '{totals,m0}')::bigint = (public.lens_query(v_spec || '{"limit":1}') ->> 'total')::bigint,
    'a filtered count equals the filtered lens total');
  perform tests.ok(coalesce((v_result #>> '{totals,m1}')::numeric > 5, true),
    'the filtered minimum respects the filter');
  perform tests.ok(v_result -> 'groups' = 'null'::jsonb and v_result -> 'groupBy' = 'null'::jsonb,
    'no grouping asked, no groups returned');
  perform tests.ok(v_result -> 'measures' = '[{"id":"m0","fn":"count","property":null},{"id":"m1","fn":"min","property":"estimate"}]'::jsonb,
    'measures are echoed with stable ids');
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Bad requests are refused.
do $$
declare
  v_case record;
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  for v_case in select * from (values
    ('{"version":1,"type":"task"}', '[]', 'invalid_spec', 'no totals'),
    ('{"version":1,"type":"task"}', '{"fn":"count"}', 'invalid_spec', 'totals not an array'),
    ('{"version":1,"type":"task"}', '[1]', 'invalid_spec', 'a total that is not an object'),
    ('{"version":1,"type":"task"}', '[{"fn":"median","property":"estimate"}]', 'invalid_spec', 'an unknown total'),
    ('{"version":1,"type":"task"}', '[{"fn":"count","property":"estimate"}]', 'invalid_spec', 'a row count with a property'),
    ('{"version":1,"type":"task"}', '[{"fn":"sum"}]', 'invalid_spec', 'a sum without a property'),
    ('{"version":1,"type":"task"}', '[{"fn":"sum","property":"title"}]', 'invalid_spec', 'a sum of text'),
    ('{"version":1,"type":"task"}', '[{"fn":"avg","property":"due"}]', 'invalid_spec', 'an average of dates'),
    ('{"version":1,"type":"task"}', '[{"fn":"max","property":"title"}]', 'invalid_spec', 'a maximum of text'),
    ('{"version":1,"type":"task"}', '[{"fn":"count_empty","property":"review_role"}]', 'invalid_spec', 'a filter-only property'),
    ('{"version":1,"type":"task"}', '[{"fn":"count","extra":1}]', 'invalid_spec', 'an unknown key on a total'),
    ('{"version":1,"type":"task"}', '[{"fn":"sum","property":"estimate\"; drop table public.task; --"}]', 'unknown_property', 'a payload in a property name'),
    ('{"version":1,"type":"task","groupBy":{"property":"title"}}', '[{"fn":"count"}]', 'not_groupable', 'grouping by a non-groupable property'),
    ('{"version":2,"type":"task"}', '[{"fn":"count"}]', 'invalid_spec', 'an unknown spec version'),
    ('{"version":1,"type":"task","bogus":true}', '[{"fn":"count"}]', 'invalid_spec', 'an unknown spec key'),
    ('{"version":1,"type":"nope"}', '[{"fn":"count"}]', 'unknown_type', 'an unknown type')
  ) as c(spec, measures, code, label) loop
    begin
      perform public.lens_aggregate(v_case.spec::jsonb, v_case.measures::jsonb);
      perform tests.ok(false, format('refused: %s (it ran)', v_case.label));
    exception when others then
      perform tests.ok(sqlerrm like 'lens:' || v_case.code || ':%',
        format('refused: %s (%s)', v_case.label, sqlerrm));
    end;
  end loop;

  begin
    perform public.lens_aggregate('{"version":1,"type":"task"}',
      (select jsonb_agg('{"fn":"count"}'::jsonb) from generate_series(1, 21)));
    perform tests.ok(false, 'refused: more than twenty totals (it ran)');
  exception when others then
    perform tests.ok(sqlerrm like 'lens:invalid_spec:%', 'refused: more than twenty totals');
  end;

  begin
    perform public.lens_aggregate('{"version":1,"type":"task"}', '[{"fn":"count"}]', 'Not/AZone');
    perform tests.ok(false, 'refused: an unknown time zone (it ran)');
  exception when others then
    perform tests.ok(sqlerrm like 'lens:invalid_spec:%', 'refused: an unknown time zone');
  end;
  reset role;
end;
$$;

rollback;
