-- Workspace OS forms for any type (V1-6, migration 20261106110100): who may
-- build, read and answer forms, what an answer creates, and that converting
-- the existing forms can be undone. Every role is covered, allowed and denied:
-- owner, admin, staff, volunteer, guest and signed-out (this organization has
-- no separate "member" or "accountant" role; members are staff, volunteers
-- and guests). Run after qa-users.sql and rls.sql. All mutations roll back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_project uuid;
  v_task_form uuid;
  v_staff_form uuid;
  v_custom_form uuid;
  v_legacy uuid;
  v_legacy_sub uuid;
  v_ok boolean;
  v_n integer;
  v_text text;
  r record;
  res record;
  v_task_props jsonb := jsonb_build_array(
    jsonb_build_object('key', 'title', 'kind', 'text', 'required', true,
      'label', jsonb_build_object('en', 'What is needed?', 'fr', 'De quoi avez-vous besoin?')),
    jsonb_build_object('key', 'priority', 'kind', 'select', 'required', false,
      'label', jsonb_build_object('en', 'Priority', 'fr', 'Priorité'),
      'options', jsonb_build_array(
        jsonb_build_object('key', 'low', 'label', jsonb_build_object('en', 'Low', 'fr', 'Basse')),
        jsonb_build_object('key', 'high', 'label', jsonb_build_object('en', 'High', 'fr', 'Haute')))),
    jsonb_build_object('key', 'due', 'kind', 'date', 'required', false,
      'label', jsonb_build_object('en', 'Needed by', 'fr', 'Pour le'))
  );
  v_custom_props jsonb := jsonb_build_array(
    jsonb_build_object('key', 'name', 'kind', 'text', 'required', true,
      'label', jsonb_build_object('en', 'Name', 'fr', 'Nom')),
    jsonb_build_object('key', 'agree', 'kind', 'checkbox', 'required', false,
      'label', jsonb_build_object('en', 'I agree', 'fr', 'J''accepte'))
  );
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_admin, v_guest);
  -- Its own project, so the test does not depend on seed data (CI has none).
  insert into public.project (organization_id, name, created_by)
  values (v_org, 'Forms v2 test project', v_owner)
  returning id into v_project;

  -- ---------------------------------------------------------- building
  for r in select * from (values
      (v_staff, 'aal2', 'staff'), (v_volunteer, 'aal2', 'a volunteer'),
      (v_guest, 'aal2', 'a guest'), (v_admin, 'aal1', 'an admin without MFA')) as t(uid, lvl, who) loop
    perform tests.authenticate(r.uid, r.lvl);
    begin
      insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
      values (v_org, 'task', 'Nope', 'Non', v_task_props);
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    reset role;
    perform tests.ok(v_ok, format('%s cannot build a form', r.who));
  end loop;

  perform tests.authenticate(v_admin);
  insert into public.form_v2 (organization_id, type_key, target_project_id, title_en, title_fr, properties)
  values (v_org, 'task', v_project, 'Request help', 'Demander de l''aide', v_task_props)
  returning id into v_task_form;
  perform tests.ok(v_task_form is not null, 'an admin with MFA builds a task form');
  begin
    insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
    values (v_org, 'task', 'Bad', 'Mauvais', jsonb_build_array(
      jsonb_build_object('key', 'assignee', 'kind', 'text', 'required', true,
        'label', jsonb_build_object('en', 'Who', 'fr', 'Qui'))));
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a task form can only expose the task properties allowed on forms');
  begin
    insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
    values (v_org, 'idea', 'No French', 'x', jsonb_build_array(
      jsonb_build_object('key', 'name', 'kind', 'text', 'required', true,
        'label', jsonb_build_object('en', 'Name'))));
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'every property needs both an English and a French label');
  begin
    insert into public.form_v2 (organization_id, type_key, title_en, title_fr, status, properties)
    values (v_org, 'idea', 'Live', 'En ligne', 'published', v_custom_props);
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a form built in the app starts as a draft');
  update public.form_v2 set status = 'published' where id = v_task_form;
  select published_at is not null into v_ok from public.form_v2 where id = v_task_form;
  perform tests.ok(v_ok, 'publishing records the time');
  begin
    update public.form_v2 set properties = v_custom_props where id = v_task_form;
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a published form''s properties are frozen');

  insert into public.form_v2 (organization_id, type_key, title_en, title_fr, audience, properties)
  values (v_org, 'idea', 'Staff idea', 'Idée du personnel', 'staff', v_custom_props)
  returning id into v_staff_form;
  update public.form_v2 set status = 'published' where id = v_staff_form;
  insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
  values (v_org, 'idea', 'Draft idea', 'Idée brouillon', v_custom_props)
  returning id into v_custom_form;
  reset role;

  perform tests.authenticate(v_owner);
  select count(*) into v_n from public.form_v2 where id in (v_task_form, v_staff_form, v_custom_form);
  perform tests.ok(v_n = 3, 'the owner reads every form, drafts included');
  update public.form_v2 set title_en = 'Draft idea (owner)' where id = v_custom_form;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 1, 'the owner edits a draft');
  reset role;

  -- ---------------------------------------------------------- reading
  perform tests.authenticate(v_staff);
  select count(*) into v_n from public.form_v2 where id in (v_task_form, v_staff_form, v_custom_form);
  perform tests.ok(v_n = 2, 'staff read published member and staff forms, not drafts');
  update public.form_v2 set title_en = 'Hijack' where id = v_task_form;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'staff cannot edit a form');
  delete from public.form_v2 where id = v_custom_form;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 0, 'staff cannot delete a form');
  reset role;

  for r in select * from (values (v_volunteer, 'a volunteer'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    select count(*) into v_n from public.form_v2 where id in (v_task_form, v_staff_form, v_custom_form);
    reset role;
    perform tests.ok(v_n = 1, format('%s reads only the published members form', r.who));
  end loop;

  -- ---------------------------------------------------------- answering
  perform tests.authenticate(v_volunteer);
  select * into res from public.submit_form_v2(v_task_form,
    jsonb_build_object('title', 'Chairs for Saturday', 'priority', 'high', 'due', '2026-11-20'));
  perform tests.ok(res.object_type = 'task', 'answering a task form creates a task');
  reset role;
  select count(*) into v_n from public.task
  where id = res.object_id and title = 'Chairs for Saturday' and priority = 'high'
    and due_at = date '2026-11-20' and requester_id = v_volunteer and project_id = v_project;
  perform tests.ok(v_n = 1, 'the task carries the answers, the form''s project and the submitter as requester');

  perform tests.authenticate(v_volunteer);
  select count(*) into v_n from public.form_v2_response where form_id = v_task_form;
  perform tests.ok(v_n = 1, 'the submitter reads their own response');
  begin
    perform public.submit_form_v2(v_staff_form, jsonb_build_object('name', 'x'));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a volunteer cannot answer a staff-only form');
  begin
    perform public.submit_form_v2(v_custom_form, jsonb_build_object('name', 'x'));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'nobody answers a draft');
  begin
    perform public.submit_form_v2(v_task_form, jsonb_build_object('priority', 'low'));
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a required answer is enforced');
  begin
    perform public.submit_form_v2(v_task_form, jsonb_build_object('title', 'x', 'priority', 'urgent'));
    v_ok := false;
  exception when invalid_parameter_value then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a select answer must be one of its options');
  begin
    insert into public.form_v2_response (organization_id, form_id, answers, object_type, object_id)
    values (v_org, v_task_form, '{}'::jsonb, 'task', gen_random_uuid());
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'responses cannot be written directly');
  reset role;

  perform tests.authenticate(v_guest);
  select count(*) into v_n from public.form_v2_response where form_id = v_task_form;
  perform tests.ok(v_n = 0, 'a guest cannot read someone else''s response');
  select * into res from public.submit_form_v2(v_task_form, jsonb_build_object('title', 'Guest ask'));
  perform tests.ok(res.object_id is not null, 'a guest in the members audience answers');
  reset role;

  perform tests.authenticate(v_staff);
  select * into res from public.submit_form_v2(v_staff_form, jsonb_build_object('name', 'Better signage'));
  perform tests.ok(res.object_type = 'idea' and res.object_id = res.response_id,
    'an answer to a custom type is its own object until the registry lands');
  select count(*) into v_n from public.form_v2_response where form_id = v_task_form;
  perform tests.ok(v_n = 0, 'staff cannot read other people''s responses');
  reset role;

  perform tests.authenticate(v_admin);
  select count(*) into v_n from public.form_v2_response where form_id in (v_task_form, v_staff_form);
  perform tests.ok(v_n = 3, 'an admin reads every response');
  reset role;
  perform tests.authenticate(v_admin, 'aal1');
  select count(*) into v_n from public.form_v2_response where form_id in (v_task_form, v_staff_form);
  perform tests.ok(v_n = 0, 'an admin without MFA reads only their own responses');
  reset role;

  -- ---------------------------------------------------------- conversion
  insert into public.form_definition (organization_id, title, fields, created_by)
  values (v_org, 'Legacy sign-up', jsonb_build_array(
    jsonb_build_object('key', 'who', 'label', 'Your name', 'type', 'text', 'required', true),
    jsonb_build_object('key', 'size', 'label', 'Size', 'type', 'choice', 'required', false,
      'options', jsonb_build_array('S', 'M'))), v_owner)
  returning id into v_legacy;
  update public.form_definition set status = 'published' where id = v_legacy;
  insert into public.form_submission (organization_id, form_id, submitted_by, answers, content_sha256)
  values (v_org, v_legacy, v_staff, jsonb_build_object('who', 'Sam', 'size', 'M'), repeat('a', 64))
  returning id into v_legacy_sub;

  for r in select * from (values (v_staff, 'aal2', 'staff'), (v_volunteer, 'aal2', 'a volunteer'),
                                 (v_admin, 'aal1', 'an admin without MFA')) as t(uid, lvl, who) loop
    perform tests.authenticate(r.uid, r.lvl);
    begin
      perform public.forms_v2_convert_legacy(v_org);
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    reset role;
    perform tests.ok(v_ok, format('%s cannot convert the existing forms', r.who));
  end loop;

  perform tests.authenticate(v_owner);
  v_n := public.forms_v2_convert_legacy(v_org);
  perform tests.ok(v_n >= 1, 'the owner converts the existing forms');
  select count(*) into v_n from public.form_v2
  where legacy_form_id = v_legacy and status = 'published' and type_key = 'form_response'
    and properties->1->>'kind' = 'select' and properties->1->'options'->1->>'key' = 'option_2';
  perform tests.ok(v_n = 1, 'a converted form keeps its status and its choices become options');
  select answers->>'size' into v_text from public.form_v2_response where legacy_submission_id = v_legacy_sub;
  perform tests.ok(v_text = 'option_2', 'a converted submission keeps its answers, choices as option keys');
  v_n := public.forms_v2_convert_legacy(v_org);
  perform tests.ok(v_n = 0, 'converting twice copies nothing more');
  perform public.forms_v2_revert_legacy(v_org);
  select count(*) into v_n from public.form_v2 where legacy_form_id = v_legacy;
  perform tests.ok(v_n = 0, 'undoing the conversion removes the copies');
  select count(*) into v_n from public.form_definition where id = v_legacy;
  perform tests.ok(v_n = 1, 'the original form is untouched');
  reset role;

  -- ---------------------------------------------------------- signed out
  perform tests.clear_auth();
  begin
    select count(*) into v_n from public.form_v2;
    v_ok := v_n = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor reads no forms');
  begin
    select count(*) into v_n from public.form_v2_response;
    v_ok := v_n = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor reads no responses');
  begin
    perform public.submit_form_v2(v_task_form, jsonb_build_object('title', 'anon'));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signed-out visitor cannot answer');
  reset role;
end;
$$;

rollback;
