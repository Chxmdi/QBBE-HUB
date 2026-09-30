-- Workspace OS spaces (M10a): every organization, member and program has its
-- space; each role gets exactly the default capabilities in
-- 20261102010100_spaces.sql; the table's policies allow and deny as intended.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

create function tests.sp_raises(p_sql text, p_pattern text, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  perform tests.ok(v_error is not null and v_error ilike '%' || p_pattern || '%',
    format('%s (%s)', p_msg, coalesce(v_error, 'no error')));
end;
$$;
grant execute on function tests.sp_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_lead uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_viewer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_all constant text[] := array['view', 'comment', 'edit_content', 'edit_structure', 'manage', 'run_workflow', 'share'];
  v_org uuid;
  v_workspace uuid;
  v_program uuid;
  v_program_space_name text;
  v_custom uuid;
  v_staff_private uuid;
  v_owner_private uuid;
  v_new_org uuid;
  v_rows integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  -- The accountant is a guest with a live ledger grant (#154); spaces give
  -- them nothing beyond a guest. qa-readonly plays the leadership viewer.
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '1 day', v_admin);
  update public.organization_membership set role = 'leadership_viewer'
  where organization_id = v_org and user_id = v_viewer;

  -- ------------------------------------------------------------------
  -- Every organization, member and program has its space.
  -- ------------------------------------------------------------------
  select id into strict v_workspace from public.space
  where organization_id = v_org and kind = 'workspace';

  perform tests.ok(
    not exists (
      select 1 from public.organization_membership m
      where m.status = 'active'
        and not exists (
          select 1 from public.space s
          where s.kind = 'private' and s.organization_id = m.organization_id and s.owner_id = m.user_id))
    and not exists (
      select 1 from public.organization o
      where not exists (select 1 from public.space s where s.kind = 'workspace' and s.organization_id = o.id))
    and not exists (
      select 1 from public.program p
      where not exists (select 1 from public.space s where s.id = p.id and s.kind = 'program')),
    'every organization has a workspace space, every active member a private space, every program a space'
  );

  insert into public.organization (name, slug)
  values ('Spaces test org', 'spaces-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_new_org;
  perform tests.ok(
    exists (select 1 from public.space where organization_id = v_new_org and kind = 'workspace'
            and name_en = 'Workspace' and name_fr = 'Espace de travail'),
    'a new organization gets its workspace space at once'
  );

  insert into public.program (organization_id, name, slug, description, lead_id, created_by)
  values (v_org, 'Spaces program', 'spaces-' || substr(gen_random_uuid()::text, 1, 8), 'About', v_lead, v_owner)
  returning id into v_program;
  select name_en into v_program_space_name from public.space where id = v_program and kind = 'program';
  perform tests.ok(v_program_space_name = 'Spaces program',
    'a new program becomes a space with the same id and its name');

  update public.program set name = 'Renamed program' where id = v_program;
  perform tests.ok(
    (select name_en = 'Renamed program' and name_fr = 'Renamed program' and archived_at is null
     from public.space where id = v_program),
    'renaming a program renames its space');
  update public.program set status = 'archived' where id = v_program;
  perform tests.ok((select archived_at is not null from public.space where id = v_program),
    'archiving a program archives its space');
  update public.program set status = 'active', archived_at = null where id = v_program;
  perform tests.ok((select archived_at is null from public.space where id = v_program),
    'restoring a program restores its space');

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, '   ', 'spaces-blank-' || substr(gen_random_uuid()::text, 1, 8), v_owner);
  perform tests.ok(
    exists (select 1 from public.space s join public.program p on p.id = s.id
            where p.name = '   ' and s.name_en = 'Program' and s.name_fr = 'Programme'),
    'a program with a blank name still saves, and its space reads "Program"');

  select id into strict v_staff_private from public.space
  where organization_id = v_org and kind = 'private' and owner_id = v_staff;
  select id into strict v_owner_private from public.space
  where organization_id = v_org and kind = 'private' and owner_id = v_owner;

  insert into public.space (organization_id, kind, name_en, name_fr)
  values (v_org, 'custom', 'Board', 'Conseil') returning id into v_custom;

  perform tests.sp_raises(
    format('insert into public.space (organization_id, kind, program_id, name_en, name_fr) values (%L, ''program'', %L, ''x'', ''x'')',
      v_org, gen_random_uuid()),
    'space_kind_shape', 'a program space must carry its program''s id');
  perform tests.sp_raises(
    format('insert into public.space (organization_id, kind, owner_id, name_en, name_fr) values (%L, ''private'', %L, ''x'', ''x'')',
      v_org, v_staff),
    'duplicate key', 'a member has one private space');
  perform tests.sp_raises(
    format('insert into public.space (organization_id, kind, name_en, name_fr) values (%L, ''workspace'', ''x'', ''x'')', v_org),
    'duplicate key', 'an organization has one workspace space');

  -- ------------------------------------------------------------------
  -- Default capabilities, role by role.
  -- ------------------------------------------------------------------
  perform tests.authenticate(v_owner);
  perform tests.ok(public.space_capabilities(v_workspace) @> v_all
      and public.space_capabilities(v_custom) @> v_all
      and public.space_capabilities(v_program) @> v_all
      and public.space_capabilities(v_owner_private) @> v_all,
    'owner with two-step sign-in: everything in the workspace, custom, program and own private space');
  perform tests.ok(cardinality(public.space_capabilities(v_staff_private)) = 0,
    'owner: nothing in someone else''s private space');
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(public.space_capabilities(v_workspace) = array['view']
      and public.space_capabilities(v_custom) = array['view']
      and public.space_capabilities(v_program) = array['view'],
    'owner without two-step sign-in: view only');
  reset role;

  perform tests.authenticate(v_admin);
  perform tests.ok(public.space_capabilities(v_workspace) @> v_all
      and public.space_capabilities(v_custom) @> v_all
      and public.can_in_space(v_program, 'manage')
      and cardinality(public.space_capabilities(v_staff_private)) = 0,
    'admin: everything except other people''s private spaces');
  reset role;

  perform tests.authenticate(v_staff);
  perform tests.ok(public.space_capabilities(v_workspace) = array['view', 'comment', 'edit_content']
      and public.can_create_in_space(v_workspace)
      and cardinality(public.space_capabilities(v_custom)) = 0
      and cardinality(public.space_capabilities(v_program)) = 0
      and public.space_capabilities(v_staff_private) @> v_all
      and cardinality(public.space_capabilities(v_owner_private)) = 0,
    'staff: view, comment and add content in the workspace; everything in their private space; nothing else by default');
  reset role;

  perform tests.authenticate(v_lead);
  perform tests.ok(public.space_capabilities(v_program) @> v_all,
    'a program lead has everything in their program''s space (from the program rules)');
  reset role;

  perform tests.authenticate(v_viewer);
  perform tests.ok(public.space_capabilities(v_workspace) = array['view']
      and public.space_capabilities(v_program) = array['view']
      and cardinality(public.space_capabilities(v_custom)) = 0,
    'leadership viewer: view the workspace and programs, nothing in custom spaces');
  reset role;

  foreach v_rows in array array[1, 2] loop
    perform tests.authenticate(case v_rows when 1 then v_volunteer else v_guest end);
    perform tests.ok(cardinality(public.space_capabilities(v_workspace)) = 0
        and cardinality(public.space_capabilities(v_custom)) = 0
        and cardinality(public.space_capabilities(v_program)) = 0
        and not public.can_create_in_space(v_workspace),
      case v_rows when 1 then 'volunteer' else 'guest and accountant' end
        || ': nothing in the workspace, custom or program spaces by default');
    reset role;
  end loop;

  perform tests.authenticate(v_guest);
  perform tests.ok(
    (select public.space_capabilities(id) @> v_all from public.space where owner_id = v_guest and kind = 'private'),
    'every member, the guest included, owns their private space');
  reset role;

  perform tests.ok(
    public.can_in_space(v_workspace, 'view') is false,
    'with nobody signed in, even the database owner gets nothing');

  -- ------------------------------------------------------------------
  -- Row-level security on the table.
  -- ------------------------------------------------------------------
  perform tests.authenticate(v_staff);
  select count(*) into v_rows from public.space where id in (v_workspace, v_staff_private);
  perform tests.ok(v_rows = 2, 'staff read the workspace space and their own private space');
  select count(*) into v_rows from public.space where id in (v_custom, v_owner_private, v_program);
  perform tests.ok(v_rows = 0, 'staff cannot read custom, program or other private spaces they have no access to');
  perform tests.sp_raises(
    format('insert into public.space (organization_id, kind, name_en, name_fr) values (%L, ''custom'', ''Mine'', ''À moi'')', v_org),
    'row-level security', 'staff cannot create a space');
  update public.space set name_en = 'Hacked' where id = v_workspace;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'staff cannot rename the workspace space');
  update public.space set name_en = 'Mine' where id = v_staff_private;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'a private space is fixed, even for its owner');
  reset role;

  foreach v_rows in array array[1, 2] loop
    perform tests.authenticate(case v_rows when 1 then v_volunteer else v_guest end);
    perform tests.ok(
      (select count(*) from public.space where organization_id = v_org) = 1,
      case v_rows when 1 then 'volunteer' else 'guest and accountant' end || ' read only their own private space');
    reset role;
  end loop;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.sp_raises(
    format('insert into public.space (organization_id, kind, name_en, name_fr) values (%L, ''custom'', ''Ops'', ''Opérations'')', v_org),
    'row-level security', 'an owner without two-step sign-in cannot create a space');
  reset role;

  perform tests.authenticate(v_admin);
  insert into public.space (organization_id, kind, name_en, name_fr)
  values (v_org, 'custom', 'Admin', 'Administration');
  perform tests.ok(found, 'an admin with two-step sign-in creates a custom space');
  perform tests.sp_raises(
    format('insert into public.space (organization_id, kind, name_en, name_fr) values (%L, ''workspace'', ''x'', ''x'')', v_new_org),
    'row-level security', 'an admin cannot create spaces in another organization, nor non-custom spaces');
  update public.space set name_en = 'Board of directors', name_fr = 'Conseil d''administration' where id = v_custom;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 1, 'an admin renames a custom space');
  update public.space set archived_at = now() where id = v_custom;
  perform tests.ok(public.space_capabilities(v_custom) = array['view', 'manage'],
    'an archived space keeps only view and manage');
  update public.space set name_en = 'x' where id = v_program;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'an admin cannot rename a program space directly');
  perform tests.sp_raises(
    format('update public.space set owner_id = %L where id = %L', v_admin, v_custom),
    'permission denied', 'nobody changes a space''s owner through the API');
  perform tests.sp_raises(
    format('delete from public.space where id = %L', v_custom),
    'permission denied', 'spaces are archived, never deleted, through the API');
  reset role;

  -- The guard holds even where RLS does not apply.
  perform tests.sp_raises(
    format('update public.space set kind = ''custom'' where id = %L', v_workspace),
    'cannot change', 'a space''s kind never changes');
  perform tests.sp_raises(
    format('update public.space set name_en = ''x'' where id = %L', v_program),
    'follows its program', 'a program space''s name comes from its program');

  -- Deactivation closes a private space to its owner; it is kept for them.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_staff;
  perform tests.authenticate(v_staff);
  perform tests.ok(cardinality(public.space_capabilities(v_staff_private)) = 0,
    'a deactivated member loses their private space');
  reset role;
  perform tests.ok(exists (select 1 from public.space where id = v_staff_private),
    'the private space itself is kept');
end;
$$;

-- Signed out: the table and the checks are closed.
do $$
declare
  v_rows integer;
begin
  perform tests.clear_auth();
  perform tests.sp_raises('select count(*) from public.space', 'permission denied',
    'a signed-out visitor cannot read spaces');
  perform tests.sp_raises(format('select public.can_in_space(%L, ''view'')', gen_random_uuid()),
    'permission denied', 'a signed-out visitor cannot call can_in_space');
  perform tests.sp_raises(format('select public.space_capabilities(%L)', gen_random_uuid()),
    'permission denied', 'a signed-out visitor cannot call space_capabilities');
  reset role;

  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (('app', 'space_capabilities'), ('app', 'space_can'),
       ('public', 'space_capabilities'), ('public', 'can_in_space'), ('public', 'can_create_in_space'),
       ('app', 'sync_organization_space'), ('app', 'sync_member_private_space'), ('app', 'sync_program_space'))),
    'space functions are security definer with an empty search path');
  perform tests.ok(
    not has_function_privilege('authenticated', 'app.space_capabilities(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.space_capabilities(uuid)', 'execute'),
    'signed-in people reach space checks only through the public wrappers');
  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.space'::regclass),
    'row-level security is on for space');
end;
$$;

rollback;
