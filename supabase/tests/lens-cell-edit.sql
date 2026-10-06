-- Wave 2 unit D1: editing table cells. Run after qa-users.sql and rls.sql.
-- Everything is rolled back.
--
-- The table saves a cell the way object.set_property does: an update of the
-- record's column under the editor's own RLS, then record_change_set. What
-- must hold for the cells it shows:
--   1. Someone who can see a record but not edit it is offered no editor
--      (lens_editable leaves it out), and a forged edit changes nothing: the
--      update reaches no row, and no change set can be recorded for it.
--   2. An editor's cell change is recorded as one change set with one item
--      (the property, before and after), labelled with the editor.
--   3. Nobody who cannot see the record reads that change set.
--   4. Only someone who may edit the record can undo it, and only once.
begin;

create or replace function tests.d1_raises(p_sql text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end;
$$;
grant execute on function tests.d1_raises(text) to authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_readonly uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_project uuid;
  v_task uuid;
  v_rows integer;
  v_set public.change_set;
  v_undo public.change_set;
  v_change jsonb;
  v_level text;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'volunteer', status = 'active'
  where organization_id = v_org and user_id = v_readonly;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'D1 cell edits', v_owner, v_owner) returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_readonly, 'read_only', 'direct', v_owner);
  insert into public.task (organization_id, project_id, title, created_by, estimate_hours)
  values (v_org, v_project, 'D1 cell', v_owner, 1) returning id into v_task;

  v_change := jsonb_build_array(jsonb_build_object(
    'kind', 'update', 'object', jsonb_build_object('id', v_task, 'type', 'task'),
    'property', 'estimate', 'before', 1, 'after', 2));

  -- 1. A read-only viewer, at both sign-in levels.
  foreach v_level in array array['aal1', 'aal2'] loop
    perform tests.authenticate(v_readonly, v_level);
    perform tests.ok((select count(*) from public.task where id = v_task) = 1,
      format('%s: the read-only viewer sees the record', v_level));
    perform tests.ok((select count(*) from public.lens_editable(array[v_task])) = 0,
      format('%s: the table offers the read-only viewer no editor for it', v_level));
    update public.task set estimate_hours = 99 where id = v_task;
    get diagnostics v_rows = row_count;
    perform tests.ok(v_rows = 0, format('%s: a forged cell edit reaches no row', v_level));
    perform tests.ok(
      tests.d1_raises(format('select public.record_change_set(''object.set_property'', %L::jsonb)', v_change)),
      format('%s: no change set can be recorded for a record the viewer cannot edit', v_level));
    reset role;
  end loop;
  perform tests.ok((select estimate_hours from public.task where id = v_task) = 1,
    'after the forged edits the value is unchanged');

  -- 2. The owner edits the cell, as the action does.
  perform tests.authenticate(v_owner);
  perform tests.ok((select count(*) from public.lens_editable(array[v_task])) = 1, 'the owner is offered an editor');
  update public.task set estimate_hours = 2 where id = v_task;
  get diagnostics v_rows = row_count;
  v_set := public.record_change_set('object.set_property', v_change);
  reset role;
  perform tests.ok(v_rows = 1 and (select estimate_hours from public.task where id = v_task) = 2, 'the owner''s cell edit is saved');
  perform tests.ok(
    v_set.action_key = 'object.set_property' and v_set.actor_id = v_owner::text
      and (select count(*) from public.change_set_item where change_set_id = v_set.id) = 1
      and exists (select 1 from public.change_set_item where change_set_id = v_set.id
        and object_id = v_task and property = 'estimate' and before = '1'::jsonb and after = '2'::jsonb),
    'the cell change is one change set with its property, before and after, labelled with the editor');

  -- 3. Reading it.
  perform tests.authenticate(v_owner);
  perform tests.ok((select count(*) from public.change_set where id = v_set.id) = 1, 'the editor reads their change set');
  reset role;
  perform tests.authenticate(v_guest);
  perform tests.ok(
    (select count(*) from public.change_set where id = v_set.id) = 0
      and (select count(*) from public.change_set_item where change_set_id = v_set.id) = 0,
    'someone who cannot see the record does not read its change set');
  reset role;

  -- 4. Undo.
  perform tests.authenticate(v_readonly);
  perform tests.ok(
    tests.d1_raises(format('select public.record_change_set(''object.set_property'', %L::jsonb, null, %L)',
      jsonb_build_array(jsonb_build_object('kind', 'update', 'object', jsonb_build_object('id', v_task, 'type', 'task'),
        'property', 'estimate', 'before', 2, 'after', 1)), v_set.id)),
    'the read-only viewer cannot undo the editor''s change');
  reset role;
  perform tests.authenticate(v_owner);
  update public.task set estimate_hours = 1 where id = v_task;
  v_undo := public.record_change_set('object.set_property',
    jsonb_build_array(jsonb_build_object('kind', 'update', 'object', jsonb_build_object('id', v_task, 'type', 'task'),
      'property', 'estimate', 'before', 2, 'after', 1)), null, v_set.id);
  perform tests.ok(v_undo.undo_of = v_set.id, 'the editor undoes the cell change, recorded with undo_of');
  perform tests.ok(
    tests.d1_raises(format('select public.record_change_set(''object.set_property'', %L::jsonb, null, %L)', v_change, v_set.id)),
    'a cell change cannot be undone twice');
  reset role;
end;
$$;

rollback;
