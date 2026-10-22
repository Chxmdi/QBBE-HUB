-- "Staff and admins only" means that on every route: a volunteer or guest on
-- the same project cannot open it, other staff can, and an owner or admin
-- needs a completed MFA sign-in. File downloads (the storage policy) and
-- search (search_library) use the same check, app.can_read_document.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  volunteer_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  guest_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  lead_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  org uuid;
  v_project uuid;
  staff_in_project uuid;
  staff_unscoped uuid;
  org_in_project uuid;
  generated uuid;
  refused boolean;
  private_in_project uuid;
  n int;
  bad_visibility text;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  perform tests.ensure_verified_mfa_factor(admin_user);

  insert into public.project (organization_id, name, owner_id, created_by)
  values (org, 'Staff visibility project', owner_user, owner_user) returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (org, v_project, volunteer_user, 'read_only', 'direct', owner_user),
         (org, v_project, guest_user, 'read_only', 'direct', owner_user),
         (org, v_project, staff_user, 'contributor', 'direct', owner_user),
         (org, v_project, lead_user, 'read_only', 'direct', owner_user);

  insert into public.document (organization_id, title, kind, url, project_id, visibility, owner_id, created_by)
  values (org, 'SV payroll grid in project', 'link', 'https://drive.google.com/sv-a', v_project, 'staff', staff_user, staff_user)
  returning id into staff_in_project;
  insert into public.document (organization_id, title, kind, url, visibility, owner_id, created_by)
  values (org, 'SV board minutes unscoped', 'link', 'https://drive.google.com/sv-b', 'staff', staff_user, staff_user)
  returning id into staff_unscoped;
  insert into public.document (organization_id, title, kind, url, project_id, visibility, owner_id, created_by)
  values (org, 'SV project plan', 'link', 'https://drive.google.com/sv-c', v_project, 'organization', staff_user, staff_user)
  returning id into org_in_project;
  insert into public.document (organization_id, title, kind, url, project_id, visibility, owner_id, created_by)
  values (org, 'SV drive import', 'link', 'https://drive.google.com/sv-d', v_project, 'private', staff_user, staff_user)
  returning id into private_in_project;

  -- Volunteer and guest on the project.
  perform tests.authenticate(volunteer_user, 'aal1');
  set local role authenticated;
  select count(*) into n from public.document where id in (staff_in_project, staff_unscoped);
  perform tests.ok(n = 0, 'a volunteer on the project cannot see its staff-only documents');
  select count(*) into n from public.document where id = org_in_project;
  perform tests.ok(n = 1, 'a volunteer on the project still sees its ordinary documents');
  select count(*) into n from public.document where id = private_in_project;
  perform tests.ok(n = 0, 'a volunteer on the project cannot see someone''s private import');
  select count(*) into n from public.search_library('SV', false, false, 50) s where s.id in (staff_in_project, staff_unscoped);
  perform tests.ok(n = 0, 'search does not show a volunteer staff-only documents');

  reset role;
  perform tests.authenticate(guest_user, 'aal1');
  set local role authenticated;
  select count(*) into n from public.document where id in (staff_in_project, staff_unscoped, private_in_project);
  perform tests.ok(n = 0, 'a guest on the project cannot see staff-only or private documents');

  -- Another staff member, not the creator.
  reset role;
  perform tests.authenticate(lead_user, 'aal1');
  set local role authenticated;
  select count(*) into n from public.document where id in (staff_in_project, staff_unscoped);
  perform tests.ok(n = 2, 'other staff can read staff-only documents, scoped or not');
  select count(*) into n from public.document where id = private_in_project;
  perform tests.ok(n = 0, 'other staff cannot read someone''s private import');

  -- An administrator, before and after MFA.
  reset role;
  perform tests.authenticate(admin_user, 'aal1');
  set local role authenticated;
  select count(*) into n from public.document where id in (staff_in_project, staff_unscoped);
  perform tests.ok(n = 0, 'an administrator without a completed MFA sign-in cannot read staff-only documents');
  reset role;
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  select count(*) into n from public.document where id in (staff_in_project, staff_unscoped);
  perform tests.ok(n = 2, 'an administrator with MFA reads staff-only documents');

  -- The creator keeps access.
  reset role;
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  select count(*) into n from public.document where id in (staff_in_project, staff_unscoped, private_in_project);
  perform tests.ok(n = 3, 'the creator reads their own documents');

  -- Staff file a staff-only library document themselves, as generating a
  -- letter from a template does (insert, then read back the id).
  insert into public.document (organization_id, title, kind, url, visibility, owner_id, created_by)
  values (org, 'SV generated letter', 'link', 'https://drive.google.com/sv-g', 'staff', staff_user, staff_user)
  returning id into generated;
  perform tests.ok(generated is not null, 'staff can file a staff-only library document');

  reset role;
  perform tests.authenticate(volunteer_user, 'aal1');
  set local role authenticated;
  select count(*) into n from public.document where id = generated;
  perform tests.ok(n = 0, 'a volunteer cannot see a generated staff-only letter');
  refused := false;
  begin
    insert into public.document (organization_id, title, kind, url, visibility, owner_id, created_by)
    values (org, 'SV volunteer staff-only', 'link', 'https://drive.google.com/sv-v', 'staff', volunteer_user, volunteer_user);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a volunteer cannot file a staff-only document');

  -- A creator who stops being staff loses staff-only access and cannot
  -- reopen the document by widening it.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  update public.organization_membership set role = 'volunteer'
  where user_id = staff_user and organization_id = org;
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  select count(*) into n from public.document where id in (staff_unscoped, generated);
  perform tests.ok(n = 0, 'a creator who is no longer staff cannot see their staff-only documents');
  refused := false;
  begin
    update public.document set visibility = 'organization' where id = staff_unscoped;
    get diagnostics n = row_count;
    refused := n = 0;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a creator who is no longer staff cannot widen a staff-only document');
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select visibility into bad_visibility from public.document where id = staff_unscoped;
  perform tests.ok(bad_visibility = 'staff', 'the document stays staff-only');
  update public.organization_membership set role = 'staff'
  where user_id = staff_user and organization_id = org;

  begin
    insert into public.document (organization_id, title, kind, url, visibility, owner_id, created_by)
    values (org, 'SV bad visibility', 'link', 'https://drive.google.com/sv-e', 'everyone', staff_user, staff_user);
    perform tests.ok(false, 'an unknown visibility is refused');
  exception when check_violation then
    perform tests.ok(true, 'an unknown visibility is refused');
  end;
end;
$$;
rollback;
