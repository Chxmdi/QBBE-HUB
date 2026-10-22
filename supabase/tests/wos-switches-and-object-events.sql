-- Workspace OS modules switched off are off at the database: their tables
-- and calls answer nothing to signed-in people, classic search shows no
-- switched-off pages, and the object event copy neither records while off nor
-- keeps a deleted contact's details. Run after qa-users.sql and rls.sql.
-- Rolled back. test-db.mjs turns every module on for the suite; this file
-- turns them off inside its own transaction.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_task uuid;
  v_contact uuid;
  v_page uuid;
  v_before bigint;
  n integer;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;

  -- Every module off: no override, every Workspace OS row off.
  delete from app.workspace_os_override;
  update feature_flag set enabled = false where key like 'wos\_%';

  insert into page (organization_id, title, created_by)
  values (v_org, 'zzprobe switched off page', v_owner) returning id into v_page;

  perform tests.authenticate(v_owner, 'aal2');
  select count(*) into n from object;
  perform tests.ok(n = 0, 'modules off: the object registry answers nothing, even to the owner');
  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.ok(public.object_event_high_water() is null, 'modules off: no event history marker');
  perform tests.ok(public.my_sign_in_status() is null, 'spaces off: no sign-in rule status');

  perform tests.authenticate(v_staff, 'aal2');
  select count(*) into n from page;
  perform tests.ok(n = 0, 'pages off: no page is readable');
  perform tests.refused_ok(format($q$insert into page (organization_id, title, created_by) values (%L, 'zzprobe staff page', %L)$q$, v_org, v_staff),
    'pages off: staff cannot create a page through the API');
  perform tests.refused_ok(format($q$insert into lens (organization_id, name, owner_id) values (%L, 'zzprobe lens', %L)$q$, v_org, v_staff),
    'lenses off: staff cannot create a lens through the API');
  select count(*) into n from public.global_search('zzprobe') where result_type = 'page';
  perform tests.ok(n = 0, 'pages off: classic search links to no page');
  perform tests.clear_auth();
  reset role;

  -- Nothing is recorded from the classic tables while every module is off.
  select coalesce(max(seq), 0) into v_before from object_event;
  insert into task (organization_id, title, created_by) values (v_org, 'zzprobe silent task', v_owner) returning id into v_task;
  update task set title = 'zzprobe silent task renamed' where id = v_task;
  select count(*) into n from object_event where seq > v_before;
  perform tests.ok(n = 0, 'modules off: classic changes are not copied into object events');

  -- Pages on (its feature_flag row, as the app reads it): pages answer, lenses still do not.
  update feature_flag set enabled = true where key = 'wos_pages' and organization_id is null;
  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok((select count(*) from page where id = v_page) = 1, 'pages on: the page is readable again');
  perform tests.refused_ok(format($q$insert into lens (organization_id, name, owner_id) values (%L, 'zzprobe lens', %L)$q$, v_org, v_owner),
    'pages on, lenses off: lenses still refuse');
  perform tests.clear_auth();
  reset role;
  update feature_flag set enabled = false where key = 'wos_pages' and organization_id is null;

  -- The override (WORKSPACE_OS_FLAGS at the database) turns every module on.
  insert into app.workspace_os_override (key) values ('all');
  perform tests.authenticate(v_owner, 'aal2');
  select count(*) into n from object;
  perform tests.ok(n > 0, 'override all: the object registry answers again');
  perform tests.ok(public.object_event_high_water() is not null, 'override all: the history marker answers');
  perform tests.clear_auth();
  reset role;

  -- A deleted contact's details do not stay in the event history.
  insert into crm_contact (organization_id, full_name, email)
  values (v_org, 'Zzprobe Erasable Person', 'zzprobe-erase@example.com') returning id into v_contact;
  update crm_contact set full_name = 'Zzprobe Erasable Person Renamed' where id = v_contact;
  select count(*) into n from object_event where object_id = v_contact and changes::text like '%Zzprobe Erasable%';
  perform tests.ok(n > 0, 'fixture: the contact''s name was recorded while modules were on');
  delete from crm_contact where id = v_contact;
  select count(*) into n from object_event where object_id = v_contact and changes::text like '%Zzprobe%';
  perform tests.ok(n = 0, 'a deleted contact''s name is gone from its event history');
  select count(*) into n from object_event where object_id = v_contact and verb = 'deleted';
  perform tests.ok(n = 1, 'the deletion itself is still recorded');

  -- Other records keep what was deleted, as the audit trail does.
  update task set title = 'zzprobe audited task' where id = v_task;
  delete from task where id = v_task;
  select count(*) into n from object_event where object_id = v_task and verb = 'deleted' and changes::text like '%zzprobe audited task%';
  perform tests.ok(n = 1, 'a deleted task''s event still names it');
end;
$$;

-- The switch check and the override are not the caller's to change or read.
do $$
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  perform tests.refused_ok($q$insert into app.workspace_os_override (key) values ('all')$q$,
    'not even an owner can turn modules on through the override');
  perform tests.clear_auth();
  reset role;
end;
$$;

rollback;
