-- Workspace OS integration I1 follow-up: an undo must reverse the change set
-- it names (20261107040300_change_set_undo_guard.sql). A member cannot mark
-- another person's change set undone by recording a change set of made-up
-- records with undo_of; an undo names the original's records, which puts them
-- under the capability check; a change set of records the registry cannot
-- check is its actor's alone to undo. Run after qa-users.sql and rls.sql.
-- Rolled back.
begin;

create or replace function tests.undo_guard_raises(p_sql text)
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
grant execute on function tests.undo_guard_raises(text) to anon, authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_project uuid;
  v_task uuid;
  v_milestone uuid;
  v_set public.change_set;
  v_undo public.change_set;
  v_shift public.change_set;
  v_changes jsonb;
  v_inverse jsonb;
  v_forged jsonb;
  v_milestone_changes jsonb;
  v_milestone_inverse jsonb;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Undo guard', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'The owner''s task', v_owner) returning id into v_task;
  insert into public.milestone (project_id, name, due_date)
  values (v_project, 'Print', date '2026-10-10') returning id into v_milestone;

  v_changes := jsonb_build_array(jsonb_build_object(
    'kind', 'update', 'object', jsonb_build_object('id', v_task, 'type', 'task'),
    'property', 'status', 'before', 'not_started', 'after', 'in_progress'));
  v_inverse := jsonb_build_array(jsonb_build_object(
    'kind', 'update', 'object', jsonb_build_object('id', v_task, 'type', 'task'),
    'property', 'status', 'before', 'in_progress', 'after', 'not_started'));
  -- A made-up record of a type the registry does not know: accepted as named,
  -- anchored by p_organization, checked by nobody.
  v_forged := jsonb_build_array(jsonb_build_object(
    'kind', 'update', 'object', jsonb_build_object('id', gen_random_uuid(), 'type', 'zzz'),
    'property', 'p', 'before', 1, 'after', 2));
  v_milestone_changes := jsonb_build_array(jsonb_build_object(
    'kind', 'update', 'object', jsonb_build_object('id', v_milestone, 'type', 'milestone'),
    'property', 'due', 'before', '2026-10-10', 'after', '2026-10-13'));
  v_milestone_inverse := jsonb_build_array(jsonb_build_object(
    'kind', 'update', 'object', jsonb_build_object('id', v_milestone, 'type', 'milestone'),
    'property', 'due', 'before', '2026-10-13', 'after', '2026-10-10'));

  -- The owner records a change on their task.
  perform tests.authenticate(v_owner);
  update public.task set status = 'in_progress' where id = v_task;
  v_set := public.record_change_set('object.set_property', v_changes);
  reset role;

  -- The volunteer, who cannot edit that task, cannot mark it undone.
  perform tests.authenticate(v_volunteer);
  perform tests.ok(not public.can(v_task, 'edit_content'), 'the volunteer cannot edit the owner''s task');
  perform tests.ok(
    tests.undo_guard_raises(format(
      'select public.record_change_set(''x.y'', %L::jsonb, null, %L, %L)', v_forged, v_set.id, v_org)),
    'a change set of made-up records cannot claim to undo someone else''s change set'
  );
  perform tests.ok(
    tests.undo_guard_raises(format(
      'select public.record_change_set(''object.set_property'', %L::jsonb, null, %L)', v_inverse, v_set.id)),
    'an undo that names the original''s task still needs the capability on it'
  );
  reset role;
  perform tests.ok(
    (select undone_at is null from public.change_set where id = v_set.id),
    'the owner''s change set is not marked undone by either attempt'
  );

  -- The owner's own undo, naming the task, is recorded as before.
  perform tests.authenticate(v_owner);
  perform tests.ok(
    tests.undo_guard_raises(format(
      'select public.record_change_set(''object.set_property'', %L::jsonb, null, %L, %L)', v_forged, v_set.id, v_org)),
    'even the actor''s undo must name the records it reverses'
  );
  update public.task set status = 'not_started' where id = v_task;
  v_undo := public.record_change_set('object.set_property', v_inverse, null, v_set.id);
  perform tests.ok(
    v_undo.undo_of = v_set.id and (select undone_at is not null from public.change_set where id = v_set.id),
    'the owner''s undo names the task and marks the original undone'
  );
  reset role;

  -- A change set of records the registry cannot check is its actor's alone to undo.
  perform tests.authenticate(v_volunteer);
  v_shift := public.record_change_set('insight.shift_milestone', v_milestone_changes, null, null, v_org);
  reset role;
  perform tests.authenticate(v_owner);
  perform tests.ok(
    tests.undo_guard_raises(format(
      'select public.record_change_set(''insight.shift_milestone'', %L::jsonb, null, %L, %L)',
      v_milestone_inverse, v_shift.id, v_org)),
    'another member cannot undo a milestone shift the registry cannot check'
  );
  reset role;
  perform tests.ok(
    (select undone_at is null from public.change_set where id = v_shift.id),
    'the milestone shift stays live after the refused undo'
  );
  perform tests.authenticate(v_volunteer);
  v_undo := public.record_change_set('insight.shift_milestone', v_milestone_inverse, null, v_shift.id, v_org);
  perform tests.ok(
    v_undo.undo_of = v_shift.id and (select undone_at is not null from public.change_set where id = v_shift.id),
    'its actor undoes the milestone shift'
  );
  reset role;
end;
$$;

rollback;
