-- Workspace OS upkeep reports (V3-2, migration 20261106110500): each report
-- shows only what the person asking can already open, owners review their own
-- stale pages, and reviews are a record nobody edits. Roles: owner, admin,
-- staff, volunteer, guest, signed-out (org_role has no separate "member" or
-- "accountant"). Run after qa-users.sql and rls.sql. All mutations roll back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_stale uuid;
  v_link uuid;
  v_archived_project uuid;
  v_live_project uuid;
  v_task_in_archived uuid;
  v_orphan uuid;
  v_type uuid;
  v_ok boolean;
  v_n integer;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_admin, v_guest);

  -- Fixtures go through the normal triggers; only the backdating and the
  -- now-unapproved link are written with triggers off afterwards.
  insert into public.document (organization_id, title, kind, url, owner_id, visibility)
  values (v_org, 'Old staff handbook', 'link', 'https://drive.google.com/file/d/abc', v_staff, 'staff')
  returning id into v_stale;
  insert into public.document (organization_id, title, kind, url, owner_id, visibility)
  values (v_org, 'Link to a retired site', 'link', 'https://drive.google.com/file/d/retired', v_owner, 'staff')
  returning id into v_link;
  insert into public.project (organization_id, name, created_by)
  values (v_org, 'Closed project', v_owner) returning id into v_archived_project;
  insert into public.project (organization_id, name, created_by)
  values (v_org, 'Live project', v_owner) returning id into v_live_project;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_archived_project, 'Still open in a closed project', v_owner) returning id into v_task_in_archived;
  insert into public.task (organization_id, title, created_by)
  values (v_org, 'Nobody owns this', v_owner) returning id into v_orphan;
  insert into public.task (organization_id, project_id, title, created_by) values
    (v_org, v_live_project, 'Book the venue', v_owner),
    (v_org, v_live_project, 'book the  venue!', v_owner);
  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_org, 'upkeep_test_type', 'Unused type', 'Type inutilisé', 'custom') returning id into v_type;
  insert into public.saved_view (organization_id, user_id, name, query)
  values (v_org, v_owner, 'Closed project view', jsonb_build_object('project', v_archived_project));
  update public.project set archived_at = now() where id = v_archived_project;

  set local session_replication_role = replica;
  update public.document set updated_at = now() - interval '400 days', created_at = now() - interval '400 days'
  where id = v_stale;
  update public.document set url = 'https://retired.example.org/page' where id = v_link;
  update public.task set created_at = now() - interval '60 days' where id = v_orphan;
  set local session_replication_role = origin;

  -- ---------------------------------------------------------- stale pages
  perform tests.authenticate(v_owner);
  select count(*) into v_n from public.upkeep_stale_pages(180) where object_id = v_stale;
  perform tests.ok(v_n = 1, 'the owner sees a page nobody touched for over 180 days, with its owner');
  select count(*) into v_n from public.upkeep_stale_pages(500) where object_id = v_stale;
  perform tests.ok(v_n = 0, 'a longer threshold leaves it out');
  reset role;

  for r in select * from (values (v_volunteer, 'a volunteer'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    select count(*) into v_n from public.upkeep_stale_pages(180) where object_id = v_stale;
    reset role;
    perform tests.ok(v_n = 0, format('%s does not see a staff-only page in the report', r.who));
  end loop;

  for r in select * from (values (v_volunteer, 'a volunteer'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    begin
      insert into public.upkeep_review (organization_id, object_type, object_id, decision)
      values (v_org, 'document', v_stale, 'current');
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    reset role;
    perform tests.ok(v_ok, format('%s cannot review someone else''s page', r.who));
  end loop;

  perform tests.authenticate(v_staff);
  insert into public.upkeep_review (organization_id, object_type, object_id, decision, note)
  values (v_org, 'document', v_stale, 'current', 'Checked, still right');
  select count(*) into v_n from public.upkeep_stale_pages(180) where object_id = v_stale;
  perform tests.ok(v_n = 0, 'the page''s owner marks it current, which resets the clock');
  begin
    update public.upkeep_review set decision = 'archive' where object_id = v_stale;
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a review cannot be changed afterwards');
  begin
    delete from public.upkeep_review where object_id = v_stale;
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a review cannot be deleted');
  reset role;

  perform tests.authenticate(v_admin);
  insert into public.upkeep_review (organization_id, object_type, object_id, decision)
  values (v_org, 'document', v_stale, 'archive');
  perform tests.ok(true, 'an admin with MFA reviews any page');
  select count(*) into v_n from public.upkeep_review where object_id = v_stale;
  perform tests.ok(v_n = 2, 'staff and above read the reviews');
  reset role;

  perform tests.authenticate(v_volunteer);
  select count(*) into v_n from public.upkeep_review where object_id = v_stale;
  perform tests.ok(v_n = 0, 'a volunteer does not read other people''s reviews');
  reset role;

  -- ---------------------------------------------------------- broken links and orphans
  perform tests.authenticate(v_owner);
  select count(*) into v_n from public.upkeep_broken_links() where object_id = v_link and issue = 'unapproved_host';
  perform tests.ok(v_n = 1, 'a link whose host is no longer approved is reported');
  select count(*) into v_n from public.upkeep_broken_links() where object_id = v_stale;
  perform tests.ok(v_n = 0, 'a link to an approved host is not');
  select count(*) into v_n from public.upkeep_broken_links() where object_id = v_task_in_archived and issue = 'archived_project';
  perform tests.ok(v_n = 1, 'open work in an archived project is reported');
  select count(*) into v_n from public.upkeep_orphans(30) where object_id = v_orphan;
  perform tests.ok(v_n = 1, 'an old task with no project, program or assignee is reported');

  -- ---------------------------------------------------------- duplicates and unused
  select count(*) into v_n from public.upkeep_duplicates()
  where object_type = 'task' and match_key = 'book the venue' and cardinality(object_ids) = 2;
  perform tests.ok(v_n = 1, 'tasks whose titles differ only in case and punctuation are possible duplicates');
  select count(*) into v_n from public.upkeep_unused() where object_id = v_type;
  perform tests.ok(v_n = 1, 'a custom type with no objects is reported unused');
  select count(*) into v_n from public.upkeep_unused() where issue = 'view_for_missing_project';
  perform tests.ok(v_n = 1, 'a saved view for an archived project is reported');
  reset role;

  perform tests.authenticate(v_staff);
  select count(*) into v_n from public.upkeep_unused() where issue = 'view_for_missing_project';
  perform tests.ok(v_n = 0, 'someone else''s saved views stay private');
  reset role;

  -- ---------------------------------------------------------- signed out
  perform tests.clear_auth();
  begin
    perform public.upkeep_stale_pages(180);
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor cannot run the reports');
  begin
    select count(*) into v_n from public.upkeep_review;
    v_ok := v_n = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor reads no reviews');
  reset role;
end;
$$;

rollback;
