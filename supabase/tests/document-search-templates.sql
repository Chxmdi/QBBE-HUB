-- Document search and templates (#147, migration 20261001100000): words
-- inside files are searchable in English and French, search returns only what
-- the searcher may open (never a staff-only document to a volunteer, never
-- someone else's receipt), stored text is unreachable except through search,
-- and templates are managed by owners/admins with MFA only.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_other_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_open_folder uuid;
  v_staff_folder uuid;
  v_open_doc uuid;
  v_staff_doc uuid;
  v_french_doc uuid;
  v_link_doc uuid;
  v_receipt uuid;
  v_template uuid;
  v_generated uuid;
  v_open_path text := gen_random_uuid()::text || '/minutes.pdf';
  v_staff_path text := gen_random_uuid()::text || '/salaries.pdf';
  v_french_path text := gen_random_uuid()::text || '/recu.jpg';
  v_generated_path text := gen_random_uuid()::text || '/letter.pdf';
  v_receipt_path text;
  v_snippet text;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_staff limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org
    and user_id in (v_owner, v_staff, v_volunteer, v_admin, v_guest, v_other_staff);

  select id into strict v_open_folder from public.document_folder
   where organization_id = v_org and category = 'governance' and name = 'Board minutes';
  select id into strict v_staff_folder from public.document_folder
   where organization_id = v_org and category = 'hr' and name = 'Personnel';

  v_receipt_path := v_org::text || '/' || v_staff::text || '/' || gen_random_uuid()::text || '/scan.jpg';
  insert into storage.objects (bucket_id, name, owner_id) values
    ('documents', v_open_path, v_staff::text),
    ('documents', v_staff_path, v_staff::text),
    ('documents', v_french_path, v_staff::text),
    ('documents', v_generated_path, v_staff::text),
    ('receipts', v_receipt_path, v_staff::text);

  -- Fixtures: a staff member files three documents -----------------------------
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.document (organization_id, title, kind, storage_path, mime_type,
                               folder_id, owner_id, created_by)
  values (v_org, 'Board minutes March', 'file', v_open_path, 'application/pdf',
          v_open_folder, v_staff, v_staff)
  returning id into v_open_doc;
  insert into public.document (organization_id, title, kind, storage_path, mime_type,
                               folder_id, owner_id, created_by)
  values (v_org, 'Salary review', 'file', v_staff_path, 'application/pdf',
          v_staff_folder, v_staff, v_staff)
  returning id into v_staff_doc;
  insert into public.document (organization_id, title, kind, storage_path, mime_type,
                               owner_id, created_by)
  values (v_org, 'Scanned slip', 'file', v_french_path, 'image/jpeg', v_staff, v_staff)
  returning id into v_french_doc;
  insert into public.document (organization_id, title, kind, url, owner_id, created_by)
  values (v_org, 'Drive link', 'link', 'https://drive.google.com/file/d/x/view', v_staff, v_staff)
  returning id into v_link_doc;

  -- Recording text: allowed ----------------------------------------------------
  perform public.set_document_text(v_open_doc,
    'The board approved the new receipts policy. Quorum: seven members.', 'pdf_text');
  perform public.set_document_text(v_staff_doc,
    'Confidential: executive compensation zanzibarquartz adjustment.', 'pdf_text');
  perform public.set_document_text(v_french_doc,
    'Reçu officiel' || chr(7) || ' — dépenses remboursées pour la conférence annuelle', 'ocr');
  perform tests.ok(true, 'the person who added a file records the words read out of it');

  -- Recording text: refused ----------------------------------------------------
  begin
    perform public.set_document_text(v_link_doc, 'words', 'pdf_text');
    raise exception 'FAIL: text was recorded for a link';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a link has no file text to record');
  begin
    perform public.set_document_text(v_open_doc, 'words', 'scribbles');
    raise exception 'FAIL: an unknown text source was accepted';
  exception when invalid_parameter_value then null; end;
  perform tests.ok(true, 'only the known text sources are accepted');

  perform tests.authenticate(v_volunteer, 'aal1');
  begin
    perform public.set_document_text(v_open_doc, 'volunteer rewrites the index', 'ocr');
    raise exception 'FAIL: a volunteer rewrote another person''s document text';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a volunteer cannot record text for a document they did not add');

  perform tests.authenticate(v_other_staff, 'aal1');
  begin
    perform public.set_document_text(v_staff_doc, 'planted words', 'ocr');
    raise exception 'FAIL: another staff member rewrote the document text';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'staff cannot record text for a document someone else added');

  -- The stored text is not readable directly ----------------------------------
  begin
    select count(*) into n from public.document_text;
    raise exception 'FAIL: a client read document_text directly';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'stored file text cannot be read directly, only searched');
  begin
    insert into public.document_text (organization_id, document_id, source, content)
    values (v_org, v_open_doc, 'ocr', 'forged');
    raise exception 'FAIL: a client wrote document_text directly';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'stored file text cannot be written directly');

  -- Search inside files: allowed -----------------------------------------------
  perform tests.authenticate(v_other_staff, 'aal1');
  select count(*) into n from public.search_library('zanzibarquartz') where id = v_staff_doc;
  perform tests.ok(n = 1, 'staff find a staff-folder document by a word inside it');
  select snippet into v_snippet from public.search_library('zanzibarquartz') where id = v_staff_doc;
  perform tests.ok(v_snippet like '%' || chr(2) || 'zanzibarquartz' || chr(3) || '%',
    'the snippet marks the matched word with control characters, not markup');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.search_library('receipt') where id = v_open_doc;
  perform tests.ok(n = 1, 'English stemming: "receipt" finds a file that says "receipts"');
  select count(*) into n from public.search_library('remboursée') where id = v_french_doc;
  perform tests.ok(n = 1, 'French stemming: "remboursée" finds a scan that says "remboursées"');
  select count(*) into n from public.search_library('conférences annuelles') where id = v_french_doc;
  perform tests.ok(n = 1, 'several French words are matched together');
  select count(*) into n from public.search_library('minutes march') where id = v_open_doc;
  perform tests.ok(n = 1, 'the title search still works alongside the words inside');

  -- Search: refused (no leak) -------------------------------------------------
  select count(*) into n from public.search_library('zanzibarquartz');
  perform tests.ok(n = 0, 'a volunteer''s search never returns a staff-only document, even when a word inside it matches');
  select count(*) into n from public.search_library('Salary review');
  perform tests.ok(n = 0, 'a volunteer''s search does not return a staff-only document by its title');
  select count(*) into n from public.search_library('compensation');
  perform tests.ok(n = 0, 'no other word inside the staff-only document leaks it either');

  perform tests.authenticate(v_guest, 'aal1');
  select count(*) into n from public.search_library('zanzibarquartz');
  perform tests.ok(n = 0, 'a guest''s search does not return a staff-only document');

  perform tests.clear_auth();
  begin
    perform * from public.search_library('receipt');
    raise exception 'FAIL: anonymous search ran';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'search is not callable signed out');

  -- An archived document leaves search unless asked for --------------------------
  perform tests.authenticate(v_staff, 'aal1');
  update public.document set archived_at = now() where id = v_french_doc;
  select count(*) into n from public.search_library('remboursée') where id = v_french_doc;
  perform tests.ok(n = 0, 'an archived document is not in ordinary search results');
  select count(*) into n from public.search_library('remboursée', true, true) where id = v_french_doc;
  perform tests.ok(n = 1, 'an archived document is found when archived documents are searched');

  -- Receipts ---------------------------------------------------------------------
  insert into public.finance_receipt (organization_id, document_date, vendor, total_cents,
    storage_path, file_name, mime_type)
  values (v_org, current_date, 'Papeterie', 1234, v_receipt_path, 'scan.jpg', 'image/jpeg')
  returning id into v_receipt;
  perform public.set_receipt_text(v_receipt, 'PAPETERIE DU COIN  cartouches toner  TOTAL 12,34', 'ocr');
  select count(*) into n from public.search_library('toner') where id = v_receipt and kind = 'receipt';
  perform tests.ok(n = 1, 'a word printed on a scanned receipt finds it, for its submitter');

  perform tests.authenticate(v_other_staff, 'aal1');
  select count(*) into n from public.search_library('toner') where id = v_receipt;
  perform tests.ok(n = 0, 'another staff member''s search does not return someone else''s receipt');
  begin
    perform public.set_receipt_text(v_receipt, 'planted', 'ocr');
    raise exception 'FAIL: another staff member recorded a receipt''s text';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'only the submitter or finance records a receipt''s text');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.search_library('toner');
  perform tests.ok(n = 0, 'a volunteer''s search never returns a receipt');

  perform tests.authenticate(v_admin, 'aal1');
  select count(*) into n from public.search_library('toner') where id = v_receipt;
  perform tests.ok(n = 0, 'an administrator without MFA does not find receipts');
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into n from public.search_library('toner') where id = v_receipt;
  perform tests.ok(n = 1, 'an administrator with MFA finds any receipt by its words');

  -- Templates: refused -----------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  begin
    insert into public.document_template (organization_id, name, kind, language, record_type, body)
    values (v_org, 'Staff template', 'letter', 'en', 'member', 'Dear {{person.name}}');
    raise exception 'FAIL: staff created a template';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'staff cannot create a template');

  perform tests.authenticate(v_admin, 'aal1');
  begin
    insert into public.document_template (organization_id, name, kind, language, record_type, body)
    values (v_org, 'No MFA template', 'letter', 'en', 'member', 'Dear {{person.name}}');
    raise exception 'FAIL: an administrator without MFA created a template';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'an administrator without MFA cannot create a template');

  -- Templates: allowed -----------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  insert into public.document_template (organization_id, name, kind, language, record_type,
                                        body, folder_id)
  values (v_org, 'Lettre de remerciement', 'acknowledgement', 'fr', 'gift',
          'Merci {{donor.name}} pour votre don de {{gift.amount}}.', v_staff_folder)
  returning id into v_template;
  perform tests.ok(v_template is not null, 'an administrator with MFA creates a template');
  update public.document_template set body = body || ' Cordialement.' where id = v_template;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'an administrator with MFA edits a template');
  begin
    insert into public.document_template (organization_id, name, kind, language, record_type, body)
    values (v_org, 'Bad', 'memo', 'en', 'member', 'x');
    raise exception 'FAIL: an unknown template kind was accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a template is a letter, a contract or an acknowledgement');
  begin
    insert into public.document_template (organization_id, name, kind, language, record_type, body)
    values (v_org, 'Bad', 'letter', 'de', 'member', 'x');
    raise exception 'FAIL: a German template was accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a template is in French or English');

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into n from public.document_template where id = v_template;
  perform tests.ok(n = 1, 'staff read templates to generate from them');
  update public.document_template set body = 'changed by staff' where id = v_template;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'staff cannot change a template');
  begin
    delete from public.document_template where id = v_template;
    raise exception 'FAIL: a template was deleted';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'templates are archived, never deleted');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.document_template where id = v_template;
  perform tests.ok(n = 0, 'a volunteer does not see templates');

  -- A generated document ---------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.document (organization_id, title, kind, storage_path, mime_type,
                               folder_id, visibility, template_id, owner_id, created_by)
  values (v_org, 'Lettre de remerciement – Donor', 'file', v_generated_path, 'application/pdf',
          v_staff_folder, 'organization', v_template, v_staff, v_staff)
  returning id into v_generated;
  perform public.set_document_text(v_generated,
    'Merci Donor pour votre don de 1 234,56 $. Cordialement.', 'generated');
  select count(*) into n from public.search_library('cordialement') where id = v_generated;
  perform tests.ok(n = 1, 'a generated document is saved in the library and found by its words');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.search_library('cordialement');
  perform tests.ok(n = 0, 'a generated staff-only document does not leak through search');

  perform tests.authenticate(v_admin, 'aal2');
  update public.document_template set archived_at = now() where id = v_template;
  perform tests.authenticate(v_staff, 'aal1');
  begin
    insert into public.document (organization_id, title, kind, url, template_id, owner_id, created_by)
    values (v_org, 'From archived', 'link', 'https://drive.google.com/file/d/y/view',
            v_template, v_staff, v_staff);
    raise exception 'FAIL: a document named an archived template';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a document cannot claim to come from an archived template');

  -- Audit and exposure -----------------------------------------------------------
  perform tests.clear_auth();
  reset role;
  select count(*) into n from public.audit_event
   where object_id = v_template and action = 'document_template_created' and actor_id = v_admin;
  perform tests.ok(n = 1, 'creating a template is audited with who did it');
  select count(*) into n from public.audit_event
   where object_id = v_template and action = 'document_template_archived';
  perform tests.ok(n = 1, 'archiving a template is audited');
  select count(*) into n from public.audit_event
   where object_id = v_generated and action = 'document_generated';
  perform tests.ok(n = 1, 'generating a document is audited');
  select position(chr(7) in content) into n from public.document_text where document_id = v_french_doc;
  perform tests.ok(n = 0, 'control characters are stripped from stored text');

  perform tests.ok(not has_function_privilege('anon',
    'public.search_library(text, boolean, boolean, integer)', 'execute'),
    'search is not granted to anonymous callers');
  perform tests.ok(not has_function_privilege('anon',
    'public.set_document_text(uuid, text, text)', 'execute'),
    'recording document text is not granted to anonymous callers');
  perform tests.ok(not has_table_privilege('authenticated', 'public.document_text', 'select'),
    'signed-in clients have no direct read on stored text');
end;
$$;

rollback;
