-- Preparation-stage scoped grant/provenance verification.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_other_org uuid;
  v_program uuid;
  v_project uuid;
  v_team uuid;
  v_other_team uuid;
  v_program_grant uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership owner_membership
  where owner_membership.user_id = v_owner
    and exists (
      select 1 from public.organization_membership peer
      where peer.organization_id = owner_membership.organization_id
        and peer.user_id = v_admin
    );

  perform tests.ok(
    enum_range(null::public.program_access_role)::text =
      '{lead,manager,contributor,reviewer,follower,read_only}',
    'program access roles are closed and typed'
  );
  perform tests.ok(
    enum_range(null::public.project_access_role)::text =
      '{project_manager,contributor,reviewer,approver,follower,read_only}',
    'project access roles are closed and typed'
  );
  perform tests.ok(
    app.map_legacy_program_role('member') = 'contributor'
      and app.map_legacy_project_role('member') = 'contributor',
    'legacy member roles map to contributor without management access'
  );
  perform tests.ok(
    app.map_legacy_program_role('unexpected-role') = 'read_only'
      and app.map_legacy_project_role('unexpected-role') = 'read_only',
    'unknown legacy roles map to read-only for administrator review'
  );

  begin
    perform 'superuser'::public.program_access_role;
    raise exception 'FAIL: invalid program access role was accepted';
  exception when invalid_text_representation then
    perform tests.ok(true, 'invalid program access roles are rejected');
  end;

  insert into public.program (
    organization_id, name, slug, lead_id, created_by
  ) values (
    v_org, 'Scoped access fixture',
    'scoped-access-' || substr(gen_random_uuid()::text, 1, 8),
    v_staff, v_owner
  ) returning id into v_program;

  select count(*) into n from public.program_access_grant
  where program_id = v_program and user_id = v_staff
    and role = 'lead' and source = 'record_lead';
  perform tests.ok(n = 1, 'program lead produces a distinct lead-source grant');

  insert into public.project (
    organization_id, program_id, name, owner_id, created_by
  ) values (
    v_org, v_program, 'Scoped access project', v_staff, v_owner
  ) returning id into v_project;

  select count(*) into n from public.project_access_grant
  where project_id = v_project and user_id = v_staff
    and role = 'project_manager' and source = 'record_owner';
  perform tests.ok(n = 1, 'project owner produces a distinct owner-source grant');

  select count(*) into n from public.project_access_grant
  where project_id = v_project and user_id = v_staff
    and role = 'project_manager' and source = 'program_inherited';
  perform tests.ok(n = 1, 'program lead access is inherited by an existing project');

  insert into public.program_access_grant (
    organization_id, program_id, user_id, role, source, created_by
  ) values (
    v_org, v_program, v_volunteer, 'contributor', 'direct', v_owner
  ) returning id into v_program_grant;

  select count(*) into n from public.project_access_grant
  where project_id = v_project and user_id = v_volunteer
    and role = 'contributor' and source = 'program_inherited'
    and source_program_grant_id = v_program_grant;
  perform tests.ok(n = 1, 'direct program grant creates source-linked project inheritance');

  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, created_by
  ) values (
    v_org, v_project, v_volunteer, 'read_only', 'direct', v_owner
  );

  delete from public.program_access_grant where id = v_program_grant;
  select count(*) into n from public.project_access_grant
  where project_id = v_project and user_id = v_volunteer
    and source = 'program_inherited';
  perform tests.ok(n = 0, 'revoking a program source removes only its inherited grants');
  select count(*) into n from public.project_access_grant
  where project_id = v_project and user_id = v_volunteer
    and source = 'direct';
  perform tests.ok(n = 1, 'revoking inheritance preserves an independent direct grant');

  insert into public.team (organization_id, name, owner_id)
  values (v_org, 'Scoped access team', v_owner) returning id into v_team;
  insert into public.channel (
    organization_id, name, slug, type, privacy, owner_id, team_id, created_by
  ) values (
    v_org, 'Scoped access team',
    'scoped-team-' || substr(gen_random_uuid()::text, 1, 8),
    'team', 'private', v_owner, v_team, v_owner
  );
  insert into public.team_member (team_id, user_id, organization_id)
  values (v_team, v_volunteer, v_org);
  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, source_team_id, created_by
  ) values (
    v_org, v_project, v_volunteer, 'contributor', 'team', v_team, v_owner
  );
  delete from public.team_member where team_id = v_team and user_id = v_volunteer;
  select count(*) into n from public.project_access_grant
  where project_id = v_project and user_id = v_volunteer and source = 'team';
  perform tests.ok(n = 0, 'removing team membership revokes only the team-derived grant');
  select count(*) into n from public.project_access_grant
  where project_id = v_project and user_id = v_volunteer and source = 'direct';
  perform tests.ok(n = 1, 'team removal preserves independently granted access');

  update public.program set lead_id = v_admin where id = v_program;
  perform tests.ok(
    not exists (
      select 1 from public.program_access_grant
      where program_id = v_program and user_id = v_staff and source = 'record_lead'
    ) and exists (
      select 1 from public.program_access_grant
      where program_id = v_program and user_id = v_admin
        and role = 'lead' and source = 'record_lead'
    ),
    'changing a program lead replaces only the record-lead source'
  );

  update public.project set owner_id = v_admin where id = v_project;
  perform tests.ok(
    not exists (
      select 1 from public.project_access_grant
      where project_id = v_project and user_id = v_staff and source = 'record_owner'
    ) and exists (
      select 1 from public.project_access_grant
      where project_id = v_project and user_id = v_admin
        and role = 'project_manager' and source = 'record_owner'
    ),
    'changing a project owner replaces only the record-owner source'
  );

  insert into public.program_access_grant (
    organization_id, program_id, user_id, role, source, created_by
  ) values (
    v_org, v_program, v_staff, 'reviewer', 'direct', v_owner
  ) returning id into v_program_grant;

  begin
    insert into public.project_access_grant (
      organization_id, project_id, user_id, role, source,
      source_program_grant_id, created_by
    ) values (
      v_org, v_project, v_staff, 'approver', 'program_inherited',
      v_program_grant, v_owner
    );
    raise exception 'FAIL: inherited role escalation was accepted';
  exception when check_violation then
    perform tests.ok(true, 'inherited grants cannot escalate the source program role');
  end;

  insert into public.organization (name, slug)
  values (
    'Scoped access other organization',
    'scoped-other-' || substr(gen_random_uuid()::text, 1, 8)
  ) returning id into v_other_org;

  insert into public.organization_membership (
    organization_id, user_id, role, status
  ) values (v_other_org, v_guest, 'guest', 'active');

  begin
    insert into public.program_access_grant (
      organization_id, program_id, user_id, role, source, created_by
    ) values (
      v_other_org, v_program, v_staff, 'contributor', 'direct', v_owner
    );
    raise exception 'FAIL: cross-organization program grant was accepted';
  exception when check_violation or foreign_key_violation then
    perform tests.ok(true, 'cross-organization program grant references are rejected');
  end;

  insert into public.team (organization_id, name, owner_id)
  values (v_other_org, 'Foreign scoped team', v_guest) returning id into v_other_team;
  insert into public.channel (
    organization_id, name, slug, type, privacy, owner_id, team_id, created_by
  ) values (
    v_other_org, 'Foreign scoped team',
    'foreign-team-' || substr(gen_random_uuid()::text, 1, 8),
    'team', 'private', v_guest, v_other_team, v_guest
  );
  insert into public.team_member (team_id, user_id, organization_id)
  values (v_other_team, v_guest, v_other_org) on conflict do nothing;
  begin
    insert into public.project_access_grant (
      organization_id, project_id, user_id, role, source, source_team_id, created_by
    ) values (
      v_org, v_project, v_guest, 'contributor', 'team', v_other_team, v_owner
    );
    raise exception 'FAIL: foreign team grant was accepted';
  exception when check_violation or foreign_key_violation then
    perform tests.ok(true, 'team-derived grants require a same-organization team');
  end;

  update public.organization_membership
  set status = 'deactivated'
  where organization_id = v_org and user_id = v_guest;
  begin
    insert into public.project_access_grant (
      organization_id, project_id, user_id, role, source, created_by
    ) values (
      v_org, v_project, v_guest, 'read_only', 'direct', v_owner
    );
    raise exception 'FAIL: grant to a deactivated target was accepted';
  exception when check_violation then
    perform tests.ok(true, 'new grants require an active target membership');
  end;
  update public.organization_membership
  set status = 'active'
  where organization_id = v_org and user_id = v_guest;

  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.project_access_grant where project_id = v_project;
  perform tests.ok(n = 0, 'non-admin users cannot enumerate scoped grant provenance');
  begin
    insert into public.program_access_grant (
      organization_id, program_id, user_id, role, source
    ) values (
      v_org, v_program, v_volunteer, 'contributor', 'direct'
    );
    raise exception 'FAIL: volunteer inserted a scoped grant';
  exception when insufficient_privilege then
    perform tests.ok(true, 'non-admin users cannot create scoped grants');
  end;
  reset role;

  perform tests.authenticate(v_admin, 'aal2');
  begin
    delete from public.project_access_grant
    where project_id = v_project and source = 'record_owner';
    raise exception 'FAIL: administrator directly deleted generated provenance';
  exception when insufficient_privilege then
    perform tests.ok(true, 'administrators cannot directly delete generated provenance');
  end;
  reset role;
  perform tests.ok(
    exists (
      select 1 from public.project_access_grant
      where project_id = v_project and source = 'record_owner'
    ),
    'generated owner provenance remains after a direct delete attempt'
  );
  perform tests.authenticate(v_admin, 'aal2');
  begin
    insert into public.project_access_grant (
      organization_id, project_id, user_id, role, source, legacy_role
    ) values (
      v_org, v_project, v_guest, 'read_only', 'legacy_membership', 'member'
    );
    raise exception 'FAIL: administrator forged a generated grant source';
  exception when insufficient_privilege then
    perform tests.ok(true, 'authenticated administrators cannot forge generated provenance');
  end;
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(
    public.has_program_capability(v_program, 'read')
      and public.has_project_capability(v_project, 'read')
      and not public.has_program_capability(v_program, 'manage')
      and not public.has_project_capability(v_project, 'collaborate'),
    'AAL1 administrators retain read access but no scoped mutation capability'
  );
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(
    public.has_program_capability(v_program, 'manage')
      and public.has_project_capability(v_project, 'approve'),
    'owner override is available through capability RPCs'
  );
  reset role;

  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    public.has_project_capability(v_project, 'read')
      and not public.has_project_capability(v_project, 'manage'),
    'read-only direct project grant permits reading without management'
  );
  reset role;

  update public.organization_membership
  set role = 'leadership_viewer'
  where organization_id = v_org and user_id = v_guest;
  perform tests.authenticate(v_guest);
  perform tests.ok(
    public.has_program_capability(v_program, 'read')
      and public.has_project_capability(v_project, 'read')
      and not public.has_program_capability(v_program, 'collaborate')
      and not public.has_project_capability(v_project, 'manage'),
    'leadership viewer capability is portfolio read-only'
  );
  perform tests.ok(
    not public.has_project_capability(v_project, 'unknown'),
    'unknown capability names fail closed'
  );
  reset role;

  update public.organization_membership
  set status = 'deactivated'
  where organization_id = v_org and user_id = v_volunteer;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    not public.has_project_capability(v_project, 'read'),
    'deactivation immediately disables otherwise retained scoped grants'
  );
  reset role;
end;
$$;

rollback;
