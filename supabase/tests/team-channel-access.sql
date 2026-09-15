-- Team ownership, transactional channel creation, and provenance-safe access.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_other_org uuid;
  v_team uuid;
  v_channel uuid;
  v_mandatory uuid;
  v_program uuid;
  v_project uuid;
  v_foreign_program uuid;
  v_created boolean;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership owner_membership
  where owner_membership.user_id = v_owner
    and exists (
      select 1 from public.organization_membership peer
      where peer.organization_id = owner_membership.organization_id
        and peer.user_id = v_guest
    );

  insert into public.program (
    organization_id, name, slug, lead_id, created_by
  ) values (
    v_org, 'Team assignment program',
    'team-assignment-' || left(gen_random_uuid()::text, 8), v_owner, v_owner
  ) returning id into v_program;
  insert into public.project (
    organization_id, program_id, name, owner_id, created_by
  ) values (
    v_org, v_program, 'Team assignment project', v_owner, v_owner
  ) returning id into v_project;

  perform tests.authenticate(v_owner, 'aal2');
  select public.create_team_with_channel(
    'Team channel acceptance', 'Provenance verification', v_owner
  ) into v_team;
  reset role;

  select id into strict v_channel from public.channel where team_id = v_team;
  perform tests.ok(
    (select owner_id = v_owner from public.team where id = v_team),
    'a team records an active same-organization owner'
  );
  perform tests.ok(
    (select count(*) = 1 from public.channel where team_id = v_team)
      and (select type = 'team' and privacy = 'private' and owner_id = v_owner
           from public.channel where id = v_channel),
    'team creation atomically provisions one private owner-managed channel'
  );
  perform tests.ok(
    exists (
      select 1 from public.channel_access_grant
      where channel_id = v_channel and user_id = v_owner
        and source = 'team' and source_team_id = v_team and role = 'manager'
    ),
    'the team owner receives manager access from the team source'
  );

  select count(*) into n from public.audit_event
  where object_id = v_team and action = 'team_member_added'
    and (metadata->>'user_id')::uuid = v_volunteer;
  perform tests.authenticate(v_owner, 'aal2');
  select public.add_team_member(v_team, v_volunteer) into v_created;
  perform tests.ok(v_created, 'adding a team member reports a new membership');
  select public.add_team_member(v_team, v_volunteer) into v_created;
  perform tests.ok(not v_created, 'a duplicate team add is idempotent');
  reset role;
  perform tests.ok(
    (select count(*) from public.audit_event
       where object_id = v_team and action = 'team_member_added'
         and (metadata->>'user_id')::uuid = v_volunteer) = n + 1,
    'one successful team add produces one attributable audit event'
  );
  perform tests.ok(
    exists (
      select 1 from public.channel_access_grant
      where channel_id = v_channel and user_id = v_volunteer
        and source = 'team' and source_team_id = v_team
    ) and exists (
      select 1 from public.channel_member
      where channel_id = v_channel and user_id = v_volunteer
        and membership_source = 'team'
    ),
    'adding a team member materializes team-derived channel access'
  );

  -- A direct source coexists with the team source. Removing the team source
  -- must retain the direct grant and effective membership.
  perform tests.authenticate(v_owner, 'aal2');
  perform public.add_channel_member(v_channel, v_volunteer);
  perform public.remove_team_member(v_team, v_volunteer);
  reset role;
  perform tests.ok(
    not exists (
      select 1 from public.channel_access_grant
      where channel_id = v_channel and user_id = v_volunteer and source = 'team'
    ) and exists (
      select 1 from public.channel_access_grant
      where channel_id = v_channel and user_id = v_volunteer and source = 'direct'
    ),
    'removing a team member revokes only the team-derived source'
  );
  perform tests.ok(
    exists (
      select 1 from public.channel_member
      where channel_id = v_channel and user_id = v_volunteer
        and membership_source = 'manual'
    ),
    'an independent direct grant keeps the effective channel membership'
  );

  -- Recreate team-only access for the denial and lifecycle checks.
  delete from public.channel_access_grant
  where channel_id = v_channel and user_id = v_volunteer and source = 'direct';
  perform tests.authenticate(v_owner, 'aal2');
  perform public.add_team_member(v_team, v_volunteer);
  reset role;

  perform tests.authenticate(v_volunteer);
  begin
    delete from public.channel_member
    where channel_id = v_channel and user_id = v_volunteer;
    raise exception 'FAIL: derived member deleted the effective projection';
  exception when insufficient_privilege then
    perform tests.ok(true, 'derived members cannot delete the effective projection');
  end;
  begin
    perform public.leave_channel(v_channel);
    raise exception 'FAIL: derived member left a team-managed channel';
  exception when insufficient_privilege then
    perform tests.ok(true, 'derived team access cannot be self-revoked');
  end;
  reset role;

  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_volunteer;
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.channel where id = v_channel;
  perform tests.ok(n = 0, 'deactivation immediately disables retained team channel access');
  reset role;
  perform tests.ok(
    exists (
      select 1 from public.channel_access_grant
      where channel_id = v_channel and user_id = v_volunteer and source = 'team'
    ) and exists (
      select 1 from public.channel_member
      where channel_id = v_channel and user_id = v_volunteer
    ),
    'deactivation preserves source grants and the historical projection'
  );
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_volunteer;
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.channel where id = v_channel;
  perform tests.ok(n = 1, 'reactivation restores access from the retained grant');
  reset role;

  -- An active membership in some other organization is not enough to join
  -- this team when the target's local membership is inactive.
  insert into public.organization (name, slug)
  values ('Foreign team target', 'foreign-team-target-' || left(gen_random_uuid()::text, 8))
  returning id into v_other_org;
  insert into public.organization_membership (
    organization_id, user_id, role, status
  ) values (v_other_org, v_guest, 'guest', 'active');
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_guest;
  perform tests.authenticate(v_owner, 'aal2');
  begin
    perform public.add_team_member(v_team, v_guest);
    raise exception 'FAIL: foreign/inactive team target was accepted';
  exception when check_violation then
    perform tests.ok(true, 'foreign or inactive team targets are rejected');
  end;
  reset role;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_guest;

  -- An invalid owner makes the whole RPC fail; neither team nor channel may
  -- survive the failed statement.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_guest;
  perform tests.authenticate(v_owner, 'aal2');
  begin
    perform public.create_team_with_channel('Must roll back', null, v_guest);
    raise exception 'FAIL: team was created for an inactive owner';
  exception when check_violation then
    perform tests.ok(true, 'inactive team owners are rejected');
  end;
  reset role;
  select count(*) into n from public.team
  where organization_id = v_org and name = 'Must roll back';
  perform tests.ok(n = 0, 'failed team creation leaves no partial team');
  select count(*) into n from public.channel
  where organization_id = v_org and name = 'Must roll back';
  perform tests.ok(n = 0, 'failed team creation leaves no orphan channel');
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_guest;

  -- Team assignments materialize scoped grant provenance for current and
  -- future members, and their removal preserves independent direct access.
  perform tests.authenticate(v_owner, 'aal2');
  insert into public.program_team_assignment (
    organization_id, program_id, team_id, role, created_by
  ) values (v_org, v_program, v_team, 'contributor', v_owner);
  insert into public.project_team_assignment (
    organization_id, project_id, team_id, role, created_by
  ) values (v_org, v_project, v_team, 'reviewer', v_owner);
  reset role;
  perform tests.ok(
    exists (
      select 1 from public.program_access_grant
      where program_id = v_program and user_id = v_volunteer
        and source = 'team' and source_team_id = v_team and role = 'contributor'
    ) and exists (
      select 1 from public.project_access_grant
      where project_id = v_project and user_id = v_volunteer
        and source = 'team' and source_team_id = v_team and role = 'reviewer'
    ),
    'team assignment grants current members typed program and project access'
  );

  perform tests.authenticate(v_owner, 'aal2');
  perform public.add_team_member(v_team, v_guest);
  reset role;
  perform tests.ok(
    exists (
      select 1 from public.program_access_grant
      where program_id = v_program and user_id = v_guest
        and source = 'team' and source_team_id = v_team
    ) and exists (
      select 1 from public.project_access_grant
      where project_id = v_project and user_id = v_guest
        and source = 'team' and source_team_id = v_team
    ),
    'future team members receive every current team assignment'
  );

  perform tests.authenticate(v_owner, 'aal2');
  perform public.remove_team_member(v_team, v_guest);
  perform public.set_project_direct_access(v_project, v_volunteer, 'read_only');
  delete from public.project_team_assignment
  where project_id = v_project and team_id = v_team;
  update public.program_team_assignment set role = 'reviewer'
  where program_id = v_program and team_id = v_team;
  reset role;
  perform tests.ok(
    not exists (
      select 1 from public.program_access_grant
      where program_id = v_program and user_id = v_guest
        and source = 'team' and source_team_id = v_team
    ) and not exists (
      select 1 from public.project_access_grant
      where project_id = v_project and user_id = v_guest
        and source = 'team' and source_team_id = v_team
    ),
    'team removal revokes all assignment-derived sources for that member'
  );
  perform tests.ok(
    exists (
      select 1 from public.project_access_grant
      where project_id = v_project and user_id = v_volunteer and source = 'direct'
    ) and not exists (
      select 1 from public.project_access_grant
      where project_id = v_project and user_id = v_volunteer
        and source = 'team' and source_team_id = v_team
    ),
    'unassigning a team preserves independent direct project access'
  );
  perform tests.ok(
    exists (
      select 1 from public.program_access_grant
      where program_id = v_program and user_id = v_volunteer
        and source = 'team' and source_team_id = v_team and role = 'reviewer'
    ),
    'changing a team assignment updates its existing typed grants'
  );
  select count(*) into n from public.audit_event
  where object_id in (v_program, v_project) and action = 'team_assigned';
  perform tests.ok(n = 2, 'program and project team assignments are auditable');

  insert into public.program (organization_id, name, slug, created_by)
  values (
    v_other_org, 'Foreign team program',
    'foreign-team-program-' || left(gen_random_uuid()::text, 8), v_owner
  ) returning id into v_foreign_program;
  perform tests.authenticate(v_owner, 'aal2');
  begin
    insert into public.program_team_assignment (
      organization_id, program_id, team_id, role
    ) values (v_org, v_foreign_program, v_team, 'contributor');
    raise exception 'FAIL: cross-organization team assignment was accepted';
  exception when insufficient_privilege or foreign_key_violation then
    perform tests.ok(true, 'cross-organization team assignments are rejected');
  end;
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  begin
    perform public.transfer_team_ownership(v_team, v_volunteer);
    raise exception 'FAIL: AAL1 administrator transferred team ownership';
  exception when insufficient_privilege then
    perform tests.ok(true, 'AAL1 administrators cannot transfer team ownership');
  end;
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  begin
    update public.team set owner_id = v_volunteer where id = v_team;
    raise exception 'FAIL: direct update bypassed the team ownership command';
  exception when insufficient_privilege then
    perform tests.ok(true, 'direct team ownership updates are rejected');
  end;
  perform tests.ok(
    public.transfer_team_ownership(v_team, v_volunteer),
    'AAL2 administrator transfers team ownership atomically'
  );
  reset role;
  perform tests.ok(
    (select owner_id = v_volunteer from public.team where id = v_team)
      and (select owner_id = v_volunteer from public.channel where id = v_channel)
      and exists (
        select 1 from public.channel_access_grant
        where channel_id = v_channel and user_id = v_volunteer
          and source = 'team' and role = 'manager'
      )
      and exists (
        select 1 from public.channel_access_grant
        where channel_id = v_channel and user_id = v_owner
          and source = 'team' and role = 'member'
      ),
    'ownership transfer synchronizes the team channel without removing the previous member'
  );
  perform tests.ok(
    (select count(*) from public.audit_event
      where object_id = v_team and action = 'team_ownership_transferred'
        and actor_id = v_owner
        and (metadata->>'to_user_id')::uuid = v_volunteer) = 1,
    'team ownership transfer records an attributable audit event'
  );
  perform tests.authenticate(v_owner, 'aal2');
  perform public.transfer_team_ownership(v_team, v_owner);
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  begin
    perform public.remove_team_member(v_team, v_owner);
    raise exception 'FAIL: team owner was removed from their team';
  exception when check_violation then
    perform tests.ok(true, 'team owners cannot be removed before ownership transfer');
  end;
  reset role;

  select id into strict v_mandatory from public.channel
  where organization_id = v_org and is_mandatory order by created_at limit 1;
  perform tests.authenticate(v_owner, 'aal2');
  perform public.add_channel_member(v_mandatory, v_owner);
  begin
    perform public.leave_channel(v_mandatory);
    raise exception 'FAIL: mandatory channel access was self-revoked';
  exception when insufficient_privilege then
    perform tests.ok(true, 'mandatory access survives an independent direct grant');
  end;
  reset role;
  perform tests.ok(
    exists (
      select 1 from public.channel_access_grant
      where channel_id = v_mandatory and user_id = v_owner and source = 'mandatory'
    ),
    'mandatory provenance remains authoritative'
  );
end;
$$;

rollback;
