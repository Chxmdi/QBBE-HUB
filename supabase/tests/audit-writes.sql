-- Members cannot write audit rows themselves. A person's own actions are
-- recorded through public.record_audit_event, which takes the actor from the
-- session, the organization from the person's membership and the time from
-- the clock, and accepts only the entries the app records for people. Run after
-- qa-users.sql and rls.sql. Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_id uuid;
  v_state text;
  v_row public.audit_event;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner limit 1;

  -- A direct insert, even one naming the writer as its actor, is refused.
  perform tests.authenticate(v_volunteer, 'aal2');
  begin
    insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action, metadata)
    values (v_org, v_volunteer, 'user', 'finance', 'receipts_exported', '{"rows": 0}');
    v_state := 'stored';
  exception when insufficient_privilege then
    v_state := 'refused';
  end;
  perform tests.ok(v_state = 'refused', 'audit writes: a member cannot insert an audit row directly');

  -- Through the function: the actor, organization and time are the database's.
  v_id := public.record_audit_event(v_org, 'data_export', 'page_exported', 'page', gen_random_uuid(), '{"format": "md"}');
  perform tests.clear_auth();
  reset role;
  select * into v_row from public.audit_event where id = v_id;
  perform tests.ok(v_row.actor_id = v_volunteer and v_row.actor_type = 'user' and v_row.organization_id = v_org
      and v_row.event_type = 'data_export' and v_row.result = 'success'
      and v_row.created_at > now() - interval '1 minute' and v_row.metadata = '{"format": "md"}'::jsonb,
    'audit writes: the function records the caller as actor, in their organization, now');

  -- Refused: another organization, a kind of event the app does not record
  -- for people, a malformed action, oversized details, and a signed-out caller.
  perform tests.authenticate(v_volunteer, 'aal2');
  begin
    perform public.record_audit_event(gen_random_uuid(), 'finance', 'receipts_exported', 'finance_receipt');
    v_state := 'stored';
  exception when insufficient_privilege then
    v_state := 'refused';
  end;
  perform tests.ok(v_state = 'refused', 'audit writes: not in an organization the person is not a member of');

  begin
    perform public.record_audit_event(v_org, 'operations', 'unregistered_uploads_deleted');
    v_state := 'stored';
  exception when invalid_parameter_value then
    v_state := 'refused';
  end;
  perform tests.ok(v_state = 'refused', 'audit writes: only the kinds of event the app records for people');

  -- An entry database functions write, such as a ledger posting, cannot be
  -- added by a member even with a kind of event they may use.
  begin
    perform public.record_audit_event(v_org, 'ledger', 'entry_posted', 'journal_entry', gen_random_uuid());
    v_state := 'stored';
  exception when invalid_parameter_value then
    v_state := 'refused';
  end;
  perform tests.ok(v_state = 'refused', 'audit writes: a member cannot add a ledger posting to the trail');

  -- A real entry cannot be attached to another kind of record, such as a
  -- journal entry, where it would show in that entry's trail.
  begin
    perform public.record_audit_event(v_org, 'ledger', 'receipt_file_opened', 'journal_entry', gen_random_uuid());
    v_state := 'stored';
  exception when invalid_parameter_value then
    v_state := 'refused';
  end;
  perform tests.ok(v_state = 'refused', 'audit writes: each entry is about its own kind of record');

  -- A security event is about the person's own profile.
  begin
    perform public.record_audit_event(v_org, 'security', 'mfa_enrollment_completed', 'user_profile', v_owner);
    v_state := 'stored';
  exception when invalid_parameter_value then
    v_state := 'refused';
  end;
  perform tests.ok(v_state = 'refused', 'audit writes: a security event names the person''s own profile');

  begin
    perform public.record_audit_event(null, 'documents', 'document_downloaded', 'document', gen_random_uuid());
    v_state := 'stored';
  exception when insufficient_privilege then
    v_state := 'refused';
  end;
  perform tests.ok(v_state = 'refused', 'audit writes: an entry names its organization');

  begin
    perform public.record_audit_event(v_org, 'finance', 'Receipts exported by the treasurer');
    v_state := 'stored';
  exception when invalid_parameter_value then
    v_state := 'refused';
  end;
  perform tests.ok(v_state = 'refused', 'audit writes: an action is a short name, not free text');

  begin
    perform public.record_audit_event(v_org, 'finance', 'receipts_exported', 'finance_receipt', null,
      jsonb_build_object('note', repeat('x', 20000)));
    v_state := 'stored';
  exception when invalid_parameter_value then
    v_state := 'refused';
  end;
  perform tests.ok(v_state = 'refused', 'audit writes: the details are bounded in size');

  -- Counted against the person's limit.
  perform tests.clear_auth();
  reset role;
  update app_limits.rule set max_count = 1 where action = 'audit:record';
  perform tests.authenticate(v_owner, 'aal2');
  begin
    perform public.record_audit_event(v_org, 'documents', 'document_downloaded', 'document', gen_random_uuid());
    perform public.record_audit_event(v_org, 'documents', 'document_downloaded', 'document', gen_random_uuid());
    v_state := 'stored';
  exception when sqlstate 'RL429' then
    v_state := 'limited';
  end;
  perform tests.clear_auth();
  reset role;
  update app_limits.rule set max_count = 600 where action = 'audit:record';
  perform tests.ok(v_state = 'limited', 'audit writes: entries count against the person''s rate limit');

  -- Signed out: refused.
  begin
    perform public.record_audit_event(v_org, 'documents', 'document_downloaded', 'document', gen_random_uuid());
    v_state := 'stored';
  exception when insufficient_privilege then
    v_state := 'refused';
  end;
  perform tests.ok(v_state = 'refused', 'audit writes: a signed-out caller cannot write');

  -- A member who has been deactivated can no longer write.
  update public.organization_membership set status = 'deactivated' where user_id = v_volunteer and organization_id = v_org;
  perform tests.authenticate(v_volunteer, 'aal2');
  begin
    perform public.record_audit_event(v_org, 'documents', 'document_downloaded', 'document', gen_random_uuid());
    v_state := 'stored';
  exception when insufficient_privilege then
    v_state := 'refused';
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_state = 'refused', 'audit writes: a deactivated member cannot write');

  perform tests.ok(
    has_function_privilege('authenticated', 'public.record_audit_event(uuid, text, text, text, uuid, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.record_audit_event(uuid, text, text, text, uuid, jsonb)', 'execute')
      and not has_function_privilege('service_role', 'public.record_audit_event(uuid, text, text, text, uuid, jsonb)', 'execute')
      and not has_function_privilege('public', 'public.record_audit_event(uuid, text, text, text, uuid, jsonb)', 'execute')
      and not has_table_privilege('authenticated', 'public.audit_event', 'insert')
      and not has_table_privilege('anon', 'public.audit_event', 'insert')
      and has_table_privilege('service_role', 'public.audit_event', 'insert'),
    'audit writes: signed-in people use the function, nobody signed out does, server code writes directly');
end;
$$;

rollback;
