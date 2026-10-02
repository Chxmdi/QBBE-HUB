-- Workspace OS wave 2, unit D2: the table's totals and columns. Run after
-- qa-users.sql and rls.sql. Everything is rolled back.
--
-- What must hold:
--   D2-1  The totals the table asks for (its spec without paging) cover every
--         matching row, not only the first page the table loads.
--   D2-2  Totals never include rows the viewer cannot open: two viewers get
--         different totals, each equal to a direct count under their own RLS.
--   D2-4  lens_totals_setting: a viewer reads and writes only their own row;
--         unknown totals and columns are refused.
--   D2-5  lens_column_setting: owners and admins at two-step sign-in write;
--         everyone else (staff, volunteers, an admin at one step, signed-out
--         visitors) is refused; members read; unknown columns and a hidden
--         title are refused.
begin;

-- 1,205 tasks: the owner's, five of them assigned to the volunteer, so the
-- volunteer can open those five (task RLS) and nothing else of the batch.
insert into public.task (organization_id, title, created_by, assignee_id, estimate_hours, status)
select m.organization_id, 'D2 totals fixture ' || g, m.user_id,
       case when g <= 5 then 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'::uuid else m.user_id end,
       case when g % 10 = 0 then null else 1.5 end,
       case when g % 2 = 0 then 'ready'::public.task_status else 'in_progress'::public.task_status end
from public.organization_membership m, generate_series(1, 1205) g
where m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';

-- ---------------------------------------------------------------------------
-- D2-1, D2-2: every matching row, and only the rows the viewer can open.
do $$
declare
  v_spec jsonb := '{"version":1,"type":"task","where":{"and":[{"property":"title","operator":"contains","value":"D2 totals fixture"}]},"groupBy":{"property":"status"}}';
  v_measures jsonb := '[{"fn":"count"},{"fn":"sum","property":"estimate"},{"fn":"count_empty","property":"estimate"},{"fn":"avg","property":"estimate"}]';
  v_result jsonb;
  v_page jsonb;
  v_person uuid;
  v_n bigint;
  v_sum numeric;
  v_empty bigint;
  v_counts bigint[] := array[]::bigint[];
  v_group jsonb;
