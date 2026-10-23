-- Entries members add to the audit trail.
--
-- Members could insert into public.audit_event directly. The insert policy
-- tied the row to the writer, but everything else in it was the writer's to
-- choose: the kind of event, the action, the object and the details. The
-- audit trail is the record of who exported or opened personal and financial
-- data, so an entry a member wrote by hand could not be told apart from one
-- the app wrote.
--
-- Now members cannot insert into audit_event at all. The app records a
-- person's own actions through public.record_audit_event, which takes the
-- actor from the session, the organization from the person's active
-- membership, the time from the clock, and accepts only the entries (kind
-- of event and action) the app records for people. Server code (the service role and definer
-- functions) keeps writing directly, for system entries.

drop policy if exists audit_member_insert on public.audit_event;
revoke insert, update, delete on public.audit_event from anon, authenticated;

create or replace function public.record_audit_event(
  p_organization_id uuid,
  p_event_type text,
  p_action text,
  p_object_type text default null,
  p_object_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'record_audit_event: not signed in' using errcode = '42501';
  end if;

  -- The organization is one the person is an active member of.
  select m.organization_id into v_org
  from public.organization_membership m
  where m.organization_id = p_organization_id and m.user_id = v_uid and m.status = 'active';
  if v_org is null then
    raise exception 'record_audit_event: not a member of this organization' using errcode = '42501';
  end if;

  -- Only the entries the app records for a person's own actions: each kind
  -- of event with its own actions, each about its own kind of record.
  -- Entries that database functions write (postings, access changes and
  -- the like) cannot be added this way, nor attached to another kind of
  -- record.
  if not exists (
    select 1 from (values
    ('access', 'user_invited', 'invitation'),
    ('access', 'invitation_link_reissued', 'invitation'),
    ('approval', 'rule_created', 'approval_rule'),
    ('approval', 'rule_deleted', 'approval_rule'),
    ('approval', 'rule_enabled', 'approval_rule'),
    ('approval', 'rule_disabled', 'approval_rule'),
    ('communication', 'announcement_published', 'announcement'),
    ('communication', 'channel_created', 'channel'),
    ('communication', 'channel_archived', 'channel'),
    ('communication', 'channel_restored', 'channel'),
    ('communication', 'message_pinned', 'message'),
    ('communication', 'message_deleted', 'message'),
    ('data_export', 'lens_exported', 'lens'),
    ('data_export', 'page_exported', 'page'),
    ('documents', 'document_uploaded', 'document'),
    ('documents', 'document_downloaded', 'document'),
    ('export', 'audit_log_exported', 'audit_event'),
    ('finance', 'aging_exported', 'organization'),
    ('finance', 'receipts_exported', 'finance_receipt'),
    ('finance', 'receipt_submitted', 'finance_receipt'),
    ('finance', 'receipt_reviewed', 'finance_receipt'),
    ('finance', 'receipt_reopened', 'finance_receipt'),
    ('finance', 'receipt_file_opened', 'finance_receipt'),
    ('forms', 'form_created', 'form_definition'),
    ('forms', 'form_updated', 'form_definition'),
    ('forms', 'form_draft_deleted', 'form_definition'),
    ('forms', 'form_published', 'form_definition'),
    ('forms', 'form_closed', 'form_definition'),
    ('forms', 'form_file_opened', 'form_file'),
    ('forms', 'form_submissions_exported', 'form_definition'),
    ('gifts', 'gift_list_viewed', 'organization'),
    ('gifts', 'acknowledgement_viewed', 'gift_acknowledgement'),
    ('gifts', 'acknowledgement_downloaded', 'gift_acknowledgement'),
    ('governance', 'retention_policy_saved', 'retention_policy'),
    ('governance', 'retention_policy_enabled', 'retention_policy'),
    ('governance', 'team_signal_settings_saved', 'team_signal_settings'),
    ('integration', 'integration_disconnected', 'integration_connection'),
    ('integration', 'vms_connected', 'integration_connection'),
    ('integration', 'zeffy_connected', 'integration_connection'),
    ('integration', 'zeffy_sync_requested', 'integration_connection'),
    ('ledger', 'receipt_file_opened', 'finance_receipt'),
    ('ledger', 'receipts_list_exported', 'organization'),
    ('ledger', 'general_ledger_exported', 'organization'),
    ('ledger', 'journal_import_exported', 'organization'),
    ('ledger', 'trial_balance_exported', 'organization'),
    ('ledger', 'trial_balance_import_exported', 'organization'),
    ('ledger', 'bank_reconciliation_exported', 'organization'),
    ('ledger', 'budget_report_exported', 'organization'),
    ('ledger', 'sales_tax_worksheet_exported', 'organization'),
    ('ledger', 'statement_of_operations_exported', 'organization'),
    ('ledger', 'statement_of_financial_position_exported', 'organization'),
    ('ledger', 'statement_of_changes_in_fund_balances_exported', 'organization'),
    ('project', 'stage_changed', 'project'),
    ('project', 'project_closed', 'project'),
    ('project', 'project_reassigned', 'project'),
    ('reporting', 'report_generated', 'report_instance'),
    ('reporting', 'report_regenerated', 'report_instance'),
    ('reporting', 'report_approved', 'report_version'),
    ('reporting', 'report_rejected', 'report_version'),
    ('reporting', 'report_exported_csv', 'report_instance'),
    ('reporting', 'report_exported_pdf', 'report_instance'),
    ('security', 'mfa_enrollment_completed', 'user_profile'),
    ('security', 'mfa_challenge_completed', 'user_profile'),
    ('security', 'mfa_factor_removed', 'user_profile'),
    ('signature', 'document_sent_for_signature', 'signing_document'),
    ('signature', 'signing_document_opened', 'signing_document')
    ) as allowed(event_type, action, object_type)
    where allowed.event_type = p_event_type and allowed.action = p_action
      and allowed.object_type = p_object_type
  ) then
    raise exception 'record_audit_event: not an entry people record' using errcode = '22023';
  end if;
  -- A person's security events are about their own profile.
  if p_event_type = 'security' and p_object_id is distinct from v_uid then
    raise exception 'record_audit_event: not an entry people record' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or octet_length(p_metadata::text) > 16384 then
    raise exception 'record_audit_event: invalid details' using errcode = '22023';
  end if;

  perform app_limits.count_insert('audit:record');

  insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action, result, object_type, object_id, metadata, created_at)
  values (v_org, v_uid, 'user', p_event_type, p_action, 'success', p_object_type, p_object_id, p_metadata, now())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_audit_event(uuid, text, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_audit_event(uuid, text, text, text, uuid, jsonb) to authenticated;

-- A person's entries are counted, so the trail cannot be flooded.
insert into app_limits.rule (action, max_count, window_seconds)
values ('audit:record', 600, 3600)
on conflict (action) do nothing;
