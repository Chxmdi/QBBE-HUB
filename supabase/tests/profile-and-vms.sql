-- A person corrects their own name and title and display choices, never their
-- email or volunteer-system identity. Administrators (with MFA) correct a
-- member's name and title and link or unlink their volunteer-system identity
-- through audited functions, and unlinking or disconnecting the volunteer
-- system removes the copied assignment records.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  volunteer_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  other_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  org uuid;
  refused boolean;
  n int;
  r record;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  perform tests.ensure_verified_mfa_factor(admin_user);
  perform tests.ensure_verified_mfa_factor(owner_user);
  update public.user_profile set vms_id = 'vms-other' where id = other_volunteer;
  insert into public.vms_assignment_reference (organization_id, user_id, external_assignment_id, title, status)
  values (org, other_volunteer, 'ext-1', 'PV shift', 'confirmed');

  -- Own profile.
  perform tests.authenticate(volunteer_user, 'aal1');
  set local role authenticated;
  for r in select * from (values ('email'), ('vms_id'), ('vms_availability'), ('created_at')) as t(col) loop
    refused := false;
    begin
      execute format('update public.user_profile set %I = %L where id = %L', r.col,
        case r.col when 'email' then 'ceo@qbbe.example' when 'vms_id' then 'vms-other'
                   when 'vms_availability' then 'available' else '2020-01-01' end,
        volunteer_user);
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('a person cannot change their own %s', r.col));
  end loop;
  update public.user_profile set full_name = 'PV Volunteer Renamed', title = 'Mentor' where id = volunteer_user;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a person can correct their own name and title');
  update public.user_profile set full_name = 'Hijacked' where id = staff_user;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a person cannot rename someone else');

  refused := false;
  begin
    perform public.rectify_member_profile(org, staff_user, 'Hijacked', null);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a non-administrator cannot rectify someone''s profile');
  refused := false;
  begin
    perform public.link_vms_identity(org, volunteer_user, 'vms-mine');
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a non-administrator cannot link a volunteer-system identity');

  -- An administrator without MFA cannot either.
  reset role;
  perform tests.authenticate(admin_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    perform public.rectify_member_profile(org, staff_user, 'Renamed', null);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an administrator without MFA cannot rectify a profile');

  -- An administrator with MFA.
  reset role;
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  perform public.rectify_member_profile(org, staff_user, 'QA Staff (corrected)', 'Coordinator');
  reset role;
  select full_name, title into r from public.user_profile where id = staff_user;
  perform tests.ok(r.full_name = 'QA Staff (corrected)' and r.title = 'Coordinator', 'an administrator rectifies a member''s name and title');
  select count(*) into n from public.audit_event
  where object_id = staff_user and action = 'profile_rectified' and actor_id = admin_user;
  perform tests.ok(n = 1, 'the rectification is audited');

  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  perform public.link_vms_identity(org, volunteer_user, 'vms-mine');
  refused := false;
  begin
    perform public.link_vms_identity(org, staff_user, 'vms-other');
  exception when unique_violation then refused := true;
  end;
  perform tests.ok(refused, 'a volunteer-system identity already linked to someone cannot be linked again');
  perform public.link_vms_identity(org, other_volunteer, '');
  reset role;
  select vms_id into r from public.user_profile where id = volunteer_user;
  perform tests.ok(r.vms_id = 'vms-mine', 'an administrator links a volunteer-system identity');
  select count(*) into n from public.vms_assignment_reference where user_id = other_volunteer;
  perform tests.ok(n = 0, 'unlinking removes the person''s copied assignments');
  select count(*) into n from public.audit_event
  where action in ('vms_identity_linked', 'vms_identity_unlinked') and actor_id = admin_user;
  perform tests.ok(n = 2, 'linking and unlinking are audited');

  -- A person who also belongs to an organization this administrator does not
  -- administer keeps their shared profile.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.organization (id, name, slug) values ('cccccccc-0000-4000-8000-0000000000b2', 'PV other org', 'pv-other-org');
  insert into public.organization_membership (organization_id, user_id, role, status)
  values ('cccccccc-0000-4000-8000-0000000000b2', staff_user, 'volunteer', 'active');
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  refused := false;
  begin
    perform public.rectify_member_profile(org, staff_user, 'Renamed elsewhere', null);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an administrator cannot change the shared profile of someone in an organization they do not administer');
  refused := false;
  begin
    perform public.link_vms_identity('cccccccc-0000-4000-8000-0000000000b2', staff_user, 'vms-x');
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an administrator cannot act from an organization they do not administer');
  reset role;
  delete from public.organization_membership where organization_id = 'cccccccc-0000-4000-8000-0000000000b2';
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;

  refused := false;
  begin
    update public.user_profile set avatar_url = 'javascript:alert(1)' where id = admin_user;
  exception when check_violation then refused := true;
  end;
  perform tests.ok(refused, 'a profile photo address must be https or in-app');
  refused := false;
  begin
    update public.user_profile set full_name = '  ' where id = admin_user;
  exception when check_violation then refused := true;
  end;
  perform tests.ok(refused, 'a profile name cannot be blank');

  -- Disconnecting the volunteer system.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.vms_assignment_reference (organization_id, user_id, external_assignment_id, title, status)
  values (org, volunteer_user, 'ext-2', 'PV shift 2', 'confirmed');
  perform tests.authenticate(owner_user, 'aal2');
  set local role authenticated;
  perform public.clear_org_vms_ids(org);
  reset role;
  select count(*) into n from public.vms_assignment_reference where organization_id = org;
  perform tests.ok(n = 0, 'disconnecting the volunteer system removes every copied assignment');
  select count(*) into n from public.user_profile where id = volunteer_user and vms_id is not null;
  perform tests.ok(n = 0, 'and every link');
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
