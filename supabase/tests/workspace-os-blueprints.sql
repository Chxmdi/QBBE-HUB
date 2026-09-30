-- Workspace OS blueprints (V2-2): who can read, draft, approve, build and undo.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
--
-- Roles: owner and admin (with two-step sign-in) do everything; the owner
-- without it only reads; staff read; volunteer, member (Guest), the external
-- accountant (a Guest with a ledger grant) and signed-out visitors see nothing.
begin;

create or replace function tests.bp_raises(p_sql text, p_msg text)
returns void
language plpgsql
as $$
declare
  v_raised boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    v_raised := true;
  end;
  perform tests.ok(v_raised, p_msg);
end;
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_bp uuid;
  v_other uuid;
  v_cs uuid;
  v_undo uuid;
  v_changes jsonb := jsonb_build_array(
    jsonb_build_object('kind', 'create', 'object', jsonb_build_object('id', gen_random_uuid(), 'type', 'object_type'),
      'values', jsonb_build_object('key', 'candidate', 'blueprint_key', 'recruiting'))
  );
  v_readers uuid[];
  v_outsider uuid;
  n integer;
  v_status text;
begin
  select organization_id into v_org from public.organization_membership where user_id = v_owner;

  -- Owner with two-step sign-in drafts.
  perform tests.authenticate(v_owner);
  insert into public.blueprint (organization_id, key, name_en, name_fr, definition)
  values (v_org, 'recruiting', 'Recruiting', 'Recrutement', '{"version":1}')
  returning id into v_bp;
  perform tests.ok(v_bp is not null, 'owner can draft a blueprint');
  reset role;

  perform tests.authenticate(v_admin);
  insert into public.blueprint (organization_id, key, name_en, name_fr, definition)
  values (v_org, 'events', 'Events', 'Événements', '{"version":1}')
  returning id into v_other;
  perform tests.ok(v_other is not null, 'admin can draft a blueprint');
  update public.blueprint set name_en = 'Event planning' where id = v_other;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'admin can edit a draft');
  begin
    update public.blueprint set status = 'built' where id = v_other;
    perform tests.ok(false, 'admin cannot set status directly');
  exception when insufficient_privilege then
    perform tests.ok(true, 'admin cannot set status directly');
  end;
  reset role;

  -- Readers: staff see drafts and builds; nobody else does.
  perform tests.authenticate(v_staff);
  select count(*) into n from public.blueprint where organization_id = v_org;
  perform tests.ok(n = 2, 'staff can read blueprints');
  perform tests.bp_raises(format('insert into public.blueprint (organization_id, key, name_en, name_fr, definition) values (%L, ''x'', ''X'', ''X'', ''{}'')', v_org),
    'staff cannot draft a blueprint');
  update public.blueprint set name_en = 'Changed' where id = v_bp;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'staff cannot edit a blueprint');
  delete from public.blueprint where id = v_bp;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'staff cannot delete a blueprint');
  perform tests.bp_raises(format('select public.blueprint_approve(%L)', v_bp), 'staff cannot approve');
  reset role;

  foreach v_outsider in array array[v_volunteer, v_guest] loop
    perform tests.authenticate(v_outsider);
    select count(*) into n from public.blueprint;
    perform tests.ok(n = 0, format('%s cannot read blueprints', case when v_outsider = v_volunteer then 'volunteer' else 'member (guest)' end));
    perform tests.bp_raises(format('insert into public.blueprint (organization_id, key, name_en, name_fr, definition) values (%L, ''x'', ''X'', ''X'', ''{}'')', v_org),
      'volunteer and member cannot draft');
    perform tests.bp_raises(format('select public.blueprint_approve(%L)', v_bp), 'volunteer and member cannot approve');
    reset role;
  end loop;

  -- The owner without two-step sign-in reads nothing and changes nothing
  -- (is_org_staff and is_org_admin both need AAL2 for owners).
  perform tests.authenticate(v_owner, 'aal1');
  update public.blueprint set name_en = 'Changed' where id = v_bp;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'owner without two-step sign-in cannot edit');
  perform tests.bp_raises(format('select public.blueprint_approve(%L)', v_bp), 'owner without two-step sign-in cannot approve');
  reset role;

  -- Building needs approval first.
  perform tests.authenticate(v_owner);
  perform tests.bp_raises(format('select public.blueprint_build(%L, %L::jsonb, ''{}''::jsonb)', v_bp, v_changes),
    'a draft cannot be built');
  perform public.blueprint_approve(v_bp);
  select status into v_status from public.blueprint where id = v_bp;
  perform tests.ok(v_status = 'approved', 'owner can approve a draft');

  -- Editing an approved blueprint sends it back to draft.
  update public.blueprint set definition = '{"version":1,"edited":true}' where id = v_bp;
  select status into v_status from public.blueprint where id = v_bp;
  perform tests.ok(v_status = 'draft', 'editing an approved blueprint returns it to draft');
  perform public.blueprint_approve(v_bp);

  perform tests.bp_raises(format('select public.blueprint_build(%L, %L::jsonb, ''{}''::jsonb)', v_bp,
      jsonb_build_array(jsonb_build_object('kind', 'delete', 'object', jsonb_build_object('id', gen_random_uuid(), 'type', 'object_type'), 'values', '{}'::jsonb))),
    'a build cannot delete anything');
  perform tests.bp_raises(format('select public.blueprint_build(%L, %L::jsonb, ''{}''::jsonb)', v_bp,
      jsonb_build_array(jsonb_build_object('kind', 'create', 'object', jsonb_build_object('id', gen_random_uuid(), 'type', 'object_type'), 'values', jsonb_build_object('key', 'x', 'blueprint_key', 'someone_else')))),
    'a build can only create structure tagged with its own blueprint');
  reset role;

  -- Staff cannot build an approved blueprint.
  perform tests.authenticate(v_staff);
  perform tests.bp_raises(format('select public.blueprint_build(%L, %L::jsonb, ''{}''::jsonb)', v_bp, v_changes),
    'staff cannot build');
  reset role;

  perform tests.authenticate(v_owner);
  v_cs := public.blueprint_build(v_bp, v_changes, '{"object_type":1}');
  perform tests.ok(v_cs is not null, 'owner can build an approved blueprint as one change set');
  select status into v_status from public.blueprint where id = v_bp;
  perform tests.ok(v_status = 'built', 'the blueprint is marked built');
  perform tests.bp_raises(format('update public.blueprint set definition = ''{}'' where id = %L', v_bp),
    'a built blueprint cannot be edited');
  perform tests.bp_raises(format('delete from public.blueprint where id = %L', v_bp),
    'a built blueprint cannot be deleted');
  reset role;

  -- A second blueprint cannot create the same type key while the first build lives.
  perform tests.authenticate(v_admin);
  update public.blueprint set key = 'recruiting_copy' where id = v_other;
  perform public.blueprint_approve(v_other);
  perform tests.bp_raises(format('select public.blueprint_build(%L, %L::jsonb, ''{}''::jsonb)', v_other,
      replace(v_changes::text, '"recruiting"', '"recruiting_copy"')),
    'two live builds cannot create the same type key');
  reset role;

  -- Staff can read the build; the others cannot.
  perform tests.authenticate(v_staff);
  select count(*) into n from public.blueprint_build where change_set_id = v_cs;
  perform tests.ok(n = 1, 'staff can read builds');
  perform tests.bp_raises(format('select public.blueprint_undo_build(%L)', v_cs), 'staff cannot undo a build');
  perform tests.bp_raises(format('insert into public.blueprint_build (organization_id, blueprint_id, changes) values (%L, %L, ''[]'')', v_org, v_bp),
    'nobody writes builds directly');
  reset role;

  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.blueprint_build;
  perform tests.ok(n = 0, 'volunteer cannot read builds');
  perform tests.bp_raises(format('select public.blueprint_undo_build(%L)', v_cs), 'volunteer cannot undo a build');
  reset role;

  -- The external accountant: a Guest with a live ledger grant.
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);
  perform tests.authenticate(v_guest);
  select count(*) into n from public.blueprint;
  perform tests.ok(n = 0, 'accountant cannot read blueprints');
  select count(*) into n from public.blueprint_build;
  perform tests.ok(n = 0, 'accountant cannot read builds');
  perform tests.bp_raises(format('select public.blueprint_undo_build(%L)', v_cs), 'accountant cannot undo a build');
  reset role;

  perform tests.clear_auth();
  perform tests.bp_raises('select count(*) from public.blueprint', 'signed-out visitor cannot read blueprints');
  perform tests.bp_raises(format('select public.blueprint_build(%L, ''[]''::jsonb, ''{}''::jsonb)', v_bp), 'signed-out visitor cannot build');
  perform tests.bp_raises(format('select public.blueprint_undo_build(%L)', v_cs), 'signed-out visitor cannot undo');
  reset role;

  -- Admin undoes; the blueprint returns to draft and can be edited again.
  perform tests.authenticate(v_admin);
  v_undo := public.blueprint_undo_build(v_cs);
  perform tests.ok(v_undo is not null and v_undo <> v_cs, 'admin can undo a build, producing its own change set');
  select status into v_status from public.blueprint where id = v_bp;
  perform tests.ok(v_status = 'draft', 'undoing returns the blueprint to draft');
  perform tests.bp_raises(format('select public.blueprint_undo_build(%L)', v_cs), 'a build cannot be undone twice');
  update public.blueprint set name_en = 'Recruiting v2' where id = v_bp;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'an undone blueprint can be edited again');
  -- With the first build undone, its type key is free again.
  perform tests.ok(public.blueprint_build(v_other, replace(v_changes::text, '"recruiting"', '"recruiting_copy"')::jsonb, '{}') is not null,
    'a type key is free again once the build that made it is undone');
  reset role;

  -- Undo is offered for 30 days.
  update public.blueprint_build set built_at = now() - interval '31 days' where blueprint_id = v_other;
  perform tests.authenticate(v_admin);
  perform tests.bp_raises(format('select public.blueprint_undo_build(change_set_id) from public.blueprint_build where blueprint_id = %L', v_other),
    'a build older than 30 days cannot be undone');
  delete from public.blueprint where id = v_bp;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'admin can delete a blueprint that is not built');
  reset role;
end;
$$;

rollback;
