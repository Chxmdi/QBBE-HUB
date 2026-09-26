-- Document library (#147, migration 20260927600000): folders with per-folder
-- visibility, tags, versions and required reading.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_other_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_open_folder uuid;
  v_staff_folder uuid;
  v_new_folder uuid;
  v_hr_doc uuid;
  v_policy_v1 uuid;
  v_policy_v2 uuid;
  v_policy_v3 uuid;
  v_row public.document;
  v_tags text[];
  v_ack timestamptz;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_staff limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org
    and user_id in (v_owner, v_staff, v_volunteer, v_admin, v_other_staff);

  select id into strict v_open_folder from public.document_folder
   where organization_id = v_org and category = 'governance' and name = 'Policies';
  select id into strict v_staff_folder from public.document_folder
   where organization_id = v_org and category = 'hr' and name = 'Personnel';

  -- Folders ------------------------------------------------------------------
  select count(*) into n from public.document_folder where organization_id = v_org;
  perform tests.ok(n >= 6, 'every organization starts with the default library folders');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.document_folder where id = v_staff_folder;
  perform tests.ok(n = 0, 'a volunteer does not see a staff-only folder');
  select count(*) into n from public.document_folder where id = v_open_folder;
  perform tests.ok(n = 1, 'a volunteer sees an open folder');
  begin
    insert into public.document_folder (organization_id, category, name, created_by)
    values (v_org, 'finance', 'Volunteer folder', v_volunteer);
    raise exception 'FAIL: a volunteer created a folder';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a volunteer cannot create a folder');

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into n from public.document_folder where id = v_staff_folder;
  perform tests.ok(n = 1, 'staff see a staff-only folder');
  begin
    insert into public.document_folder (organization_id, category, name, created_by)
    values (v_org, 'finance', 'Staff folder', v_staff);
    raise exception 'FAIL: a staff member created a folder';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'folder structure is an administrator decision, not staff');

  perform tests.authenticate(v_admin, 'aal1');
  begin
    insert into public.document_folder (organization_id, category, name, created_by)
    values (v_org, 'finance', 'Without MFA', v_admin);
    raise exception 'FAIL: an administrator without MFA created a folder';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'an administrator must have completed MFA to create a folder');

  perform tests.authenticate(v_admin, 'aal2');
  insert into public.document_folder (organization_id, category, name, visibility, created_by)
  values (v_org, 'finance', 'Grant reports', 'organization', v_admin)
  returning id into v_new_folder;
  perform tests.ok(v_new_folder is not null, 'an administrator with MFA creates a folder');
  begin
    insert into public.document_folder (organization_id, category, name, created_by)
    values (v_org, 'finance', ' grant REPORTS ', v_admin);
    raise exception 'FAIL: a duplicate folder name was accepted';
  exception when unique_violation then null; end;
  perform tests.ok(true, 'folder names are unique within a category, ignoring case and spacing');

  -- Per-folder visibility ---------------------------------------------------
  perform tests.authenticate(v_volunteer, 'aal1');
  begin
    insert into public.document (organization_id, title, kind, url, folder_id, owner_id, created_by)
    values (v_org, 'Volunteer HR note', 'link', 'https://drive.google.com/file/d/v/view',
            v_staff_folder, v_volunteer, v_volunteer);
    raise exception 'FAIL: a volunteer filed into a staff folder';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a volunteer cannot file into a staff-only folder');

  perform tests.authenticate(v_staff, 'aal1');
  insert into public.document (organization_id, title, kind, url, folder_id, owner_id, created_by)
  values (v_org, 'Staff handbook', 'link', 'https://drive.google.com/file/d/hr/view',
          v_staff_folder, v_staff, v_staff)
  returning id into v_hr_doc;
  perform tests.ok(v_hr_doc is not null, 'staff file an organization-visible document into a staff folder');

  perform tests.authenticate(v_other_staff, 'aal1');
  select count(*) into n from public.document where id = v_hr_doc;
  perform tests.ok(n = 1, 'other staff can read a document in a staff folder');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.document where id = v_hr_doc;
  perform tests.ok(n = 0, 'a volunteer cannot read a document filed in a staff folder');


  -- Tags and search text ----------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.document (organization_id, title, description, kind, url, folder_id,
                               tags, owner_id, created_by)
  values (v_org, 'Code of conduct', 'Applies to everyone', 'link',
          'https://drive.google.com/file/d/coc1/view', v_open_folder,
          array[' Policy ', 'policy', 'CONDUCT', ''], v_staff, v_staff)
  returning id into v_policy_v1;
  select tags into v_tags from public.document where id = v_policy_v1;
  perform tests.ok(v_tags = array['policy', 'conduct'],
    'tags are trimmed, lower-cased, de-duplicated and blanks dropped');
  select count(*) into n from public.document
   where id = v_policy_v1 and search_text like '%conduct%' and search_text like '%everyone%';
  perform tests.ok(n = 1, 'search text covers title, description and tags');

  begin
    update public.document
       set tags = array['a','b','c','d','e','f','g','h','i','j','k','l','m']
     where id = v_policy_v1;
    raise exception 'FAIL: thirteen tags were accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a document is limited to twelve tags');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.document where id = v_policy_v1;
  perform tests.ok(n = 1, 'a volunteer can read a document in an open folder');

  -- Required reading --------------------------------------------------------
  begin
    update public.document set requires_acknowledgement = true where id = v_policy_v1;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL: a volunteer marked required reading'; end if;
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a volunteer cannot mark a document as required reading');

  perform tests.authenticate(v_staff, 'aal1');
  update public.document set requires_acknowledgement = true where id = v_policy_v1;
  select * into strict v_row from public.document where id = v_policy_v1;
  perform tests.ok(v_row.requires_acknowledgement, 'staff mark a policy as required reading');

  begin
    update public.document set visibility = 'staff' where id = v_policy_v1;
    raise exception 'FAIL: required reading was made restricted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'required reading stays open to its folder''s audience');

  perform tests.authenticate(v_volunteer, 'aal1');
  begin
    insert into public.document_acknowledgement (document_id, user_id, organization_id)
    values (v_policy_v1, v_staff, v_org);
    raise exception 'FAIL: a volunteer confirmed on someone else''s behalf';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'nobody can confirm reading on someone else''s behalf');

  insert into public.document_acknowledgement (document_id, user_id, organization_id, acknowledged_at)
  values (v_policy_v1, v_volunteer, v_org, '2000-01-01');
  select acknowledged_at into v_ack from public.document_acknowledgement
   where document_id = v_policy_v1 and user_id = v_volunteer;
  perform tests.ok(v_ack > now() - interval '1 minute',
    'a member confirms reading, and the time is the server''s, not the caller''s');

  begin
    insert into public.document_acknowledgement (document_id, user_id, organization_id)
    values (v_hr_doc, v_volunteer, v_org);
    raise exception 'FAIL: acknowledged a document that is not required reading';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'only required reading can be confirmed');

  begin
    perform * from public.document_acknowledgement_status(v_policy_v1);
    raise exception 'FAIL: a volunteer read the acknowledgement report';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a volunteer cannot see who has read a document');

  perform tests.authenticate(v_staff, 'aal1');
  begin
    perform * from public.document_acknowledgement_status(v_policy_v1);
    raise exception 'FAIL: staff read the acknowledgement report';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'staff cannot see who has read a document');
  select count(*) into n from public.document_acknowledgement where document_id = v_policy_v1;
  perform tests.ok(n = 0, 'staff cannot read other people''s confirmations directly');

  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into n from public.document_acknowledgement_status(v_policy_v1)
   where user_id = v_volunteer and acknowledged_at is not null;
  perform tests.ok(n = 1, 'an administrator sees who has confirmed');
  select count(*) into n from public.document_acknowledgement_status(v_policy_v1)
   where user_id = v_staff and acknowledged_at is null;
  perform tests.ok(n = 1, 'an administrator sees who has not confirmed');

  -- Versions ----------------------------------------------------------------
  perform tests.authenticate(v_volunteer, 'aal1');
  begin
    insert into public.document (organization_id, title, kind, url, supersedes_id, owner_id, created_by)
    values (v_org, 'Code of conduct', 'link', 'https://drive.google.com/file/d/coc-x/view',
            v_policy_v1, v_volunteer, v_volunteer);
    raise exception 'FAIL: a volunteer replaced someone else''s document';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'only someone who manages a document can add a version');

  perform tests.authenticate(v_staff, 'aal1');
  insert into public.document (organization_id, title, kind, url, supersedes_id,
                               series_id, version_number, folder_id, owner_id, created_by)
  values (v_org, 'Code of conduct', 'link', 'https://drive.google.com/file/d/coc2/view',
          v_policy_v1, gen_random_uuid(), 99, v_new_folder, v_staff, v_staff)
  returning id into v_policy_v2;
  select * into strict v_row from public.document where id = v_policy_v2;
  perform tests.ok(v_row.series_id = v_policy_v1 and v_row.version_number = 2,
    'a new version joins its series as version 2, whatever the caller claimed');
  perform tests.ok(v_row.folder_id = v_open_folder and v_row.requires_acknowledgement
    and v_row.tags = array['policy', 'conduct'],
    'a new version keeps its predecessor''s folder, tags and required-reading flag');
  select * into strict v_row from public.document where id = v_policy_v1;
  perform tests.ok(v_row.superseded_at is not null, 'the previous version is marked superseded');
  select count(*) into n from public.document
   where series_id = v_policy_v1 and superseded_at is null;
  perform tests.ok(n = 1, 'exactly one version of a document is current');

  begin
    insert into public.document (organization_id, title, kind, url, supersedes_id, owner_id, created_by)
    values (v_org, 'Fork', 'link', 'https://drive.google.com/file/d/fork/view',
            v_policy_v1, v_staff, v_staff);
    raise exception 'FAIL: an old version was replaced a second time';
  exception when check_violation then null; end;
  perform tests.ok(true, 'only the current version can be replaced, so history never forks');

  begin
    update public.document set superseded_at = null where id = v_policy_v1;
    raise exception 'FAIL: version history was edited by a client';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'version history cannot be edited by a client');

  begin
    update public.document set folder_id = v_new_folder where id = v_policy_v1;
    raise exception 'FAIL: an earlier version was moved on its own';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'an earlier version cannot be moved away from its current version');

  -- Confirmations are per version: the new version asks again.
  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.document where id = v_policy_v1;
  perform tests.ok(n = 1, 'earlier versions stay readable to the same audience');
  begin
    insert into public.document_acknowledgement (document_id, user_id, organization_id)
    values (v_policy_v1, v_volunteer, v_org);
    raise exception 'FAIL: confirmed an out-of-date version';
  exception when insufficient_privilege or unique_violation then null; end;
  perform tests.ok(true, 'an out-of-date version cannot be confirmed');
  insert into public.document_acknowledgement (document_id, user_id, organization_id)
  values (v_policy_v2, v_volunteer, v_org);
  perform tests.ok(true, 'the current version can be confirmed again');

  -- Moving the current version moves the whole series.
  perform tests.authenticate(v_staff, 'aal1');
  update public.document set requires_acknowledgement = false where id = v_policy_v2;
  update public.document set folder_id = v_staff_folder where id = v_policy_v2;
  select count(*) into n from public.document
   where series_id = v_policy_v1 and folder_id = v_staff_folder;
  perform tests.ok(n = 2, 'moving the current version moves every earlier version with it');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.document where series_id = v_policy_v1;
  perform tests.ok(n = 0,
    'moving a document into a staff folder hides every version of it from a volunteer');

  -- Removing the current version makes the previous one current again.
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.document (organization_id, title, kind, url, supersedes_id, owner_id, created_by)
  values (v_org, 'Code of conduct', 'link', 'https://drive.google.com/file/d/coc3/view',
          v_policy_v2, v_staff, v_staff)
  returning id into v_policy_v3;
  delete from public.document where id = v_policy_v3;
  select * into strict v_row from public.document where id = v_policy_v2;
  perform tests.ok(v_row.superseded_at is null,
    'deleting the current version makes the one before it current again');

  -- Audit -------------------------------------------------------------------
  perform tests.clear_auth();
  reset role;
  select count(*) into n from public.audit_event
   where object_id = v_policy_v2 and action = 'document_version_added';
  perform tests.ok(n = 1, 'adding a version is audited');
  select count(*) into n from public.audit_event
   where object_id = v_policy_v1 and action = 'document_acknowledged' and actor_id = v_volunteer;
  perform tests.ok(n = 1, 'a reading confirmation is audited with who confirmed');
  select count(*) into n from public.audit_event
   where object_id = v_policy_v1 and action = 'document_required_reading_set';
  perform tests.ok(n = 1, 'marking required reading is audited');
  select count(*) into n from public.audit_event
   where object_id = v_policy_v2 and action = 'document_filed';
  perform tests.ok(n = 1, 'moving a document between folders is audited');
  select count(*) into n from public.audit_event
   where object_id = v_new_folder and action = 'document_folder_created';
  perform tests.ok(n = 1, 'creating a folder is audited');

  -- Exposure ----------------------------------------------------------------
  perform tests.ok(not has_function_privilege('anon',
    'public.document_acknowledgement_status(uuid)', 'execute'),
    'the acknowledgement report is not callable anonymously');
  perform tests.ok(not has_function_privilege('authenticated',
    'app.seed_document_folders(uuid)', 'execute'),
    'folder seeding is not callable by clients');
end;
$$;

rollback;
