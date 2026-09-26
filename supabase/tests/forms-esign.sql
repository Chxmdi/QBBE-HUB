-- Forms and e-signatures (#145, #144; migration 20260927500000): who may
-- define, answer, read and sign, what the database records by itself, and
-- what nobody may change. Run after qa-users.sql and rls.sql. All mutations
-- are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_other_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_form uuid;
  v_staff_form uuid;
  v_sub uuid;
  v_sub2 uuid;
  v_doc uuid;
  v_path text;
  v_doc_path text;
  v_hash text;
  v_count integer;
  v_ok boolean;
  v_text text;
  v_fields jsonb := jsonb_build_array(
    jsonb_build_object('key', 'name', 'label', 'Participant name', 'type', 'text', 'required', true),
    jsonb_build_object('key', 'age', 'label', 'Age', 'type', 'number', 'required', false),
    jsonb_build_object('key', 'fee', 'label', 'Fee paid', 'type', 'money', 'required', false),
    jsonb_build_object('key', 'day', 'label', 'Date', 'type', 'date', 'required', true),
    jsonb_build_object('key', 'size', 'label', 'T-shirt', 'type', 'choice', 'required', false,
      'options', jsonb_build_array('S', 'M', 'L')),
    jsonb_build_object('key', 'agree', 'label', 'I agree', 'type', 'checkbox', 'required', true),
    jsonb_build_object('key', 'photo', 'label', 'Photo', 'type', 'file', 'required', false)
  );
  r record;
begin
  v_text := app.signature_consent_statement();
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_volunteer, v_other_staff);

  -- ---------------------------------------------------------------- forms
  -- Staff, volunteers and admins without MFA cannot define forms.
  for r in select * from (values (v_staff, 'aal2', 'staff'), (v_volunteer, 'aal2', 'a volunteer'),
                                 (v_admin, 'aal1', 'an admin without MFA')) as t(uid, lvl, who) loop
    perform tests.authenticate(r.uid, r.lvl);
    begin
      insert into public.form_definition (organization_id, title, fields)
      values (v_org, 'Nope', v_fields);
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    perform tests.clear_auth();
    reset role;
    perform tests.ok(v_ok, format('%s cannot define a form', r.who));
  end loop;

  perform tests.authenticate(v_admin, 'aal2');
  insert into public.form_definition (organization_id, title, audience, requires_signature, fields)
  values (v_org, 'Program registration', 'members', true, v_fields)
  returning id into v_form;
  perform tests.ok(v_form is not null, 'an admin with MFA defines a form');
  select created_by = v_admin and status = 'draft' into v_ok from public.form_definition where id = v_form;
  perform tests.ok(v_ok, 'the creator is recorded and the form starts as a draft');

  -- A malformed field list is refused by the database.
  begin
    insert into public.form_definition (organization_id, title, fields)
    values (v_org, 'Bad', jsonb_build_array(
      jsonb_build_object('key', 'a', 'label', 'A', 'type', 'choice', 'required', false)));
    perform tests.ok(false, 'a choice field without options is refused');
  exception when check_violation then
    perform tests.ok(true, 'a choice field without options is refused');
  end;
  begin
    insert into public.form_definition (organization_id, title, fields)
    values (v_org, 'Bad', jsonb_build_array(
      jsonb_build_object('key', 'a', 'label', 'A', 'type', 'text', 'required', false),
      jsonb_build_object('key', 'a', 'label', 'B', 'type', 'text', 'required', false)));
    perform tests.ok(false, 'duplicate field keys are refused');
  exception when check_violation then
    perform tests.ok(true, 'duplicate field keys are refused');
  end;
  begin
    insert into public.form_definition (organization_id, title, status, fields)
    values (v_org, 'Bad', 'published', v_fields);
    perform tests.ok(false, 'a form cannot be created already published');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a form cannot be created already published');
  end;

  insert into public.form_definition (organization_id, title, audience, fields)
  values (v_org, 'Incident report', 'staff', jsonb_build_array(
    jsonb_build_object('key', 'what', 'label', 'What happened', 'type', 'text', 'required', true)))
  returning id into v_staff_form;
  update public.form_definition set status = 'published' where id in (v_form, v_staff_form);
  select published_by = v_admin and published_at is not null into v_ok from public.form_definition where id = v_form;
  perform tests.ok(v_ok, 'publishing is recorded by the database');

  begin
    update public.form_definition set fields = '[]'::jsonb where id = v_form;
    perform tests.ok(false, 'a published form''s fields are frozen');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a published form''s fields are frozen');
  end;
  begin
    update public.form_definition set status = 'draft' where id = v_form;
    perform tests.ok(false, 'a published form cannot return to draft');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a published form cannot return to draft');
  end;
  perform tests.clear_auth();
  reset role;

  -- Audience: a volunteer sees the members form but not the staff one.
  perform tests.authenticate(v_volunteer, 'aal2');
  select count(*) into v_count from public.form_definition where id in (v_form, v_staff_form);
  perform tests.ok(v_count = 1, 'a volunteer sees published member forms only');
  begin
    insert into public.form_submission (form_id, organization_id, answers, content_sha256)
    values (v_staff_form, v_org, '{"what":"x"}'::jsonb, repeat('0', 64));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_ok, 'a volunteer cannot submit a staff-only form');

  -- ----------------------------------------------------------- submissions
  v_path := v_org::text || '/' || v_staff::text || '/' || gen_random_uuid()::text || '/photo.png';
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('form-files', v_path, v_staff::text, '{"size": 68, "mimetype": "image/png"}'::jsonb);
  insert into storage.objects (bucket_id, name, owner_id)
  values ('form-files', v_org::text || '/' || v_other_staff::text || '/theirs.png', v_other_staff::text);

  perform tests.authenticate(v_staff, 'aal1');
  -- Answers are checked against the fields.
  begin
    perform public.submit_form(v_form, '{"name":"Ana","day":"2026-10-01","agree":true}'::jsonb, 'Ana', false);
    perform tests.ok(false, 'a form that must be signed is refused without consent');
  exception when check_violation then
    perform tests.ok(true, 'a form that must be signed is refused without consent');
  end;
  begin
    perform public.submit_form(v_form, '{"name":"Ana","day":"2026-10-01"}'::jsonb, 'Ana', true);
    perform tests.ok(false, 'a required checkbox must be ticked');
  exception when check_violation then
    perform tests.ok(true, 'a required checkbox must be ticked');
  end;
  begin
    perform public.submit_form(v_form, '{"name":"Ana","day":"2026-10-01","agree":true,"fee":12.5}'::jsonb, 'Ana', true);
    perform tests.ok(false, 'money must be whole cents');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'money must be whole cents');
  end;
  begin
    perform public.submit_form(v_form, '{"name":"Ana","day":"2026-02-30","agree":true}'::jsonb, 'Ana', true);
    perform tests.ok(false, 'an impossible date is refused');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'an impossible date is refused');
  end;
  begin
    perform public.submit_form(v_form, '{"name":"Ana","day":"2026-10-01","agree":true,"size":"XL"}'::jsonb, 'Ana', true);
    perform tests.ok(false, 'a choice outside the options is refused');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'a choice outside the options is refused');
  end;
  begin
    perform public.submit_form(v_form, '{"name":"Ana","day":"2026-10-01","agree":true,"extra":"x"}'::jsonb, 'Ana', true);
    perform tests.ok(false, 'an answer to no field is refused');
  exception when invalid_parameter_value then
    perform tests.ok(true, 'an answer to no field is refused');
  end;
  begin
    perform public.submit_form(v_form, jsonb_build_object('name', 'Ana', 'day', '2026-10-01', 'agree', true,
      'photo', jsonb_build_object('path', v_org::text || '/' || v_other_staff::text || '/theirs.png', 'name', 'theirs.png')),
      'Ana', true);
    perform tests.ok(false, 'nobody attaches another person''s upload');
  exception when insufficient_privilege then
    perform tests.ok(true, 'nobody attaches another person''s upload');
  end;

  v_sub := public.submit_form(v_form, jsonb_build_object('name', '  Ana Tremblay ', 'age', 12,
    'fee', 4218, 'day', '2026-10-01', 'size', 'M', 'agree', true,
    'photo', jsonb_build_object('path', v_path, 'name', 'photo.png')), 'Ana Tremblay', true);
  perform tests.ok(v_sub is not null, 'staff submit a member form with a file and a signature');
  select submitted_by = v_staff and answers->>'name' = 'Ana Tremblay' and (answers->'fee')::bigint = 4218
    into v_ok from public.form_submission where id = v_sub;
  perform tests.ok(v_ok, 'the submitter and normalized answers are stored');

  -- The hash is the database's, and recomputes to the same value.
  select matches, recorded_sha256 into v_ok, v_hash from public.verify_form_submission(v_sub);
  perform tests.ok(v_ok and v_hash ~ '^[0-9a-f]{64}$', 'the submission hash verifies');

  select count(*) into v_count from public.signature
  where form_submission_id = v_sub and signer_id = v_staff and content_sha256 = v_hash
    and consent_statement = v_text and signer_email = 'qa-staff@example.com';
  perform tests.ok(v_count = 1, 'the signature records signer, email, consent wording and the submission hash');

  select count(*) into v_count from public.form_file
  where submission_id = v_sub and storage_path = v_path and scan_status = 'pending' and size_bytes = 68;
  perform tests.ok(v_count = 1, 'the attached file is registered, pending its scan');

  -- The same upload cannot be attached twice.
  begin
    perform public.submit_form(v_form, jsonb_build_object('name', 'B', 'day', '2026-10-01', 'agree', true,
      'photo', jsonb_build_object('path', v_path, 'name', 'photo.png')), 'B', true);
    perform tests.ok(false, 'an upload is attached to one submission only');
  exception when insufficient_privilege then
    perform tests.ok(true, 'an upload is attached to one submission only');
  end;

  -- Immutable: no update, no delete, no second signature, no changed signature.
  begin
    update public.form_submission set answers = '{}'::jsonb where id = v_sub;
    get diagnostics v_count = row_count;
    v_ok := v_count = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a submitter cannot change a submission');
  begin
    delete from public.form_submission where id = v_sub;
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.signature set signer_name = 'Someone else' where form_submission_id = v_sub;
    get diagnostics v_count = row_count;
    v_ok := v_count = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a signer cannot change a signature');
  begin
    insert into public.signature (organization_id, form_submission_id, signer_name, consent_given,
      consent_statement, content_sha256)
    values (v_org, v_sub, 'Again', true, '', repeat('0', 64));
    perform tests.ok(false, 'a record is signed once per signer');
  exception when unique_violation then
    perform tests.ok(true, 'a record is signed once per signer');
  end;
  -- The attached file cannot be downloaded before its scan, or deleted.
  select count(*) into v_count from storage.objects where bucket_id = 'form-files' and name = v_path;
  perform tests.ok(v_count = 0, 'a pending attachment cannot be downloaded');
  begin
    delete from storage.objects where bucket_id = 'form-files' and name = v_path;
    get diagnostics v_count = row_count;
    v_ok := v_count = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'a registered attachment cannot be deleted by its uploader');
  perform tests.clear_auth();
  reset role;

  -- Even the trusted role cannot rewrite a submission or a signature.
  begin
    update public.form_submission set answers = '{}'::jsonb where id = v_sub;
    perform tests.ok(false, 'nobody rewrites a submission');
  exception when insufficient_privilege then
    perform tests.ok(true, 'nobody rewrites a submission');
  end;
  begin
    update public.signature set signed_at = now() - interval '1 day' where form_submission_id = v_sub;
    perform tests.ok(false, 'nobody rewrites a signature');
  exception when insufficient_privilege then
    perform tests.ok(true, 'nobody rewrites a signature');
  end;
  select count(*) into v_count from public.form_submission where id = v_sub;
  perform tests.ok(v_count = 1, 'a submitter cannot delete a submission');

  select count(*) into v_count from public.audit_event
  where object_id = v_sub and ((action = 'form_submitted' and event_type = 'forms')
    or (action = 'signed' and event_type = 'signature'));
  perform tests.ok(v_count = 2, 'the submission and the signature are in the audit trail');

  -- Who reads it: not another staff member, not an admin without MFA; the
  -- admin with MFA does.
  for r in select * from (values (v_other_staff, 'aal2', 'another staff member'),
                                 (v_volunteer, 'aal2', 'a volunteer'),
                                 (v_admin, 'aal1', 'an admin without MFA')) as t(uid, lvl, who) loop
    perform tests.authenticate(r.uid, r.lvl);
    select count(*) into v_count from public.form_submission where id = v_sub;
    select v_count + count(*) into v_count from public.signature where form_submission_id = v_sub;
    select v_count + count(*) into v_count from public.form_file where submission_id = v_sub;
    perform tests.clear_auth();
    reset role;
    perform tests.ok(v_count = 0, format('%s cannot read someone else''s submission, signature or file', r.who));
  end loop;
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_count from public.form_submission where id = v_sub;
  select v_count + count(*) into v_count from public.signature where form_submission_id = v_sub;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_count = 2, 'an admin with MFA reads the submission and its signature');

  -- Once scanned clean the submitter may download the attachment.
  update public.form_file set scan_status = 'clean' where submission_id = v_sub;
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from storage.objects where bucket_id = 'form-files' and name = v_path;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_count = 1, 'the submitter downloads a clean attachment');

  -- Closing the form stops new submissions; the submitter still reads it.
  perform tests.authenticate(v_admin, 'aal2');
  update public.form_definition set status = 'closed' where id = v_form;
  perform tests.clear_auth();
  reset role;
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.form_definition where id = v_form;
  perform tests.ok(v_count = 1, 'a submitter still reads a closed form they answered');
  begin
    perform public.submit_form(v_form, '{"name":"Late","day":"2026-10-01","agree":true}'::jsonb, 'Late', true);
    perform tests.ok(false, 'a closed form takes no submissions');
  exception when insufficient_privilege or foreign_key_violation then
    perform tests.ok(true, 'a closed form takes no submissions');
  end;
  perform tests.clear_auth();
  reset role;

  -- A form that does not require a signature still takes one submission row only.
  perform tests.authenticate(v_staff, 'aal1');
  v_sub2 := public.submit_form(v_staff_form, '{"what":"Slip on stairs"}'::jsonb);
  select count(*) into v_count from public.signature where form_submission_id = v_sub2;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_sub2 is not null and v_count = 0, 'an unsigned form is submitted without a signature');

  -- ------------------------------------------------- documents for signature
  v_doc_path := v_org::text || '/' || v_admin::text || '/' || gen_random_uuid()::text || '/agreement.pdf';
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('signing-documents', v_doc_path, v_admin::text, '{"size": 1000, "mimetype": "application/pdf"}'::jsonb);

  -- Staff cannot send documents for signature.
  insert into storage.objects (bucket_id, name, owner_id)
  values ('signing-documents', v_org::text || '/' || v_staff::text || '/s.pdf', v_staff::text);
  perform tests.authenticate(v_staff, 'aal2');
  begin
    insert into public.signing_document (organization_id, title, storage_path, file_name)
    values (v_org, 'X', v_org::text || '/' || v_staff::text || '/s.pdf', 's.pdf');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_ok, 'staff cannot send a document for signature');

  perform tests.authenticate(v_admin, 'aal2');
  begin
    insert into public.signing_document (organization_id, title, storage_path, file_name, content_sha256)
    values (v_org, 'Volunteer agreement', v_doc_path, 'agreement.pdf', repeat('a', 64));
    perform tests.ok(false, 'an uploader cannot supply the file hash');
  exception when insufficient_privilege then
    perform tests.ok(true, 'an uploader cannot supply the file hash');
  end;
  insert into public.signing_document (organization_id, title, storage_path, file_name)
  values (v_org, 'Volunteer agreement', v_doc_path, 'agreement.pdf')
  returning id into v_doc;
  insert into public.signing_document_signer (document_id, organization_id, user_id)
  values (v_doc, v_org, v_volunteer), (v_doc, v_org, v_staff);
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_doc is not null, 'an admin with MFA sends a document to two signers');

  -- Not signable before the scan has passed and the hash is recorded.
  perform tests.authenticate(v_volunteer, 'aal2');
  begin
    insert into public.signature (organization_id, signing_document_id, signer_name, consent_given,
      consent_statement, content_sha256)
    values (v_org, v_doc, 'Val', true, '', repeat('0', 64));
    perform tests.ok(false, 'a document cannot be signed before its scan');
  exception when object_not_in_prerequisite_state then
    perform tests.ok(true, 'a document cannot be signed before its scan');
  end;
  perform tests.clear_auth();
  reset role;

  -- The job records the hash once; it can never change afterwards.
  update public.signing_document set scan_status = 'clean', content_sha256 = repeat('b', 64) where id = v_doc;
  begin
    update public.signing_document set content_sha256 = repeat('c', 64) where id = v_doc;
    perform tests.ok(false, 'a document''s hash never changes');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a document''s hash never changes');
  end;

  -- Someone not asked to sign cannot sign or read it.
  perform tests.authenticate(v_other_staff, 'aal2');
  select count(*) into v_count from public.signing_document where id = v_doc;
  begin
    insert into public.signature (organization_id, signing_document_id, signer_name, consent_given,
      consent_statement, content_sha256)
    values (v_org, v_doc, 'Other', true, '', repeat('0', 64));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_count = 0 and v_ok, 'someone not asked to sign can neither read nor sign the document');

  -- Consent is required.
  perform tests.authenticate(v_volunteer, 'aal2');
  begin
    insert into public.signature (organization_id, signing_document_id, signer_name, consent_given,
      consent_statement, content_sha256)
    values (v_org, v_doc, 'Val', false, '', repeat('0', 64));
    perform tests.ok(false, 'a signature without consent is refused');
  exception when check_violation then
    perform tests.ok(true, 'a signature without consent is refused');
  end;
  -- A signer reads and signs; the hash comes from the document, not the request.
  select count(*) into v_count from public.signing_document where id = v_doc;
  perform tests.ok(v_count = 1, 'a signer reads the document');
  insert into public.signature (organization_id, signing_document_id, signer_id, signer_name,
    consent_given, consent_statement, content_sha256, signed_at)
  values (v_org, v_doc, v_owner, 'Val Volunteer', true, 'I agree to nothing', repeat('f', 64),
    now() - interval '10 days');
  perform tests.clear_auth();
  reset role;
  select signer_id = v_volunteer and content_sha256 = repeat('b', 64)
    and consent_statement = app.signature_consent_statement() and signed_at > now() - interval '1 minute'
    into v_ok from public.signature where signing_document_id = v_doc and signer_name = 'Val Volunteer';
  perform tests.ok(v_ok, 'signer, hash, consent wording and time are set by the database');

  -- The other signer sees who has signed so far; the file downloads once clean.
  perform tests.authenticate(v_staff, 'aal2');
  select count(*) into v_count from public.signature where signing_document_id = v_doc;
  perform tests.ok(v_count = 1, 'a co-signer sees the signatures on the document');
  select count(*) into v_count from storage.objects where bucket_id = 'signing-documents' and name = v_doc_path;
  perform tests.ok(v_count = 1, 'a signer downloads the clean document');
  begin
    delete from storage.objects where bucket_id = 'signing-documents' and name = v_doc_path;
    get diagnostics v_count = row_count;
    v_ok := v_count = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_ok, 'a document sent for signature cannot be deleted from storage');

  -- An admin cannot add a non-member as a signer.
  perform tests.authenticate(v_admin, 'aal2');
  begin
    insert into public.signing_document_signer (document_id, organization_id, user_id)
    values (v_doc, v_org, gen_random_uuid());
    perform tests.ok(false, 'signers must be members');
  exception when check_violation or foreign_key_violation then
    perform tests.ok(true, 'signers must be members');
  end;
  perform tests.clear_auth();
  reset role;

  -- Signed out: nothing.
  set local role anon;
  begin
    select count(*) into v_count from public.form_definition;
    select v_count + count(*) into v_count from public.signature;
    v_ok := v_count = 0;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  perform tests.ok(v_ok, 'anon reads no forms or signatures');
end
$$;

rollback;
