-- Workspace OS templates (V1-13, migration 20261106110200): who may write,
-- read and use templates, that dates follow the chosen start date, that the
-- language chosen is the language written, and that using a template never
-- grants more than the person already has. Roles: owner, admin, staff,
-- volunteer, guest and signed-out (no separate "member" or "accountant" role
-- exists in org_role). Run after qa-users.sql and rls.sql. All mutations roll back.
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
  v_space uuid;
  v_page uuid;
  v_staff_draft uuid;
  v_task_tpl uuid;
  v_ok boolean;
  v_n integer;
  v_text text;
  v_date date;
  r record;
  v_task_body jsonb := '{"title":{"en":"Prepare the room","fr":"Préparer la salle"},"priority":"high","offsets":{"start":1,"due":3}}';
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_admin, v_guest);
  -- Its own program, so the test does not depend on seed data (CI has none).
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Templates v2 test program', 'templates-v2-test-' || substr(md5(random()::text), 1, 8), v_owner)
  returning id into v_program;
  select id into strict v_space from public.template_v2
  where organization_id = v_org and scope = 'space' and created_by is null;
  select id into strict v_page from public.template_v2
  where organization_id = v_org and scope = 'page' and created_by is null;
  perform tests.ok(true, 'every organization starts with a starter gallery');

  -- ---------------------------------------------------------- writing
  for r in select * from (values (v_volunteer, 'a volunteer'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    begin
      insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, body)
      values (v_org, 'object', 'task', 'x', 'x', v_task_body);
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    reset role;
    perform tests.ok(v_ok, format('%s cannot write a template', r.who));
  end loop;

  perform tests.authenticate(v_staff);
  insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, body)
  values (v_org, 'object', 'task', 'Room set-up', 'Installation de la salle', v_task_body)
  returning id into v_staff_draft;
  perform tests.ok(v_staff_draft is not null, 'staff write a template');
  begin
    insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, body)
    values (v_org, 'object', 'task', 'One language', 'Une langue', '{"title":{"en":"Only English"}}');
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'every template text needs English and French');
  begin
    insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, body)
    values (v_org, 'object', 'task', 'Backwards', 'À rebours',
      '{"title":{"en":"a","fr":"b"},"offsets":{"start":5,"due":2}}');
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a start cannot come after its due date');
  update public.template_v2 set name_en = 'Hijacked' where id = v_space;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'staff cannot edit someone else''s template');
  update public.template_v2 set status = 'published' where id = v_staff_draft;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 1, 'staff publish their own template');
  v_task_tpl := v_staff_draft;
  insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, body)
  values (v_org, 'object', 'task', 'Private draft', 'Brouillon privé', v_task_body)
  returning id into v_staff_draft;
  reset role;

  perform tests.authenticate(v_admin);
  select count(*) into v_n from public.template_v2 where id = v_staff_draft;
  perform tests.ok(v_n = 1, 'an admin reads other people''s drafts');
  update public.template_v2 set description_en = 'Checked' where id = v_task_tpl;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 1, 'an admin edits any template');
  reset role;

  perform tests.authenticate(v_admin, 'aal1');
  update public.template_v2 set description_en = 'No MFA' where id = v_task_tpl;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'an admin without MFA cannot edit someone else''s template');
  reset role;

  -- ---------------------------------------------------------- reading
  for r in select * from (values (v_volunteer, 'a volunteer'), (v_guest, 'a guest'), (v_owner, 'the owner')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    select count(*) into v_n from public.template_v2 where id in (v_space, v_page, v_task_tpl);
    perform tests.ok(v_n = 3, format('%s browses the published gallery', r.who));
    select count(*) into v_n from public.template_v2 where id = v_staff_draft;
    reset role;
    perform tests.ok((r.uid = v_owner) = (v_n = 1),
      format('%s %s a draft someone else wrote', r.who, case when r.uid = v_owner then 'reads' else 'does not read' end));
  end loop;

  -- ---------------------------------------------------------- using
  perform tests.authenticate(v_owner);
  select count(*) into v_n from public.apply_template_v2(v_space, date '2027-03-01', 'fr-CA', v_program, null);
  perform tests.ok(v_n = 5, 'using the space template creates its two projects and three tasks');
  select target_date into v_date from public.project
  where program_id = v_program and name = 'Logistique de l’événement' and created_by = v_owner;
  perform tests.ok(v_date = date '2027-04-12', 'project dates count from the chosen start, in the chosen language');
  select due_at into v_date from public.task
  where title = 'Réserver la salle' and created_by = v_owner and due_at >= date '2027-03-01';
  perform tests.ok(v_date = date '2027-03-08', 'task dates count from the chosen start');
  begin
    perform public.apply_template_v2(v_page, date '2027-03-01');
    v_ok := false;
  exception when feature_not_supported then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'page templates wait for the page editor');
  begin
    perform public.apply_template_v2(v_staff_draft, date '2027-03-01');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'nobody uses a draft');
  reset role;

  -- Using a template never grants more than the person has: a volunteer and a
  -- guest cannot create projects in the program, so the template refuses too.
  for r in select * from (values (v_volunteer, 'a volunteer'), (v_guest, 'a guest'), (v_staff, 'staff without a program grant')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    begin
      perform public.apply_template_v2(v_space, date '2027-03-01', 'en', v_program, null);
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    reset role;
    perform tests.ok(v_ok, format('%s cannot create projects through a template', r.who));
  end loop;

  select id into v_project from public.project
  where program_id = v_program and name = 'Logistique de l’événement' and created_by = v_owner;
  perform tests.authenticate(v_admin);
  select object_id into v_text from public.apply_template_v2(v_task_tpl, date '2027-05-10', 'en', null, v_project);
  select title || '|' || priority::text || '|' || start_at::text || '|' || due_at::text into v_text
  from public.task where id = v_text::uuid;
  perform tests.ok(v_text = 'Prepare the room|high|2027-05-11|2027-05-13', 'a task template fills the title, priority and dates');
  reset role;

  -- ---------------------------------------------------------- deleting
  perform tests.authenticate(v_volunteer);
  delete from public.template_v2 where id = v_task_tpl;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'a volunteer cannot delete a template');
  reset role;
  perform tests.authenticate(v_staff);
  delete from public.template_v2 where id = v_staff_draft;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 1, 'staff delete their own template');
  reset role;

  -- ---------------------------------------------------------- signed out
  perform tests.clear_auth();
  begin
    select count(*) into v_n from public.template_v2;
    v_ok := v_n = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor sees no templates');
  begin
    perform public.apply_template_v2(v_space, date '2027-03-01');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor cannot use a template');
  reset role;
end;
$$;

rollback;
