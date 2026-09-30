-- Workspace OS M16a: version snapshots and the 30-day trash
-- (20261103110200_object_versions_and_trash.sql). Run after qa-users.sql and
-- rls.sql; everything is rolled back.
--
-- Objects are tasks until the registry lands (app.can knows tasks and
-- projects). Roles: owner and admin at both sign-in levels, staff (a task
-- reviewer), volunteer (a task assignee), guest (the ordinary member), an
-- external accountant (a guest with a ledger grant) and a signed-out visitor.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  t_open uuid;
  t_volunteer uuid;
  t_staff uuid;
  v_id uuid;
  v_count integer;
  v_failed boolean;
  v_hold uuid;
  v_content jsonb := '{"version": 1, "blocks": [{"id": "description", "type": "paragraph", "text": "First"}]}';
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Versions', 'wos-ver-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Versions', v_owner, v_owner)
  returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Leadership only', v_owner) returning id into t_open;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Volunteer''s task', v_owner, v_volunteer) returning id into t_volunteer;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Staff reviews', v_owner) returning id into t_staff;
  insert into public.task_assignment (task_id, user_id, role) values (t_staff, v_staff, 'reviewer');

  -- -------------------------------------------------------------------------
  -- Hardening
  -- -------------------------------------------------------------------------
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
       ('app', 'current_organization'), ('app', 'object_is_held'), ('public', 'save_object_version'),
       ('app', 'prune_object_versions'), ('app', 'object_registry_exec'),
       ('public', 'trash_object'), ('public', 'restore_object'), ('app', 'purge_object_trash')
     )),
    'every new function is security definer with an empty search_path'
  );
  perform tests.ok(
    not has_function_privilege('anon', 'public.save_object_version(uuid, text, text, jsonb, jsonb, text)', 'execute')
      and not has_function_privilege('anon', 'public.trash_object(uuid, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.restore_object(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'app.purge_object_trash()', 'execute')
      and not has_function_privilege('authenticated', 'app.object_registry_exec(text, uuid)', 'execute')
      and not has_table_privilege('authenticated', 'public.object_version', 'insert')
      and not has_table_privilege('authenticated', 'public.object_version', 'update')
      and not has_table_privilege('authenticated', 'public.object_version', 'delete')
      and not has_table_privilege('authenticated', 'public.object_trash', 'insert')
      and not has_table_privilege('anon', 'public.object_version', 'select')
      and not has_table_privilege('anon', 'public.object_trash', 'select'),
    'versions and trash are written only through their functions; signed-out visitors reach nothing'
  );
  perform tests.ok(
    exists (select 1 from cron.job where jobname = 'workspace-os-object-trash')
      and exists (select 1 from cron.job where jobname = 'workspace-os-version-prune'),
    'the nightly purge and prune are scheduled'
  );

  -- -------------------------------------------------------------------------
  -- Saving versions: needs edit_content
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  v_id := public.save_object_version(t_open, 'task', 'manual', v_content, '{"title": "Leadership only"}', 'Kick-off');
  perform tests.ok(v_id is not null, 'owner (two-step) saves a named version');
  perform tests.ok(
    public.save_object_version(t_open, 'task', 'auto', v_content, '{}') is null,
    'an automatic snapshot within ten minutes of the last version is skipped'
  );
  perform tests.ok(
    public.save_object_version(t_open, 'task', 'manual', v_content, '{}', 'Again') is not null,
    'a named version is always saved'
  );
  reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(
    public.save_object_version(t_volunteer, 'task', 'manual', v_content, '{}') is not null,
    'admin (two-step) saves a version'
  );
  reset role;

  foreach v_id in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_id, 'aal1');
    v_failed := false;
    begin
      perform public.save_object_version(t_open, 'task', 'manual', v_content, '{}');
    exception when insufficient_privilege then v_failed := true;
    end;
    perform tests.ok(v_failed, format('%s without the second step cannot save a version', v_id));
    select count(*) into v_count from public.object_version where object_id = t_open;
    perform tests.ok(v_count = 2, format('%s without the second step still reads the history', v_id));
    reset role;
  end loop;

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_count from public.object_version where object_id = t_volunteer;
  perform tests.ok(v_count = 1, 'volunteer reads the history of their task');
  perform tests.ok(
    public.save_object_version(t_volunteer, 'task', 'auto', v_content || '{"x": 1}', '{}') is null,
    'volunteer''s automatic snapshot is skipped too while the last one is recent'
  );
  v_failed := false;
  begin
    perform public.save_object_version(t_open, 'task', 'manual', v_content, '{}');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'volunteer cannot save a version of an object they cannot edit');
  select count(*) into v_count from public.object_version where object_id = t_open;
  perform tests.ok(v_count = 0, 'volunteer reads no history of an object they cannot see');
  reset role;

  -- Ten minutes of editing later: a changed snapshot is taken, an unchanged one is not.
  update public.object_version set created_at = created_at - interval '11 minutes' where object_id = t_volunteer;
  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.ok(
    public.save_object_version(t_volunteer, 'task', 'auto', v_content, '{}') is null,
    'an unchanged automatic snapshot is skipped even after ten minutes'
  );
  perform tests.ok(
    public.save_object_version(t_volunteer, 'task', 'auto', v_content || '{"x": 2}', '{}') is not null,
    'a changed automatic snapshot is taken after ten minutes'
  );
  reset role;

  perform tests.authenticate(v_staff, 'aal1');
  v_failed := false;
  begin
    perform public.save_object_version(t_staff, 'task', 'manual', v_content, '{}');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'staff who only review cannot save a version');
  select count(*) into v_count from public.object_version where object_id in (t_open, t_volunteer);
  perform tests.ok(v_count = 0, 'staff reads no history outside their grants');
  reset role;

  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.object_version;
  perform tests.ok(v_count = 0, 'member (guest) reads no versions');
  v_failed := false;
  begin
    perform public.save_object_version(t_open, 'task', 'manual', v_content, '{}');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'member (guest) cannot save a version');
  reset role;

  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.object_version;
  perform tests.ok(v_count = 0, 'accountant reads no versions');
  reset role;

  perform tests.clear_auth();
  v_failed := false;
  begin
    perform 1 from public.object_version;
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a signed-out visitor cannot read versions');
  reset role;

  -- -------------------------------------------------------------------------
  -- Pruning keeps named versions, the last 30 days, the newest 50, and
  -- everything under legal hold.
  -- -------------------------------------------------------------------------
  insert into public.object_version (organization_id, object_id, object_type, kind, content_hash, created_at)
  select v_org, t_staff, 'task', 'auto', md5(n::text), now() - interval '40 days' - (n || ' minutes')::interval
  from generate_series(1, 60) n;
  insert into public.object_version (organization_id, object_id, object_type, kind, content_hash, created_at)
  select v_org, t_staff, 'task', 'manual', 'named', now() - interval '400 days';
  insert into public.legal_hold (organization_id, scope, record_type, record_id, reason, placed_by)
  values (v_org, 'record', 'task', t_staff, 'Audit request', v_owner)
  returning id into v_hold;
  perform tests.ok(app.prune_object_versions() = 0, 'nothing is pruned from an object under legal hold');
  update public.legal_hold set released_at = now(), released_by = v_owner, release_reason = 'Audit closed'
  where id = v_hold;
  perform tests.ok(app.prune_object_versions() = 10, 'old automatic versions beyond the newest 50 are pruned');
  perform tests.ok(
    exists (select 1 from public.object_version where object_id = t_staff and kind = 'manual'),
    'named versions are never pruned'
  );

  -- -------------------------------------------------------------------------
  -- Trash: needs manage; a hold stops it; 30 days to restore
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_volunteer, 'aal1');
  v_failed := false;
  begin
    perform public.trash_object(t_volunteer, 'task', 'Volunteer''s task');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'volunteer who can edit but not manage cannot delete');
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  v_failed := false;
  begin
    perform public.trash_object(t_open, 'task', 'Leadership only');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'owner without the second step cannot delete');
  reset role;

  insert into public.legal_hold (organization_id, scope, record_type, record_id, reason, placed_by)
  values (v_org, 'record', 'task', t_open, 'Litigation', v_owner)
  returning id into v_hold;
  perform tests.authenticate(v_owner, 'aal2');
  v_failed := false;
  begin
    perform public.trash_object(t_open, 'task', 'Leadership only');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'an object under legal hold cannot be put in the trash');
  reset role;
  update public.legal_hold set released_at = now(), released_by = v_owner, release_reason = 'Settled'
  where id = v_hold;

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(public.trash_object(t_open, 'task', 'Leadership only') is not null, 'owner (two-step) deletes an object');
  perform tests.ok(
    (select purge_after::date = (now() + interval '30 days')::date and deleted_by = v_owner
     from public.object_trash where object_id = t_open),
    'a deleted object is kept 30 days and names who deleted it'
  );
  v_failed := false;
  begin
    perform public.trash_object(t_open, 'task', 'Leadership only');
  exception when unique_violation then v_failed := true;
  end;
  perform tests.ok(v_failed, 'an object is in the trash once at a time');
  v_failed := false;
  begin
    perform public.save_object_version(t_open, 'task', 'manual', v_content, '{}');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'no version is saved while the object is in the trash');
  reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_count from public.object_trash;
  perform tests.ok(v_count = 0, 'volunteer does not see deleted objects they could not see');
  reset role;
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.object_trash;
  perform tests.ok(v_count = 0, 'member and accountant see nothing in the trash');
  reset role;
  perform tests.authenticate(v_staff, 'aal1');
  v_failed := false;
  begin
    perform public.restore_object(t_open);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'staff cannot restore what they neither deleted nor manage');
  reset role;

  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_count from public.object_trash where object_id = t_open;
  perform tests.ok(v_count = 1, 'admin sees the deleted object');
  perform public.restore_object(t_open);
  perform tests.ok(
    (select restored_by = v_admin and restored_at is not null from public.object_trash where object_id = t_open),
    'admin (two-step) restores it, and the restore is recorded'
  );
  v_failed := false;
  begin
    perform public.restore_object(t_open);
  exception when no_data_found then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a restored object is no longer in the trash');
  reset role;

  -- Purge after 30 days, except under hold.
  perform tests.authenticate(v_owner, 'aal2');
  perform public.trash_object(t_volunteer, 'task', 'Volunteer''s task');
  reset role;
  update public.object_trash set purge_after = now() - interval '1 minute' where object_id = t_volunteer;
  insert into public.legal_hold (organization_id, scope, record_type, record_id, reason, placed_by)
  values (v_org, 'record', 'task', t_volunteer, 'Held after deletion', v_owner)
  returning id into v_hold;
  perform tests.ok(app.purge_object_trash() = 0, 'an object placed on hold while in the trash is not purged');
  update public.legal_hold set released_at = now(), released_by = v_owner, release_reason = 'Released'
  where id = v_hold;
  perform tests.ok(app.purge_object_trash() = 1, 'after 30 days the trash is purged');
  perform tests.ok(
    not exists (select 1 from public.object_version where object_id = t_volunteer),
    'purging removes the object''s versions'
  );
  -- A registry object held as `object`: the purge skips it, then removes
  -- the registry row once the hold is released.
  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_org, 'wos_versions_test', 'Test', 'Test', 'custom')
  returning id into v_id;
  insert into public.object (organization_id, type_id, title)
  values (v_org, v_id, 'Held registry object')
  returning id into v_id;
  insert into public.object_trash (organization_id, object_id, object_type, title, deleted_by, purge_after)
  values (v_org, v_id, 'wos_versions_test', 'Held registry object', v_owner, now() - interval '1 minute');
  insert into public.legal_hold (organization_id, scope, record_type, record_id, reason, placed_by)
  values (v_org, 'record', 'object', v_id, 'Held as a registry object', v_owner)
  returning id into v_hold;
  perform tests.ok(app.purge_object_trash() = 0, 'a hold placed on a registry object stops its purge');
  update public.legal_hold set released_at = now(), released_by = v_owner, release_reason = 'Released'
  where id = v_hold;
  perform tests.ok(app.purge_object_trash() = 1, 'the released registry object is purged');
  perform tests.ok(
    not exists (select 1 from public.object where id = v_id),
    'purging removes the object from the registry'
  );

  perform tests.authenticate(v_owner, 'aal2');
  v_failed := false;
  begin
    perform public.restore_object(t_volunteer);
  exception when no_data_found then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a purged object cannot be restored');
  reset role;

  perform tests.clear_auth();
  v_failed := false;
  begin
    perform public.trash_object(t_staff, 'task', 'x');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a signed-out visitor cannot delete');
  reset role;
end;
$$;

rollback;
