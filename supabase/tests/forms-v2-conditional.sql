-- Forms v2, part 2 (migration 20261108050000): conditional questions, file
-- answers and created records. Allowed and denied for admin, staff,
-- volunteer and guest. Run after qa-users.sql and rls.sql. All mutations
-- roll back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_form uuid;
  v_staff_form uuid;
  v_type uuid;
  v_doc uuid;
  v_ok boolean;
  v_native_form uuid;
  v_clash_form uuid;
  v_n integer;
  res record;
  r_who record;
  v_answers jsonb;
  v_props jsonb := jsonb_build_array(
    jsonb_build_object('key', 'name', 'kind', 'text', 'required', true,
      'label', jsonb_build_object('en', 'Your name', 'fr', 'Votre nom')),
    jsonb_build_object('key', 'can_drive', 'kind', 'checkbox', 'required', false,
      'label', jsonb_build_object('en', 'Can you drive?', 'fr', 'Pouvez-vous conduire?')),
    jsonb_build_object('key', 'licence', 'kind', 'text', 'required', true,
      'label', jsonb_build_object('en', 'Licence number', 'fr', 'Numéro de permis'),
      'showIf', jsonb_build_object('key', 'can_drive', 'op', 'eq', 'value', true)),
    jsonb_build_object('key', 'proof', 'kind', 'file', 'required', false,
      'label', jsonb_build_object('en', 'Proof', 'fr', 'Preuve'),
      'showIf', jsonb_build_object('key', 'licence', 'op', 'is_not_empty')),
    jsonb_build_object('key', 'size', 'kind', 'select', 'required', false,
      'label', jsonb_build_object('en', 'Shirt size', 'fr', 'Taille de chandail'),
      'options', jsonb_build_array(
        jsonb_build_object('key', 's', 'label', jsonb_build_object('en', 'Small', 'fr', 'Petit')),
        jsonb_build_object('key', 'l', 'label', jsonb_build_object('en', 'Large', 'fr', 'Grand')))),
    jsonb_build_object('key', 'why_large', 'kind', 'text', 'required', false,
      'label', jsonb_build_object('en', 'Why large?', 'fr', 'Pourquoi grand?'),
      'showIf', jsonb_build_object('key', 'size', 'op', 'eq', 'value', 'l'))
  );
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_admin, v_guest);

  -- ---------------------------------------------------------- building
  perform tests.authenticate(v_admin);
  insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
  values (v_org, 'volunteer_offer', 'Volunteer offer', 'Offre de bénévolat', v_props)
  returning id into v_form;
  perform tests.ok(v_form is not null, 'an admin builds a form with conditions and a file question');

  begin
    insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
    values (v_org, 'volunteer_offer', 'Bad', 'Mauvais', jsonb_build_array(
      jsonb_build_object('key', 'licence', 'kind', 'text', 'required', false,
        'label', jsonb_build_object('en', 'Licence', 'fr', 'Permis'),
        'showIf', jsonb_build_object('key', 'can_drive', 'op', 'eq', 'value', true)),
      jsonb_build_object('key', 'can_drive', 'kind', 'checkbox', 'required', false,
        'label', jsonb_build_object('en', 'Drives', 'fr', 'Conduit'))));
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a condition can only depend on an earlier question');
  begin
    insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
    values (v_org, 'volunteer_offer', 'Bad', 'Mauvais', jsonb_build_array(
      jsonb_build_object('key', 'size', 'kind', 'select', 'required', false,
        'label', jsonb_build_object('en', 'Size', 'fr', 'Taille'),
        'options', jsonb_build_array(jsonb_build_object('key', 's', 'label', jsonb_build_object('en', 'S', 'fr', 'S')))),
      jsonb_build_object('key', 'why', 'kind', 'text', 'required', false,
        'label', jsonb_build_object('en', 'Why', 'fr', 'Pourquoi'),
        'showIf', jsonb_build_object('key', 'size', 'op', 'eq', 'value', 'xl'))));
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a choice condition must name one of the choices');
  begin
    insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
    values (v_org, 'task', 'Bad', 'Mauvais', jsonb_build_array(
      jsonb_build_object('key', 'priority', 'kind', 'select', 'required', false,
        'label', jsonb_build_object('en', 'Priority', 'fr', 'Priorité'),
        'options', jsonb_build_array(jsonb_build_object('key', 'high', 'label', jsonb_build_object('en', 'High', 'fr', 'Haute')))),
      jsonb_build_object('key', 'title', 'kind', 'text', 'required', true,
        'label', jsonb_build_object('en', 'Title', 'fr', 'Titre'),
        'showIf', jsonb_build_object('key', 'priority', 'op', 'eq', 'value', 'high'))));
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'the task title is always asked');
  begin
    insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
    values (v_org, 'project', 'Bad', 'Mauvais', jsonb_build_array(
      jsonb_build_object('key', 'name', 'kind', 'text', 'required', true,
        'label', jsonb_build_object('en', 'Name', 'fr', 'Nom'))));
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a form cannot borrow a native type (projects are made in their own screen)');

  begin
    insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
    values (v_org, 'volunteer_offer', 'Bad', 'Mauvais', jsonb_build_array(
      jsonb_build_object('key', 'a', 'kind', 'text', 'required', false,
        'label', jsonb_build_object('en', 'A', 'fr', 'A')),
      jsonb_build_object('key', 'b', 'kind', 'text', 'required', false,
        'label', jsonb_build_object('en', 'B', 'fr', 'B'),
        'showIf', jsonb_build_object('key', 'a', 'op', 'neq'))));
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'an is / is not / contains condition needs a value');

  update public.form_v2 set status = 'published' where id = v_form;
  -- Same type, a question whose key the type already uses with another kind.
  insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
  values (v_org, 'volunteer_offer', 'Clash', 'Conflit', jsonb_build_array(
    jsonb_build_object('key', 'size', 'kind', 'number', 'required', false,
      'label', jsonb_build_object('en', 'Size', 'fr', 'Taille'))))
  returning id into v_clash_form;
  begin
    update public.form_v2 set status = 'published' where id = v_clash_form;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a form cannot open when a question clashes with the type''s property of the same key');
  reset role;
  select t.id into v_type from public.object_type t where t.organization_id = v_org and t.key = 'volunteer_offer';
  perform tests.ok(v_type is not null and (select kind from public.object_type where id = v_type) = 'custom',
    'opening the form creates its custom object type');
  select count(*) into v_n from public.property_definition d
  where d.type_id = v_type and d.system_column is null
    and (d.key, d.kind) in (('name', 'text'), ('can_drive', 'checkbox'), ('licence', 'text'),
                            ('proof', 'file'), ('size', 'select'), ('why_large', 'text'));
  perform tests.ok(v_n = 6, 'the type gets a custom property for every question');
  select count(*) into v_n from public.property_definition d
  where d.type_id = v_type and d.key = 'size' and d.options->'choices'->1->>'key' = 'l';
  perform tests.ok(v_n = 1, 'a choice question becomes a select property with the same choices');

  perform tests.authenticate(v_admin);
  insert into public.form_v2 (organization_id, type_key, title_en, title_fr, audience, properties)
  values (v_org, 'volunteer_offer', 'Staff offer', 'Offre du personnel', 'staff', v_props)
  returning id into v_staff_form;
  update public.form_v2 set status = 'published' where id = v_staff_form;
  reset role;

  -- ---------------------------------------------------------- hidden questions
  perform tests.authenticate(v_volunteer);
  select * into res from public.submit_form_v2(v_form,
    jsonb_build_object('name', 'Sam', 'can_drive', false, 'licence', 'STALE-123', 'size', 's'));
  reset role;
  select r.answers into v_answers from public.form_v2_response r where r.id = res.response_id;
  perform tests.ok(not (v_answers ? 'licence') and not (v_answers ? 'why_large') and v_answers->>'name' = 'Sam',
    'a hidden question is skipped even when the browser sent an answer for it');
  perform tests.ok(res.object_type = 'volunteer_offer' and res.object_id <> res.response_id,
    'the answer creates a record of the form''s type');
  select count(*) into v_n from public.form_v2_response r
  where r.id = res.response_id and r.created_object_type = 'volunteer_offer' and r.created_object_id = res.object_id;
  perform tests.ok(v_n = 1, 'the response is linked to the created record');
  select count(*) into v_n from public.object o
  where o.id = res.object_id and o.type_id = v_type and o.title = 'Sam'
    and o.owner_id = v_volunteer and o.created_by = v_volunteer and o.organization_id = v_org;
  perform tests.ok(v_n = 1, 'the record is of the type, titled by the first text answer, owned by the submitter');
  select count(*) into v_n from public.property_value v
  join public.property_definition d on d.id = v.property_id
  where v.object_id = res.object_id
    and ((d.key = 'name' and v.value_text = 'Sam')
      or (d.key = 'can_drive' and v.value_bool = false)
      or (d.key = 'size' and v.value_text = 's'));
  perform tests.ok(v_n = 3, 'the answers are stored as property values of the record');
  select count(*) into v_n from public.property_value v
  join public.property_definition d on d.id = v.property_id
  where v.object_id = res.object_id and d.key in ('licence', 'why_large', 'proof');
  perform tests.ok(v_n = 0, 'hidden and empty questions store no property value');

  perform tests.authenticate(v_volunteer);
  select count(*) into v_n from public.object where id = res.object_id;
  perform tests.ok(v_n = 1, 'the submitter sees the record they made');
  begin
    perform public.submit_form_v2(v_form, jsonb_build_object('name', 'Sam', 'can_drive', true));
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a shown question is required again');
  reset role;

  perform tests.authenticate(v_staff);
  select count(*) into v_n from public.object where id = res.object_id;
  perform tests.ok(v_n = 0, 'staff without a grant do not see someone else''s record');
  reset role;
  perform tests.authenticate(v_admin);
  select count(*) into v_n from public.object where id = res.object_id;
  perform tests.ok(v_n = 1, 'an admin sees the record');
  reset role;

  -- ---------------------------------------------------------- audience
  select count(*) into v_n from public.object where type_id = v_type;
  perform tests.authenticate(v_volunteer);
  begin
    perform public.submit_form_v2(v_staff_form, jsonb_build_object('name', 'Sneaky'));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a volunteer outside the staff audience is denied');
  reset role;
  perform tests.ok((select count(*) from public.object where type_id = v_type) = v_n,
    'a denied answer creates no record');
  perform tests.authenticate(v_guest);
  begin
    perform public.submit_form_v2(v_staff_form, jsonb_build_object('name', 'Sneaky'));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a guest outside the staff audience is denied');
  reset role;

  -- ---------------------------------------------------------- files
  -- The volunteer's upload, as the app records it: the storage object, then
  -- the library document (its scan starts pending).
  insert into storage.objects (bucket_id, name, owner_id)
  values ('documents', 'forms-v2/test/licence.png', v_volunteer::text);
  perform tests.authenticate(v_volunteer);
  insert into public.document (organization_id, title, kind, storage_path, visibility, owner_id, created_by)
  values (v_org, 'licence.png', 'file', 'forms-v2/test/licence.png', 'organization', v_volunteer, v_volunteer)
  returning id into v_doc;
  perform tests.ok(v_doc is not null, 'a volunteer registers their uploaded file as a library document');
  select * into res from public.submit_form_v2(v_form,
    jsonb_build_object('name', 'Alex', 'can_drive', true, 'licence', 'QC-42', 'proof', v_doc::text));
  perform tests.ok(res.object_id is not null, 'a file answer that is the submitter''s own document is accepted');
  reset role;
  select r.answers into v_answers from public.form_v2_response r where r.id = res.response_id;
  perform tests.ok(v_answers->>'proof' = v_doc::text and v_answers->>'licence' = 'QC-42',
    'the response keeps the document id and the now-shown licence');
  select count(*) into v_n from public.property_value v
  join public.property_definition d on d.id = v.property_id
  where v.object_id = res.object_id and d.key = 'proof' and v.value_uuids = array[v_doc];
  perform tests.ok(v_n = 1, 'the file is stored as a file property value of the record');
  select count(*) into v_n from public.document where id = v_doc and scan_status = 'pending';
  perform tests.ok(v_n = 1, 'the file keeps the library''s pending scan state');

  perform tests.authenticate(v_guest);
  begin
    perform public.submit_form_v2(v_form,
      jsonb_build_object('name', 'Robin', 'can_drive', true, 'licence', 'QC-1', 'proof', v_doc::text));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'someone else''s document is refused as a file answer');
  begin
    perform public.submit_form_v2(v_form,
      jsonb_build_object('name', 'Robin', 'can_drive', true, 'licence', 'QC-1', 'proof', gen_random_uuid()::text));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'an unknown document is refused as a file answer');
  begin
    perform public.submit_form_v2(v_form,
      jsonb_build_object('name', 'Robin', 'can_drive', true, 'licence', 'QC-1', 'proof', 'not-a-document'));
    v_ok := false;
  exception when invalid_parameter_value then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a file answer must be a document id');
  reset role;

  perform tests.authenticate(v_staff);
  begin
    perform public.submit_form_v2(v_form,
      jsonb_build_object('name', 'Robin', 'can_drive', true, 'licence', 'QC-1', 'proof', v_doc::text));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'staff cannot answer with a volunteer''s document either');
  reset role;

  -- A form's file is private to its uploader and the response's readers.
  perform tests.authenticate(v_guest);
  begin
    perform public.form_v2_keep_file_private(v_doc);
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'only the uploader can narrow a form file');
  reset role;
  perform tests.authenticate(v_staff);
  select count(*) into v_n from public.document where id = v_doc;
  perform tests.ok(v_n = 1, 'before it is narrowed, an organization-wide upload is readable by staff');
  reset role;
  perform tests.authenticate(v_volunteer);
  perform public.form_v2_keep_file_private(v_doc);
  select count(*) into v_n from public.document where id = v_doc;
  perform tests.ok(v_n = 1, 'the uploader still reads their narrowed file');
  reset role;
  for r_who in select * from (values (v_staff, 'staff'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r_who.uid);
    select count(*) into v_n from public.document where id = v_doc;
    reset role;
    perform tests.ok(v_n = 0, format('%s cannot read someone else''s form file', r_who.who));
  end loop;
  perform tests.authenticate(v_admin);
  select count(*) into v_n from public.document where id = v_doc;
  perform tests.ok(v_n = 1, 'an admin reads the form file, as they read the response');
  reset role;

  -- A form published with a native type's key before this migration still
  -- answers as before. (Made here as the conversion would, bypassing the
  -- check on new forms.)
  perform set_config('app.forms_v2_converting', 'on', true);
  alter table public.form_v2 disable trigger form_v2_protect;
  insert into public.form_v2 (organization_id, type_key, title_en, title_fr, status, properties, published_at)
  values (v_org, 'meeting', 'Old meeting form', 'Ancien formulaire', 'published', jsonb_build_array(
    jsonb_build_object('key', 'topic', 'kind', 'text', 'required', true,
      'label', jsonb_build_object('en', 'Topic', 'fr', 'Sujet'))), now())
  returning id into v_native_form;
  alter table public.form_v2 enable trigger form_v2_protect;
  perform set_config('app.forms_v2_converting', '', true);
  perform tests.authenticate(v_volunteer);
  select * into res from public.submit_form_v2(v_native_form, jsonb_build_object('topic', 'Budget'));
  reset role;
  perform tests.ok(res.object_id = res.response_id
    and (select created_object_id is null from public.form_v2_response where id = res.response_id),
    'an earlier form with a native type''s key is answered as before and creates nothing');
  perform tests.authenticate(v_admin);
  update public.form_v2 set status = 'closed' where id = v_native_form;
  get diagnostics v_n = row_count;
  perform tests.ok(v_n = 1, 'and it can still be closed');
  reset role;

  -- ---------------------------------------------------------- reading
  perform tests.authenticate(v_admin);
  select count(*) into v_n from public.form_v2_response where form_id = v_form and created_object_id is not null;
  perform tests.ok(v_n = 2, 'an admin reads every response with its created record');
  reset role;
end;
$$;

rollback;
