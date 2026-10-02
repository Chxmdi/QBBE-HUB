-- Workspace OS wave 2 unit D3: charts. Run after qa-users.sql and rls.sql.
-- Everything is rolled back.
--
-- A chart (a view block's chart layout or a dashboard chart tile) asks
-- lens_aggregate for one total (count, sum or average) over its view's spec,
-- grouped by one property, or ungrouped for a single number. What must hold:
--   1. For every fixture person at both sign-in levels, each chart's figures
--      equal the same figures computed directly over the rows RLS lets that
--      person select: a chart never counts a record its viewer cannot open.
--   2. Two viewers of the same chart get different, correct figures.
--   3. Signed-out callers cannot total anything, and a chart cannot be made
--      to total text, a filter-only property, or a forged property name.
begin;

-- Five tasks in the owner's organization, on different people, with
-- estimates (one missing), so counts, sums and averages differ per viewer.
insert into public.task (organization_id, title, created_by, assignee_id, status, priority, estimate_hours)
select m.organization_id, 'D3Chart ' || v.n, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', v.assignee::uuid,
       v.status::public.task_status, v.priority::public.task_priority, v.estimate
from public.organization_membership m
cross join (values
  ('one',   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'ready',       'high',   2.0),
  ('two',   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'completed',   'high',   3.5),
  ('three', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'ready',       'low',    5.0),
  ('four',  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'in_progress', 'medium', 1.5),
  ('five',  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'ready',       'high',   null)
) as v(n, assignee, status, priority, estimate)
where m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';

-- ---------------------------------------------------------------------------
-- 1. Every person, both levels, every chart total: equal to RLS's own rows.
do $$
declare
  v_where jsonb := '{"and":[{"property":"title","operator":"starts_with","value":"D3Chart "}]}';
  v_person uuid;
  v_level text;
  v_fn text;
  v_result jsonb;
  v_group jsonb;
  v_expected numeric;
  v_got numeric;
  v_checked integer := 0;
begin
  for v_person in select distinct user_id from public.organization_membership loop
    foreach v_level in array array['aal1', 'aal2'] loop
      perform tests.authenticate(v_person, v_level);
      foreach v_fn in array array['count', 'sum', 'avg'] loop
        -- A bar, line or pie chart: grouped by priority.
        v_result := public.lens_aggregate(
          jsonb_build_object('version', 1, 'type', 'task', 'where', v_where, 'groupBy', jsonb_build_object('property', 'priority')),
          case when v_fn = 'count' then '[{"fn":"count"}]'::jsonb
               else jsonb_build_array(jsonb_build_object('fn', v_fn, 'property', 'estimate')) end);

        -- Every group a viewer can see is there, and no other.
        perform tests.ok(
          (select coalesce(array_agg(g ->> 'key' order by g ->> 'key'), array[]::text[]) from jsonb_array_elements(v_result -> 'groups') g)
          = (select coalesce(array_agg(distinct t.priority::text order by t.priority::text), array[]::text[])
               from public.task t where t.title like 'D3Chart %' and t.archived_at is null),
          format('%s at %s, %s chart: the groups are the priorities of rows they can open', v_person, v_level, v_fn));

        for v_group in select * from jsonb_array_elements(v_result -> 'groups') loop
          select case v_fn when 'count' then count(*)::numeric when 'sum' then sum(t.estimate_hours) else avg(t.estimate_hours) end
            into v_expected
            from public.task t
           where t.title like 'D3Chart %' and t.archived_at is null and t.priority::text = v_group ->> 'key';
          v_got := (v_group #>> '{totals,m0}')::numeric;
          perform tests.ok(v_got is not distinct from v_expected,
            format('%s at %s, %s chart, group %s: %s equals the rows RLS shows (%s)', v_person, v_level, v_fn, v_group ->> 'key', v_got, v_expected));
          v_checked := v_checked + 1;
        end loop;

        -- A single number: the same total, ungrouped.
        v_result := public.lens_aggregate(
          jsonb_build_object('version', 1, 'type', 'task', 'where', v_where),
          case when v_fn = 'count' then '[{"fn":"count"}]'::jsonb
               else jsonb_build_array(jsonb_build_object('fn', v_fn, 'property', 'estimate')) end);
        select case v_fn when 'count' then count(*)::numeric when 'sum' then sum(t.estimate_hours) else avg(t.estimate_hours) end
          into v_expected
          from public.task t where t.title like 'D3Chart %' and t.archived_at is null;
        perform tests.ok((v_result #>> '{totals,m0}')::numeric is not distinct from v_expected
          and v_result -> 'groups' = 'null'::jsonb,
          format('%s at %s, single-number %s: equals the rows RLS shows', v_person, v_level, v_fn));
      end loop;
      reset role;
    end loop;
  end loop;
  perform tests.ok(v_checked > 0, format('checked %s chart groups', v_checked));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Two viewers of the same chart: different figures, both correct.
do $$
declare
  v_spec jsonb := '{"version":1,"type":"task","where":{"and":[{"property":"title","operator":"starts_with","value":"D3Chart "}]},"groupBy":{"property":"priority"}}';
  v_owner jsonb;
  v_volunteer jsonb;
  v_hidden integer;
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  v_owner := public.lens_aggregate(v_spec, '[{"fn":"count"},{"fn":"sum","property":"estimate"}]');
  reset role;
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'aal2');
  v_volunteer := public.lens_aggregate(v_spec, '[{"fn":"count"},{"fn":"sum","property":"estimate"}]');
  select count(*) into v_hidden from public.task where title like 'D3Chart %';
  reset role;

  perform tests.ok((v_owner #>> '{totals,m0}')::int = 5 and (v_owner #>> '{totals,m1}')::numeric = 12.0,
    format('the owner''s chart counts all five tasks, 12 hours (%s)', v_owner -> 'totals'));
  perform tests.ok((v_volunteer #>> '{totals,m0}')::int = v_hidden and v_hidden < 5,
    format('the volunteer''s chart counts only the %s tasks they can open (%s)', v_hidden, v_volunteer -> 'totals'));
  perform tests.ok((v_volunteer #>> '{totals,m0}')::int < (v_owner #>> '{totals,m0}')::int,
    'the same chart shows the two viewers different counts');
  perform tests.ok(not exists (
      select 1 from jsonb_array_elements(v_volunteer -> 'groups') vg
      join jsonb_array_elements(v_owner -> 'groups') og on og ->> 'key' = vg ->> 'key'
      where (vg #>> '{totals,m0}')::int > (og #>> '{totals,m0}')::int),
    'no group of the volunteer''s chart exceeds the owner''s');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Refused: signed out, and totals a chart must never compute.
do $$
declare
  v_case record;
begin
  perform tests.clear_auth();
  begin
    perform public.lens_aggregate('{"version":1,"type":"task","groupBy":{"property":"priority"}}', '[{"fn":"count"}]');
    raise exception 'FAIL: a signed-out caller drew a chart';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out caller cannot total a chart');
  end;
  reset role;

  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'aal2');
  for v_case in select * from (values
    ('[{"fn":"sum","property":"title"}]', 'invalid_spec', 'a sum of text'),
    ('[{"fn":"avg","property":"review_role"}]', 'invalid_spec', 'an average of a filter-only property'),
    ('[{"fn":"sum","property":"estimate_hours from public.task; --"}]', 'unknown_property', 'a forged property name')
  ) as c(measures, code, label) loop
    begin
      perform public.lens_aggregate('{"version":1,"type":"task","groupBy":{"property":"priority"}}', v_case.measures::jsonb);
      perform tests.ok(false, format('refused: %s (it ran)', v_case.label));
    exception when others then
      perform tests.ok(sqlerrm like 'lens:' || v_case.code || ':%', format('refused: %s (%s)', v_case.label, sqlerrm));
    end;
  end loop;
  reset role;
end;
$$;

rollback;