begin
  -- The owner: 1,205 rows, though the table's first page holds 1,000.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  v_page := public.lens_query(jsonb_set(v_spec - 'groupBy', '{limit}', '1000') || '{"offset":0}');
  perform tests.ok(jsonb_array_length(v_page -> 'rows') = 1000 and (v_page ->> 'total')::int = 1205,
    'D2-1: the table''s first page has 1,000 of the 1,205 matching rows');
  v_result := public.lens_aggregate(v_spec, v_measures);
  perform tests.ok((v_result #>> '{totals,m0}')::int = 1205, 'D2-1: the count covers all 1,205 rows, not the loaded page');
  perform tests.ok((v_result #>> '{totals,m1}')::numeric = 1627.5, 'D2-1: the sum covers every row (1,085 filled x 1.5)');
  perform tests.ok((v_result #>> '{totals,m2}')::int = 120, 'D2-1: empty counts every row without a value');
  perform tests.ok((v_result #>> '{totals,m3}')::numeric = 1.5, 'D2-1: the average is over filled values only');
  -- D2-3 at the database: each group totals its own rows.
  for v_group in select * from jsonb_array_elements(v_result -> 'groups') loop
    select count(*) into v_n from public.task t
    where t.title like 'D2 totals fixture %' and t.status::text = v_group ->> 'key';
    perform tests.ok((v_group #>> '{totals,m0}')::bigint = v_n, format('D2-3: group %s totals its own %s rows', v_group ->> 'key', v_n));
  end loop;
  reset role;

  -- Two viewers, different totals, each equal to a direct count under RLS.
  foreach v_person in array array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2']::uuid[] loop
    perform tests.authenticate(v_person, 'aal2');
    v_result := public.lens_aggregate(v_spec, v_measures);
    select count(*), sum(estimate_hours), count(*) filter (where estimate_hours is null)
      into v_n, v_sum, v_empty
      from public.task where title like 'D2 totals fixture %' and archived_at is null;
    perform tests.ok((v_result #>> '{totals,m0}')::bigint = v_n
      and (v_result #>> '{totals,m1}')::numeric is not distinct from v_sum
      and (v_result #>> '{totals,m2}')::bigint = v_empty,
      format('D2-2: %s''s totals equal what their own RLS lets them open (%s rows)', v_person, v_n));
    v_counts := v_counts || v_n;
    reset role;
  end loop;
  perform tests.ok(v_counts[1] = 1205 and v_counts[2] = 5 and v_counts[3] = 0,
    'D2-2: the owner, the volunteer and staff get different totals (1,205, 5, 0)');
end;
$$;

-- ---------------------------------------------------------------------------
-- D2-4: lens_totals_setting belongs to its viewer.
do $$
declare
  v_n integer;
begin
  perform tests.ok((select relrowsecurity from pg_class where oid = 'public.lens_totals_setting'::regclass),
    'lens_totals_setting has row-level security');
  perform tests.ok(not has_table_privilege('anon', 'public.lens_totals_setting', 'select'),
    'signed-out visitors cannot read totals settings');

  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'aal1');
  insert into public.lens_totals_setting (user_id, type_key, choices)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'task', '{"estimate":"avg","title":"count"}');
  perform tests.ok(true, 'D2-4: a viewer saves their own totals');
  begin
    insert into public.lens_totals_setting (user_id, type_key, choices)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'task', '{}');
    raise exception 'FAIL: staff wrote the volunteer''s totals';
  exception when insufficient_privilege then
    perform tests.ok(true, 'D2-4: nobody writes someone else''s totals');
  end;
  begin
    update public.lens_totals_setting set choices = '{"estimate":"median"}' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
    raise exception 'FAIL: an unknown total was saved';
  exception when check_violation then
    perform tests.ok(true, 'D2-4: an unknown total is refused');
  end;
  begin
    update public.lens_totals_setting set choices = '{"nope":"count"}' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
    raise exception 'FAIL: an unknown column was saved';
  exception when check_violation then
    perform tests.ok(true, 'D2-4: an unknown column is refused');
  end;
  begin
    insert into public.lens_totals_setting (user_id, type_key, choices)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'ghost', '{}');
    raise exception 'FAIL: an unknown type was saved';
  exception when check_violation then
    perform tests.ok(true, 'D2-4: an unknown type is refused');
  end;
  reset role;

  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  select count(*) into v_n from public.lens_totals_setting where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  perform tests.ok(v_n = 0, 'D2-4: even the owner cannot read someone else''s totals');
  update public.lens_totals_setting set choices = '{}' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'D2-4: nor change them');
  delete from public.lens_totals_setting where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'D2-4: nor delete them');
  reset role;

  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'aal1');
  perform tests.ok((select choices ->> 'estimate' from public.lens_totals_setting where type_key = 'task') = 'avg',
    'D2-4: the viewer reads their saved choice back');
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- D2-5: lens_column_setting, admins only.
do $$
declare
  v_org uuid := (select organization_id from public.organization_membership where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' limit 1);
  v_person uuid;
  v_n integer;
begin
  perform tests.ok((select relrowsecurity from pg_class where oid = 'public.lens_column_setting'::regclass),
    'lens_column_setting has row-level security');
  perform tests.ok(not has_table_privilege('anon', 'public.lens_column_setting', 'insert')
    and not has_table_privilege('anon', 'public.lens_column_setting', 'select'),
    'D2-5: signed-out visitors can neither read nor write column settings');

  -- Staff and volunteers at both levels, and an admin at one step, are refused.
  foreach v_person in array array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3']::uuid[] loop
    perform tests.authenticate(v_person, 'aal2');
    begin
      insert into public.lens_column_setting (organization_id, type_key, property_key, name_en, name_fr)
      values (v_org, 'task', 'status', 'Forged', 'Forgé');
      raise exception 'FAIL: % renamed a column', v_person;
    exception when insufficient_privilege then
      perform tests.ok(true, format('D2-5: %s cannot rename a column', v_person));
    end;
    reset role;
  end loop;
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'aal1');
  begin
    insert into public.lens_column_setting (organization_id, type_key, property_key, hidden)
    values (v_org, 'task', 'estimate', true);
    raise exception 'FAIL: an admin at one step hid a column';
  exception when insufficient_privilege then
    perform tests.ok(true, 'D2-5: an admin without the two-step sign-in is refused');
  end;
  reset role;

  -- The admin at two steps renames, hides and adds back.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'aal2');
  insert into public.lens_column_setting (organization_id, type_key, property_key, name_en, name_fr)
  values (v_org, 'task', 'status', 'Stage', 'Étape');
  insert into public.lens_column_setting (organization_id, type_key, property_key, hidden)
  values (v_org, 'task', 'estimate', true);
  update public.lens_column_setting set hidden = false where organization_id = v_org and type_key = 'task' and property_key = 'estimate';
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 1, 'D2-5: an admin renames, hides and adds back a column');
  perform tests.ok((select updated_by from public.lens_column_setting where property_key = 'status' and organization_id = v_org)
    = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'D2-5: the change records who made it');
  begin
    insert into public.lens_column_setting (organization_id, type_key, property_key, hidden)
    values (v_org, 'task', 'title', true);
    raise exception 'FAIL: the title was hidden';
  exception when check_violation then
    perform tests.ok(true, 'D2-5: the title column cannot be hidden');
  end;
  begin
    insert into public.lens_column_setting (organization_id, type_key, property_key, name_en)
    values (v_org, 'task', 'review_role', 'Role');
    raise exception 'FAIL: a filter-only property became a column';
  exception when check_violation then
    perform tests.ok(true, 'D2-5: only real columns can be set');
  end;
  begin
    insert into public.lens_column_setting (organization_id, type_key, property_key, name_en)
    values (v_org, 'task', 'secret_column', 'x');
    raise exception 'FAIL: an unknown column was set';
  exception when check_violation then
    perform tests.ok(true, 'D2-5: an unknown column is refused');
  end;
  reset role;

  -- Members read; staff cannot change or remove what the admin set.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'aal1');
  perform tests.ok((select name_en from public.lens_column_setting where organization_id = v_org and property_key = 'status') = 'Stage',
    'D2-5: members read the organization''s column names');
  update public.lens_column_setting set name_en = 'Forged' where organization_id = v_org;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'D2-5: staff cannot rename through an update');
  delete from public.lens_column_setting where organization_id = v_org;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'D2-5: staff cannot remove column settings');
  reset role;

  -- The owner can also change it, at two steps.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  update public.lens_column_setting set name_fr = 'Phase' where organization_id = v_org and property_key = 'status';
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 1, 'D2-5: the owner renames a column');
  reset role;
end;
$$;

rollback;
