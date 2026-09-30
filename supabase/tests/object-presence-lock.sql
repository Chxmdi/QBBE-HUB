-- Workspace OS V1-17 part 1: presence and page lock
-- (20261103110300_presence_and_locks.sql). Run after qa-users.sql and rls.sql;
-- everything is rolled back. Objects are tasks until the registry lands.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_project uuid;
  v_program uuid;
  t_open uuid;
  t_volunteer uuid;
  v_count integer;
  v_failed boolean;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Presence', 'wos-pr-' || substr(gen_random_uuid()::text, 1, 8), v_owner) returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Presence', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Leadership only', v_owner) returning id into t_open;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Volunteer''s task', v_owner, v_volunteer) returning id into t_volunteer;

  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
       ('public', 'touch_presence'), ('public', 'leave_presence'), ('app', 'purge_stale_presence'),
       ('public', 'is_object_locked'), ('public', 'lock_object'), ('public', 'unlock_object'),
       ('app', 'guard_locked_object_version')
     )),
    'every new function is security definer with an empty search_path'
  );
  perform tests.ok(
    not has_table_privilege('authenticated', 'public.object_presence', 'insert')
      and not has_table_privilege('authenticated', 'public.object_presence', 'update')
      and not has_table_privilege('authenticated', 'public.object_lock', 'insert')
      and not has_table_privilege('authenticated', 'public.object_lock', 'delete')
      and not has_table_privilege('anon', 'public.object_presence', 'select')
      and not has_function_privilege('anon', 'public.touch_presence(uuid, jsonb, boolean)', 'execute')
      and not has_function_privilege('anon', 'public.lock_object(uuid, text)', 'execute'),
    'presence and locks are written through their functions only; signed-out visitors reach nothing'
  );
  perform tests.ok(
    exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'object_presence'),
    'presence changes are published to Realtime'
  );

  -- -------------------------------------------------------------------------
  -- Presence
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  perform public.touch_presence(t_open, '{"blockId": "description", "offset": 4, "length": 2}', true);
  perform public.touch_presence(t_volunteer, null, false);
  perform tests.ok(
    (select editing and cursor ->> 'offset' = '4' from public.object_presence where object_id = t_open and user_id = v_owner),
    'owner (two-step) is present on an object with their cursor, as an editor'
  );
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform public.touch_presence(t_open, null, true);
  perform tests.ok(
    (select not editing from public.object_presence where object_id = t_open and user_id = v_owner),
    'owner without the second step shows as viewing, not editing'
  );
  reset role;

  perform tests.authenticate(v_admin, 'aal1');
  perform public.touch_presence(t_open, null, false);
  select count(*) into v_count from public.object_presence where object_id = t_open;
  perform tests.ok(v_count = 2, 'admin sees everyone on an object they can view');
  reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  perform public.touch_presence(t_volunteer, '{"blockId": "description", "offset": 0}', true);
  select count(*) into v_count from public.object_presence where object_id = t_volunteer;
  perform tests.ok(v_count = 2, 'volunteer sees who else has their task open');
  select count(*) into v_count from public.object_presence where object_id = t_open;
  perform tests.ok(v_count = 0, 'volunteer does not learn who is on an object they cannot see');
  v_failed := false;
  begin
    perform public.touch_presence(t_open, null, false);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'volunteer cannot announce themselves on an object they cannot see');
  v_failed := false;
  begin
    perform public.touch_presence(t_volunteer, '{"blockId": 3, "offset": "x"}', true);
  exception when check_violation then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a malformed cursor is refused');
  perform public.leave_presence(t_volunteer);
  select count(*) into v_count from public.object_presence where object_id = t_volunteer and user_id = v_volunteer;
  perform tests.ok(v_count = 0, 'leaving removes only your own presence');
  reset role;

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.object_presence;
  perform tests.ok(v_count = 0, 'staff sees no presence on objects outside their grants');
  reset role;
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.object_presence;
  perform tests.ok(v_count = 0, 'member (guest) sees no presence');
  reset role;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.object_presence;
  perform tests.ok(v_count = 0, 'accountant sees no presence');
  reset role;

  update public.object_presence set updated_at = now() - interval '2 minutes' where user_id = v_admin;
  perform tests.authenticate(v_owner, 'aal2');
  select count(*) into v_count from public.object_presence where object_id = t_open;
  perform tests.ok(v_count = 1, 'someone silent for over a minute no longer shows as present');
  reset role;
  update public.object_presence set updated_at = now() - interval '2 hours' where user_id = v_admin;
  perform tests.ok(app.purge_stale_presence() >= 1, 'the nightly clean-up removes stale presence');
  perform tests.ok(
    not exists (select 1 from public.object_presence where user_id = v_admin and object_id = t_open)
      and exists (select 1 from public.object_presence where user_id = v_owner and object_id = t_open),
    'the clean-up removes only the stale rows'
  );

  -- -------------------------------------------------------------------------
  -- Lock
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_volunteer, 'aal1');
  v_failed := false;
  begin
    perform public.lock_object(t_volunteer, 'Final');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'volunteer who can edit but not manage cannot lock');
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  v_failed := false;
  begin
    perform public.lock_object(t_volunteer, 'Final');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'owner without the second step cannot lock');
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform public.lock_object(t_volunteer, 'Approved by the board');
  perform tests.ok(public.is_object_locked(t_volunteer), 'owner (two-step) locks an object');
  reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.ok(
    (select reason = 'Approved by the board' and locked_by = v_owner from public.object_lock where object_id = t_volunteer),
    'volunteer sees the lock, who placed it and why'
  );
  v_failed := false;
  begin
    perform public.save_object_version(t_volunteer, 'task', 'manual', '{"version": 1, "blocks": []}', '{}');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a locked object takes no new version');
  v_failed := false;
  begin
    perform public.unlock_object(t_volunteer);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'volunteer cannot unlock');
  reset role;

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.object_lock;
  perform tests.ok(v_count = 0, 'staff does not see locks on objects outside their grants');
  reset role;
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.object_lock;
  perform tests.ok(v_count = 0, 'member and accountant see no locks');
  reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform public.unlock_object(t_volunteer);
  perform tests.ok(not public.is_object_locked(t_volunteer), 'admin (two-step) unlocks');
  perform tests.ok(
    public.save_object_version(t_volunteer, 'task', 'manual', '{"version": 1, "blocks": []}', '{}') is not null,
    'an unlocked object takes versions again'
  );
  reset role;

  perform tests.clear_auth();
  v_failed := false;
  begin
    perform public.touch_presence(t_open, null, false);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a signed-out visitor cannot announce presence');
  reset role;
end;
$$;

rollback;
