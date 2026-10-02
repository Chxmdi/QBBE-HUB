-- Workspace OS wave 2, step 0: totals over a lens (count, empty, filled, sum,
-- average, minimum, maximum), overall and per group.
--
-- Shared by the table's totals row (D2) and chart layouts (D3), so neither
-- computes totals on the client from a partial page of rows.
--
-- Same rules as lens_query (20261104010100):
--   * the spec is compiled by the same helpers (lens__type, lens__group,
--     lens__property, lens__visible_id, lens__display), so a total always
--     matches the rows the same spec lists;
--   * nothing here is security definer: the query runs as the caller, so
--     row-level security decides which rows are counted. A total never
--     includes a row the caller cannot open;
--   * every value from the spec reaches the SQL as a parameter or through
--     format('%I') / format('%L'), never by concatenation.

create or replace function public.lens_aggregate(spec jsonb, measures jsonb, time_zone text default 'America/Toronto')
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_type jsonb;
  v_today date;
  v_where record;
  v_where_sql text := 'true';
  v_params jsonb;
  v_from text;
  v_group jsonb;
  v_group_expr text;
  v_group_label text;
  v_group_order text;
  v_measure jsonb;
  v_prop jsonb;
  v_fn text;
  v_kind text;
  v_col text;
  v_expr text;
  v_exprs text[] := array[]::text[];
  v_out jsonb := '[]'::jsonb;
  v_i integer := 0;
  v_totals jsonb;
  v_groups jsonb;
begin
  -- The full lens spec is accepted, so a caller can pass the spec it already
  -- lists rows with; sort, select, limit and offset do not change a total.
  perform public.lens__only_keys(spec, array['version', 'type', 'where', 'sort', 'groupBy', 'select', 'limit', 'offset']);
  if spec -> 'version' is distinct from '1'::jsonb then
    perform public.lens__fail('invalid_spec', 'Unknown query version.');
  end if;
  if time_zone is null or length(time_zone) > 64 then
    perform public.lens__fail('invalid_spec', 'Unknown time zone.');
  end if;
  begin
    v_today := (now() at time zone time_zone)::date;
  exception when others then
    perform public.lens__fail('invalid_spec', 'Unknown time zone.');
  end;
  v_type := public.lens__type(spec -> 'type');

  if jsonb_typeof(measures) is distinct from 'array'
     or jsonb_array_length(measures) not between 1 and 20 then
    perform public.lens__fail('invalid_spec', 'Ask for between one and twenty totals.');
  end if;

  -- Filters, exactly as lens_compile builds them. The time zone is parameter 0.
  v_params := jsonb_build_array(time_zone);
  if spec ? 'where' then
    select * into v_where from public.lens__group(v_type, spec -> 'where', 'o', 1, true, v_today, v_params, 0, 0);
    v_params := v_where.params;
    v_where_sql := v_where.sql;
  end if;
  v_from := format('from public.%I o where %s and %s', v_type ->> 'table',
    case when v_type ? 'archived' then format('o.%I is null', v_type ->> 'archived') else 'true' end,
    v_where_sql);

  -- Measures.
  for v_measure in select * from jsonb_array_elements(measures) loop
    if jsonb_typeof(v_measure) is distinct from 'object' then
      perform public.lens__fail('invalid_spec', 'Each total is an object.');
    end if;
    perform public.lens__only_keys(v_measure, array['fn', 'property']);
    v_fn := v_measure ->> 'fn';
    if jsonb_typeof(v_measure -> 'fn') is distinct from 'string'
       or v_fn not in ('count', 'count_empty', 'count_filled', 'sum', 'avg', 'min', 'max') then
      perform public.lens__fail('invalid_spec', 'Unknown total.');
    end if;

    if v_fn = 'count' then
      if v_measure ? 'property' then
        perform public.lens__fail('invalid_spec', 'A row count takes no property.');
      end if;
      v_expr := 'count(*)';
      v_prop := null;
    else
      if not v_measure ? 'property' then
        perform public.lens__fail('invalid_spec', format('"%s" needs a property.', v_fn));
      end if;
      v_prop := public.lens__property(v_type, v_measure -> 'property');
      if coalesce((v_prop ->> 'filterOnly')::boolean, false) then
        perform public.lens__fail('invalid_spec', format('"%s" can be filtered on but not totalled.', v_prop ->> 'key'));
      end if;
      v_kind := v_prop ->> 'kind';
      -- References count as empty when the caller cannot see what they point
      -- to, the same way the table shows them.
      v_col := public.lens__visible_id('o', v_prop);
      if v_fn = 'count_empty' then
        v_expr := format('count(*) filter (where %s is null)', v_col);
      elsif v_fn = 'count_filled' then
        v_expr := format('count(%s)', v_col);
      elsif v_fn in ('sum', 'avg') then
        if v_kind is distinct from 'number' then
          perform public.lens__fail('invalid_spec', format('"%s" is not a number.', v_prop ->> 'key'));
        end if;
        v_expr := format('%s(%s)', v_fn, v_col);
      else
        if v_kind not in ('number', 'date') then
          perform public.lens__fail('invalid_spec', format('"%s" has no smallest or largest value.', v_prop ->> 'key'));
        end if;
        v_expr := format('%s(%s)', v_fn, v_col);
      end if;
    end if;

    v_exprs := v_exprs || format('%L, to_jsonb(%s)', 'm' || v_i, v_expr);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', 'm' || v_i,
      'fn', v_fn,
      'property', case when v_prop is null then null else v_prop -> 'key' end));
    v_i := v_i + 1;
  end loop;

  execute format('select jsonb_build_object(%s) %s', array_to_string(v_exprs, ', '), v_from)
    into v_totals using v_params;

  -- Per group, with the same keys and labels lens_query gives its groups.
  if spec ? 'groupBy' then
    perform public.lens__only_keys(spec -> 'groupBy', array['property']);
    v_group := public.lens__property(v_type, spec #> '{groupBy,property}');
    if not coalesce((v_group ->> 'groupable')::boolean, false) then
      perform public.lens__fail('not_groupable', format('Cannot group by "%s".', v_group ->> 'key'));
    end if;
    v_group_expr := public.lens__visible_id('o', v_group);
    if v_group ->> 'kind' = 'relation' or v_group ? 'ref' then
      v_group_label := public.lens__display(v_group, 'g.k0');
      v_group_order := format('(%s ->> %L)', v_group_label, 'label');
    else
      v_group_label := 'null::jsonb';
      v_group_order := 'g.k0';
    end if;
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(%L, g.k0::text, %L, %s, %L, g.v) order by %s asc nulls last), %L::jsonb) '
      || 'from (select %s as k0, jsonb_build_object(%s) as v %s group by 1) g',
      'key', 'label', v_group_label, 'totals', v_group_order, '[]',
      v_group_expr, array_to_string(v_exprs, ', '), v_from)
      into v_groups using v_params;
  end if;

  return jsonb_build_object(
    'type', v_type -> 'key',
    'measures', v_out,
    'totals', v_totals,
    'groupBy', case when v_group is null then null else v_group -> 'key' end,
    'groups', v_groups
  );
end;
$$;

revoke all on function public.lens_aggregate(jsonb, jsonb, text) from public, anon;
grant execute on function public.lens_aggregate(jsonb, jsonb, text) to authenticated, service_role;

comment on function public.lens_aggregate(jsonb, jsonb, text) is
  'Totals over a lens spec (count, count_empty, count_filled, sum, avg, min, max), overall and per group. Runs as the caller, so only rows the caller can read are counted.';
