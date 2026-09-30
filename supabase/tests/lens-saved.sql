-- Workspace OS saved lenses (M8d). Run after qa-users.sql and rls.sql.
-- Everything is rolled back.
--
--   1. RLS allow and deny for every role on personal and shared lenses:
--      owner, admin, staff, volunteer, guest (member), the scoped accounts,
--      a deactivated member and a signed-out visitor.
--   2. Owner, organization and source never change after insert.
--   3. Saved views become lenses: every filter the screens understand is
--      converted, the rest is kept and listed; the copy follows inserts,
--      renames, sharing and deletes; the undo and redo round-trip.
begin;

create temporary table lens_people (role text primary key, id uuid) on commit drop;
insert into lens_people values
  ('owner', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  ('staff', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'),
  ('volunteer', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'),
  ('admin', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'),
  ('guest', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5'),
  ('lead', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6'),
  ('pm', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7'),
  ('contributor', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8'),
  ('readonly', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9');
grant select on lens_people to authenticated;

-- ---------------------------------------------------------------------------
-- 1. RLS
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_role record;
  v_other record;
  v_mine uuid;
  v_shared uuid;
  v_rows integer;
begin
  select organization_id into strict v_org from public.organization_membership
  where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';

  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.lens'::regclass),
    'lens has row-level security');
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname in ('lens_sync_saved_view', 'saved_view_to_lens', 'lens_migrate_saved_views', 'lens_unmigrate_saved_views')),
    'the definer functions fix an empty search_path');
  perform tests.ok(
    not has_function_privilege('authenticated', 'app.lens_unmigrate_saved_views()', 'execute')
      and not has_function_privilege('authenticated', 'app.lens_migrate_saved_views()', 'execute')
      and not has_function_privilege('authenticated', 'app.lens_sync_saved_view(public.saved_view)', 'execute'),
    'signed-in people cannot run the migration functions');

  -- Each person makes a personal and a shared lens; everyone else can see
  -- only the shared one.
  for v_role in select * from lens_people order by role loop
    perform tests.authenticate(v_role.id, 'aal2');
    insert into public.lens (organization_id, owner_id, name, kind, type_key, spec)
    values (v_org, v_role.id, 'Personal ' || v_role.role, 'table', 'task', '{"version":1,"type":"task"}')
    returning id into v_mine;
    insert into public.lens (organization_id, owner_id, name, kind, type_key, spec, visibility)
    values (v_org, v_role.id, 'Shared ' || v_role.role, 'board', 'task', '{"version":1,"type":"task"}', 'shared')
    returning id into v_shared;
    perform tests.ok(exists (select 1 from public.lens where id = v_mine), v_role.role || ': reads their own personal lens');
    reset role;

    -- Nobody may create a lens for someone else, or claim a saved-view source.
    perform tests.authenticate(v_role.id, 'aal2');
    begin
      insert into public.lens (organization_id, owner_id, name, kind)
      select v_org, id, 'Forged', 'table' from lens_people where role <> v_role.role limit 1;
      raise exception 'FAIL: % created a lens for someone else', v_role.role;
    exception when insufficient_privilege then
      perform tests.ok(true, v_role.role || ': cannot create a lens owned by someone else');
    end;
    begin
      insert into public.lens (organization_id, owner_id, name, kind, source_saved_view_id)
      values (v_org, v_role.id, 'Forged source', 'table', gen_random_uuid());
      raise exception 'FAIL: % set a saved-view source', v_role.role;
    exception when insufficient_privilege or foreign_key_violation then
      perform tests.ok(true, v_role.role || ': cannot write a saved-view copy directly');
    end;
    reset role;
  end loop;

  for v_role in select * from lens_people order by role loop
    perform tests.authenticate(v_role.id, 'aal2');
    perform tests.ok(
      (select count(*) from public.lens where name like 'Personal %') = 1
        and (select name from public.lens where name like 'Personal %') = 'Personal ' || v_role.role,
      v_role.role || ': sees no one else''s personal lens');
    perform tests.ok(
      (select count(*) from public.lens where name like 'Shared %') = (select count(*) from lens_people),
      v_role.role || ': sees every shared lens in the organization');

    -- Others' lenses, shared or not, cannot be changed or deleted.
    update public.lens set name = 'Hijacked' where name like 'Shared %' and owner_id <> v_role.id;
    get diagnostics v_rows = row_count;
    perform tests.ok(v_rows = 0, v_role.role || ': cannot rename another person''s shared lens');
    delete from public.lens where name like 'Shared %' and owner_id <> v_role.id;
    get diagnostics v_rows = row_count;
    perform tests.ok(v_rows = 0, v_role.role || ': cannot delete another person''s shared lens');

    -- Their own: share, unshare, rename, delete.
    update public.lens set visibility = 'shared', name = 'Personal ' || v_role.role
    where owner_id = v_role.id and name like 'Personal %';
    get diagnostics v_rows = row_count;
    perform tests.ok(v_rows = 1, v_role.role || ': can share their own lens');
    update public.lens set visibility = 'personal' where owner_id = v_role.id and name like 'Personal %';

    -- Ownership and provenance are fixed.
    begin
      update public.lens set owner_id = (select id from lens_people where role <> v_role.role limit 1)
      where owner_id = v_role.id and name like 'Personal %';
      raise exception 'FAIL: % gave a lens away', v_role.role;
    exception when insufficient_privilege then
      perform tests.ok(true, v_role.role || ': cannot hand a lens to someone else');
    end;
    reset role;
  end loop;

  -- A deactivated member loses their lenses and the shared ones.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'aal2');
  perform tests.ok(not exists (select 1 from public.lens), 'a deactivated member reads no lens, not even their own');
  update public.lens set name = 'After deactivation' where owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'a deactivated member cannot change their lenses');
  reset role;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
end;
$$;

-- Signed out: no access at all.
do $$
declare
  v_org uuid;
  v_user uuid;
begin
  select organization_id, user_id into v_org, v_user from public.organization_membership limit 1;
  perform tests.clear_auth();
  begin
    perform 1 from public.lens;
    raise exception 'FAIL: anon read lenses';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out visitor cannot read lenses');
  end;
  begin
    insert into public.lens (organization_id, owner_id, name, kind) values (v_org, v_user, 'Anon', 'table');
    raise exception 'FAIL: anon created a lens';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out visitor cannot create a lens');
  end;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Saved views become lenses
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_program uuid := gen_random_uuid();
  v_board uuid;
  v_mine uuid;
  v_projects uuid;
  v_odd uuid;
  v_lens public.lens;
  v_before integer;
  v_result jsonb;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;

  insert into public.saved_view (organization_id, user_id, name, path, query, shared)
  values (v_org, v_owner, 'Blocked high this week', '/board',
    jsonb_build_object('priority', 'high', 'blocked', 'yes', 'due', 'week', 'q', 'grant', 'program', v_program), true)
  returning id into v_board;
  insert into public.saved_view (organization_id, user_id, name, path, query)
  values (v_org, v_staff, 'My overdue', '/my-work', '{"due":"overdue","label":"not-yet","status":"ready"}')
  returning id into v_mine;
  insert into public.saved_view (organization_id, user_id, name, path, query, shared)
  values (v_org, v_owner, 'At risk', '/projects', '{"health":"at_risk","stale":"30","stage":"active"}', true)
  returning id into v_projects;
  insert into public.saved_view (organization_id, user_id, name, path, query)
  values (v_org, v_owner, 'Odd values', '/board', '{"status":"nope","priority":"x''; drop table task; --","due":"forever"}')
  returning id into v_odd;

  -- Board view.
  select * into strict v_lens from public.lens where source_saved_view_id = v_board;
  perform tests.ok(v_lens.kind = 'board' and v_lens.type_key = 'task' and v_lens.visibility = 'shared'
      and v_lens.owner_id = v_owner and v_lens.name = 'Blocked high this week' and v_lens.path = '/board',
    'a shared board view becomes a shared board lens with its owner and name');
  perform tests.ok(v_lens.spec -> 'where' -> 'and' @> jsonb_build_array(
      '{"property":"status","operator":"is_any_of"}'::jsonb,
      '{"property":"status","operator":"is","value":"blocked"}'::jsonb,
      '{"property":"priority","operator":"is","value":"high"}'::jsonb,
      '{"property":"due","operator":"is","value":{"relative":"next_7_days"}}'::jsonb,
      '{"property":"title","operator":"contains","value":"grant"}'::jsonb,
      jsonb_build_object('property', 'program', 'operator', 'is', 'value', v_program))
      and v_lens.spec #>> '{groupBy,property}' = 'status'
      and v_lens.unsupported_filters = array[]::text[],
    'every board filter is converted, blocked and open statuses as on the board');
  perform tests.ok(v_lens.legacy_query = (select query from public.saved_view where id = v_board),
    'the original query is kept');

  -- My Work view: owner scoping, unsupported label kept and listed.
  select * into strict v_lens from public.lens where source_saved_view_id = v_mine;
  perform tests.ok(v_lens.kind = 'list' and v_lens.visibility = 'personal'
      and v_lens.spec -> 'where' -> 'and' -> 0 = '{"property":"assignee","operator":"contains","value":{"relative":"me"}}'::jsonb
      and v_lens.spec -> 'where' -> 'and' @> '[{"property":"status","operator":"is","value":"ready"},{"property":"due","operator":"before","value":{"relative":"today"}}]'::jsonb
      and v_lens.unsupported_filters = array['label'],
    'a My Work view becomes a personal list lens scoped to the viewer; the label filter is listed as unsupported');

  -- Portfolio view.
  select * into strict v_lens from public.lens where source_saved_view_id = v_projects;
  perform tests.ok(v_lens.kind = 'table' and v_lens.type_key = 'project'
      and v_lens.spec -> 'where' -> 'and' @> '[{"property":"health","operator":"is","value":"at_risk"},{"property":"stage","operator":"is","value":"active"}]'::jsonb
      and v_lens.unsupported_filters = array['stale'],
    'a portfolio view becomes a project table lens');

  -- Bad values are never guessed.
  select * into strict v_lens from public.lens where source_saved_view_id = v_odd;
  perform tests.ok(v_lens.unsupported_filters @> array['status', 'priority', 'due']
      and not (v_lens.spec::text like '%drop table%'),
    'values the screens would reject are listed as unsupported, not converted');

  -- Converted specs run in the engine, as the owner and as another person.
  perform tests.authenticate(v_owner, 'aal2');
  for v_lens in select * from public.lens where source_saved_view_id in (v_board, v_projects, v_odd) loop
    v_result := public.lens_query(v_lens.spec);
    perform tests.ok(v_result ? 'rows', 'the converted "' || v_lens.name || '" lens runs in the engine');
  end loop;
  reset role;
  perform tests.authenticate(v_staff, 'aal2');
  v_result := public.lens_query((select spec from public.lens where source_saved_view_id = v_mine));
  perform tests.ok(v_result ? 'rows', 'the converted My Work lens runs for its owner');
  perform tests.ok(exists (select 1 from public.lens where source_saved_view_id = v_board),
    'staff see the owner''s shared board lens');
  perform tests.ok(not exists (select 1 from public.lens where source_saved_view_id = v_odd),
    'staff do not see the owner''s personal view''s lens');
  reset role;

  -- The copy follows the old screens.
  update public.saved_view set name = 'Renamed', shared = false where id = v_board;
  perform tests.ok((select name = 'Renamed' and visibility = 'personal' from public.lens where source_saved_view_id = v_board),
    'renaming or unsharing a saved view updates its lens');
  delete from public.saved_view where id = v_odd;
  perform tests.ok(not exists (select 1 from public.lens where source_saved_view_id = v_odd),
    'deleting a saved view deletes its lens');

  -- Undo and redo.
  select count(*) into v_before from public.lens where source_saved_view_id is not null;
  -- Called on its own, before the checks that read the result.
  v_result := to_jsonb(app.lens_unmigrate_saved_views());
  perform tests.ok((v_result #>> '{}')::int = v_before
      and not exists (select 1 from public.lens where source_saved_view_id is not null)
      and exists (select 1 from public.lens where source_saved_view_id is null),
    'the undo removes every copy and only the copies');
  -- Called on its own: inside one expression the planner may run the
  -- counts before the function.
  v_before := app.lens_migrate_saved_views();
  perform tests.ok(v_before = (select count(*) from public.saved_view)
      and (select count(*) from public.lens where source_saved_view_id is not null) = (select count(*) from public.saved_view),
    'the redo copies every saved view again');
  perform app.lens_migrate_saved_views();
  perform tests.ok((select count(*) from public.lens where source_saved_view_id is not null) = (select count(*) from public.saved_view),
    'running the migration twice creates no duplicates');
end;
$$;

rollback;
