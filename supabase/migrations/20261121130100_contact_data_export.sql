-- The personal-data export covers every table that names the person, and an
-- export for one CRM contact exists (PRIV-015).
--
-- 1. app.person_data_registry lists every column that names a person (a
--    reference to auth.users or user_profile, or an email address) and every
--    column that names a CRM contact, with how its rows are exported or why
--    they are not. supabase/tests/person-export-registry.sql compares it with
--    app.person_reference_columns(), so a new table naming a person fails the
--    tests until it is listed here.
-- 2. public.person_data_export and public.contact_data_export build the
--    registry's sections for one organization. Only the export job (service
--    role) may call them. A person's sections carry identifying and
--    timestamp columns (plus listed ones such as what they wrote), never a
--    whole row, so no token or secret leaves with them. A contact's sections
--    carry the whole row, except where the row is someone's private item
--    (captured email) or export bookkeeping, and sensitive notes follow their
--    read rule. Only MFA-verified owners and admins may ask for a contact
--    export. Three columns that name a person without a foreign key
--    (audit_event.actor_id, activity_entry.actor_id, team.owner_id) are
--    listed too.
-- 3. export_job gains subject_contact_id, and export_job_request lets
--    MFA-verified owners and admins (app.is_org_admin) ask for a contact
--    export of a contact of their own organization. The request is audited
--    with the contact it names.

create table app.person_data_registry (
  subject text not null check (subject in ('person', 'contact')),
  table_name text not null,
  column_name text not null,
  -- How the column names the subject: its id, or its email address.
  match text check (match in ('id', 'email')),
  -- How rows are kept to one organization: the table's own organization_id,
  -- the organization of the parent row the table belongs to, or none for a
  -- person's own settings.
  scope text check (scope in ('organization', 'parent', 'person')),
  parent_table text,
  parent_column text,
  -- Columns copied beyond the identifying and timestamp ones (person
  -- exports); null copies the whole row (contact exports).
  columns text[],
  excluded_reason text,
  primary key (subject, table_name, column_name),
  check ((excluded_reason is null) = (match is not null and scope is not null)),
  check ((scope = 'parent') = (parent_table is not null and parent_column is not null))
);
alter table app.person_data_registry enable row level security;
revoke all on table app.person_data_registry from public, anon, authenticated, service_role;

insert into app.person_data_registry
  (subject, table_name, column_name, match, scope, parent_table, parent_column, columns, excluded_reason)
values
  ('person', 'access_grant', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'access_grant', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'access_role', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'activity_event', 'actor_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'agenda_item', 'owner_id', 'id', 'parent', 'meeting', 'meeting_id', '{}'::text[], null),
  ('person', 'agenda_item', 'proposed_by', 'id', 'parent', 'meeting', 'meeting_id', '{}'::text[], null),
  ('person', 'agenda_template', 'approved_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'agenda_template', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'announcement', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'announcement_acknowledgment', 'user_id', 'id', 'parent', 'announcement', 'announcement_id', '{}'::text[], null),
  ('person', 'api_request_log', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'api_token', 'revoked_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'api_token', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_delegation', 'approver_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_delegation', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_delegation', 'delegate_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_delegation', 'ended_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_event', 'actor_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_event', 'on_behalf_of', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_item', 'decided_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_item', 'requested_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_request', 'approver_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_request', 'decided_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_request', 'requested_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_rule', 'approver_user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_rule', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_step', 'approver_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_step', 'decided_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approval_step', 'on_behalf_of', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'approved_document_host', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'bank_account', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'bank_import', 'imported_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'bank_match', 'matched_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'bank_reconciliation', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'bank_reconciliation', 'reconciled_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'blueprint', 'approved_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'blueprint', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'blueprint', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'blueprint_build', 'built_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'blueprint_build', 'undone_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'budget', 'approved_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'budget', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'calendar_event_link', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'capture_forward', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'capture_item', 'email_from', 'email', 'organization', null, null, '{}'::text[], null),
  ('person', 'capture_item', 'email_subject', null, null, null, null, null, 'The subject line of a captured email, not an address; the capture is exported through owner_id.'),
  ('person', 'capture_item', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'channel', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'channel', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'channel_access_grant', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'channel_access_grant', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'channel_member', 'user_id', 'id', 'parent', 'channel', 'channel_id', '{}'::text[], null),
  ('person', 'conversation', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'conversation_member', 'user_id', 'id', 'parent', 'conversation', 'conversation_id', '{}'::text[], null),
  ('person', 'crm_agreement', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'crm_contact', 'email', 'email', 'organization', null, null, '{}'::text[], null),
  ('person', 'crm_contact', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'crm_follow_up', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'crm_interaction', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'crm_organization', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'crm_organization', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'crm_sensitive_note', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'decision', 'decided_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'decision_participant', 'added_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'decision_participant', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'decision_request', 'assignee_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'decision_request', 'requester_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'document', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'document', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'document_acknowledgement', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'document_folder', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'document_template', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'document_template', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'document_text', 'recorded_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'editor_document', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'editor_document', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'editor_operation', 'actor_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'email_delivery', 'recipient_user_id', 'id', 'organization', null, null, array['subject', 'sent_at']::text[], null),
  ('person', 'event', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'event', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'event_assignment', 'user_id', 'id', 'parent', 'event', 'event_id', '{}'::text[], null),
  ('person', 'export_job', 'requested_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'export_job', 'subject_user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'finance_bill', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'finance_bill', 'posted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'finance_contact', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'finance_contact', 'email', 'email', 'organization', null, null, '{}'::text[], null),
  ('person', 'finance_invoice', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'finance_invoice', 'posted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'finance_payment', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'finance_receipt', 'reviewed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'finance_receipt', 'submitted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'follow_rule_v2', 'email', 'email', 'organization', null, null, '{}'::text[], null),
  ('person', 'follow_rule_v2', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'follow_v2', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'form_definition', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'form_definition', 'published_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'form_submission', 'submitted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'form_v2', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'form_v2_response', 'submitted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'gift', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'gift', 'voided_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'gift_acknowledgement', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'gift_acknowledgement', 'email_error', null, null, null, null, null, 'Delivery error text of an acknowledgement email, not an email address.'),
  ('person', 'gift_acknowledgement', 'email_status', null, null, null, null, null, 'Delivery status of an acknowledgement email, not an email address.'),
  ('person', 'gift_acknowledgement', 'recipient_email', 'email', 'organization', null, null, '{}'::text[], null),
  ('person', 'gmail_message', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'goal', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'goal', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'grant_award', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'grant_award', 'responsible_user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'grant_report', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'home_visit', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'integration_connection', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'invitation', 'email', 'email', 'organization', null, null, '{}'::text[], null),
  ('person', 'invitation', 'invited_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'issue', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'issue', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'journal_entry', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'journal_entry', 'posted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_accountant_grant', 'granted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_accountant_grant', 'revoked_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_accountant_grant', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_accountant_session', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_fund_release', 'released_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_period', 'closed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_reader', 'granted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_reader', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_settings', 'chart_approval_recorded_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_year_close', 'closed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'ledger_year_close', 'reopened_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'legal_hold', 'placed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'legal_hold', 'released_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'lens', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'lens_column_setting', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'lens_totals_setting', 'user_id', 'id', 'person', null, null, '{}'::text[], null),
  ('person', 'lens_viewer_setting', 'user_id', 'id', 'parent', 'lens', 'lens_id', '{}'::text[], null),
  ('person', 'meeting', 'organizer_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'meeting_action', 'owner_id', 'id', 'parent', 'meeting', 'meeting_id', '{}'::text[], null),
  ('person', 'meeting_attendee', 'user_id', 'id', 'parent', 'meeting', 'meeting_id', '{}'::text[], null),
  ('person', 'meeting_capture', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'meeting_capture', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'meeting_capture', 'reviewed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'message', 'author_id', 'id', 'organization', null, null, array['channel_id', 'body']::text[], null),
  ('person', 'message_mention', 'mentioned_user_id', 'id', 'parent', 'message', 'message_id', '{}'::text[], null),
  ('person', 'message_reaction', 'user_id', 'id', 'parent', 'message', 'message_id', '{}'::text[], null),
  ('person', 'milestone', 'owner_id', 'id', 'parent', 'project', 'project_id', '{}'::text[], null),
  ('person', 'notification', 'user_id', 'id', 'organization', null, null, array['category', 'read_at']::text[], null),
  ('person', 'notification_preference', 'user_id', 'id', 'person', null, null, '{}'::text[], null),
  ('person', 'object', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object_approval', 'requested_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object_layout', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object_lock', 'locked_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object_presence', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object_relation', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object_suggestion', 'author_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object_suggestion', 'decided_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object_trash', 'deleted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object_trash', 'restored_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'object_version', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'opportunity', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'opportunity', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'organization_membership', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'outcome_measurement', 'recorded_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'outcome_metric', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'outcome_metric', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'page', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'page', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'page_favourite', 'user_id', 'id', 'parent', 'page', 'page_id', '{}'::text[], null),
  ('person', 'page_presence', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'page_template_origin', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'page_visit', 'user_id', 'id', 'parent', 'page', 'page_id', '{}'::text[], null),
  ('person', 'page_watch', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'payroll_account_map', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'payroll_run', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'payroll_run', 'posted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'payroll_run', 'reversed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'pinned_resource', 'pinned_by', 'id', 'parent', 'channel', 'channel_id', '{}'::text[], null),
  ('person', 'privacy_notice_acknowledgement', 'user_id', 'id', 'person', null, null, '{}'::text[], null),
  ('person', 'program', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'program', 'lead_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'program_access_grant', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'program_access_grant', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'program_membership', 'user_id', 'id', 'parent', 'program', 'program_id', '{}'::text[], null),
  ('person', 'program_operation', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'program_operation', 'led_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'program_team_assignment', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'program_template', 'approved_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'program_template', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project', 'sponsor_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project_access_grant', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project_access_grant', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project_closure', 'closed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project_membership', 'user_id', 'id', 'parent', 'project', 'project_id', '{}'::text[], null),
  ('person', 'project_request', 'decided_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project_request', 'requested_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project_request', 'sponsor_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project_status_update', 'author_id', 'id', 'parent', 'project', 'project_id', '{}'::text[], null),
  ('person', 'project_team_assignment', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project_template', 'approved_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'project_template', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'property_value', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'publication', 'requested_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'publication', 'reviewed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'publication', 'unpublished_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'record_comment', 'author_id', 'id', 'organization', null, null, array['body']::text[], null),
  ('person', 'record_comment', 'deleted_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'record_comment', 'resolved_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'record_comment_reaction', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'record_retention_rule', 'confirmed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'record_retention_rule', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'record_retention_setting', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'record_template', 'approved_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'record_template', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'report_approval', 'decided_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'report_instance', 'approved_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'report_instance', 'generated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'report_version', 'generated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'retention_policy', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'retention_policy', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'risk', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'risk', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'sales_tax_line', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'sales_tax_period', 'closed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'sales_tax_period', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'sales_tax_settings', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'saved_message', 'user_id', 'id', 'parent', 'message', 'message_id', '{}'::text[], null),
  ('person', 'saved_view', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'scoped_access_backfill_issue', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'sign_in_rule', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'signature', 'signer_email', 'email', 'organization', null, null, '{}'::text[], null),
  ('person', 'signature', 'signer_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'signing_document', 'uploaded_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'signing_document_signer', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'space', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'space', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'synced_block', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'synced_block', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'synced_block_access_request', 'decided_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'synced_block_access_request', 'requester_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'task', 'approver_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'task', 'assignee_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'task', 'blocked_by_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'task', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'task', 'requester_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'task', 'reviewer_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'task_assignment', 'user_id', 'id', 'parent', 'task', 'task_id', '{}'::text[], null),
  ('person', 'task_comment', 'author_id', 'id', 'parent', 'task', 'task_id', array['body']::text[], null),
  ('person', 'task_series', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'team_member', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'team_signal', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'team_signal_settings', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'template_v2', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'template_v2_version', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'upkeep_review', 'reviewed_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'user_profile', 'email', null, null, null, null, null, 'The profile section (user_profile.id) carries the address already.'),
  ('person', 'user_profile', 'id', 'id', 'person', null, null, array['full_name', 'email', 'title', 'timezone']::text[], null),
  ('person', 'vms_assignment_reference', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'workflow_review', 'reviewer_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'workflow_rule', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'workflow_rule', 'run_as_user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'workflow_rule', 'stopped_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'workflow_rule', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'workspace_app', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'workspace_app', 'updated_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'workspace_app_grant', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'workspace_app_grant', 'user_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'zeffy_contact_match', 'email', 'email', 'organization', null, null, '{}'::text[], null),
  ('person', 'zeffy_suppressed_contact', 'created_by', 'id', 'organization', null, null, '{}'::text[], null),
  ('person', 'zeffy_suppressed_contact', 'email_sha256', null, null, null, null, null, 'An unsalted hash of a removed donor''s address, kept only so they are not imported again; leaving it out keeps the export from re-identifying them.'),
  ('contact', 'crm_interaction', 'contact_id', 'id', 'organization', null, null, null, null),
  ('contact', 'crm_follow_up', 'contact_id', 'id', 'organization', null, null, null, null),
  ('contact', 'opportunity', 'contact_id', 'id', 'organization', null, null, null, null),
  ('person', 'audit_event', 'actor_id', 'id', 'organization', null, null, array['event_type', 'action', 'object_type']::text[], null),
  ('person', 'activity_entry', 'actor_id', 'id', 'organization', null, null, array['object_type']::text[], null),
  ('person', 'team', 'owner_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('contact', 'agenda_item', 'linked_contact_id', 'id', 'parent', 'meeting', 'meeting_id', null, null),
  ('contact', 'crm_agreement', 'contact_id', 'id', 'organization', null, null, null, null),
  ('contact', 'gift', 'crm_contact_id', 'id', 'organization', null, null, null, null),
  ('contact', 'grant_award', 'funder_contact_id', 'id', 'organization', null, null, null, null),
  ('contact', 'gift_acknowledgement', 'crm_contact_id', 'id', 'organization', null, null, null, null),
  ('contact', 'crm_sensitive_note', 'crm_contact_id', 'id', 'organization', null, null, null, null),
  ('contact', 'crm_link', 'contact_id', 'id', 'organization', null, null, null, null),
  ('contact', 'export_job', 'subject_contact_id', 'id', 'organization', null, null, '{}'::text[], null),
  ('contact', 'finance_contact', 'email', 'email', 'organization', null, null, null, null),
  ('contact', 'gift_acknowledgement', 'recipient_email', 'email', 'organization', null, null, null, null),
  ('contact', 'zeffy_contact_match', 'email', 'email', 'organization', null, null, null, null),
  ('contact', 'capture_item', 'email_from', 'email', 'organization', null, null, '{}'::text[], null),
  ('contact', 'signature', 'signer_email', 'email', 'organization', null, null, null, null);

-- Every public column that names a person, an email address or a CRM contact.
create or replace function app.person_reference_columns()
returns table (table_name text, column_name text, kind text)
language sql
stable
set search_path = ''
as $$
  select distinct t.relname::text, a.attname::text,
    case when c.confrelid = 'public.crm_contact'::regclass then 'contact' else 'user' end
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  join pg_catalog.pg_class t on t.oid = c.conrelid
  where c.contype = 'f'
    and t.relnamespace = 'public'::regnamespace
    and c.confrelid in ('auth.users'::regclass, 'public.user_profile'::regclass, 'public.crm_contact'::regclass)
  union
  select col.table_name::text, col.column_name::text, 'email'
  from information_schema.columns col
  join information_schema.tables tab on tab.table_schema = col.table_schema and tab.table_name = col.table_name
  where col.table_schema = 'public' and tab.table_type = 'BASE TABLE'
    and col.column_name ~ 'email'
    and col.data_type in ('text', 'character varying', 'USER-DEFINED');
$$;
revoke all on function app.person_reference_columns() from public, anon, authenticated;
grant execute on function app.person_reference_columns() to service_role;

-- The rows of one registry section, as a JSON array.
create or replace function app.registry_section(
  p_entry app.person_data_registry,
  p_organization uuid,
  p_id uuid,
  p_email text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_columns text;
  v_where text;
  v_rows jsonb;
begin
  if p_entry.match = 'email' and p_email is null then
    return '[]'::jsonb;
  end if;

  if p_entry.columns is null then
    v_columns := 't.*';
  else
    select string_agg(format('t.%I', c.column_name), ', ' order by c.ordinal_position) into v_columns
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = p_entry.table_name
      and (c.column_name in ('id', 'created_at', 'updated_at', 'title', 'name', 'status', 'role')
        or c.column_name = p_entry.column_name
        or c.column_name = p_entry.parent_column
        or c.column_name = any (p_entry.columns));
  end if;

  v_where := case p_entry.match
    when 'id' then format('t.%I = $1', p_entry.column_name)
    else format('lower(t.%I::text) = lower($2)', p_entry.column_name)
  end;
  v_where := v_where || case p_entry.scope
    when 'organization' then ' and t.organization_id = $3'
    when 'parent' then format(' and exists (select 1 from public.%I p where p.id = t.%I and p.organization_id = $3)',
      p_entry.parent_table, p_entry.parent_column)
    else ''
  end;

  execute format('select coalesce(jsonb_agg(to_jsonb(s)), ''[]''::jsonb) from (select %s from public.%I t where %s) s',
    v_columns, p_entry.table_name, v_where)
    into v_rows using p_id, p_email, p_organization;
  return v_rows;
end;
$$;
revoke all on function app.registry_section(app.person_data_registry, uuid, uuid, text) from public, anon, authenticated;

-- Everything one organization holds that names a person, by registry section.
create or replace function public.person_data_export(p_organization uuid, p_subject uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_entry app.person_data_registry;
  v_out jsonb := '{}'::jsonb;
begin
  if not exists (
    select 1 from public.organization_membership
    where organization_id = p_organization and user_id = p_subject
  ) then
    raise exception 'export subject does not belong to this organization' using errcode = '22023';
  end if;
  select email into v_email from public.user_profile where id = p_subject;

  for v_entry in
    select * from app.person_data_registry
    where subject = 'person' and excluded_reason is null
    order by table_name, column_name
  loop
    v_out := v_out || jsonb_build_object(v_entry.table_name || '.' || v_entry.column_name,
      app.registry_section(v_entry, p_organization, p_subject, v_email));
  end loop;
  return v_out;
end;
$$;
revoke all on function public.person_data_export(uuid, uuid) from public, anon, authenticated;
grant execute on function public.person_data_export(uuid, uuid) to service_role;

-- Everything one organization holds about one CRM contact.
create or replace function public.contact_data_export(p_organization uuid, p_contact uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact jsonb;
  v_entry app.person_data_registry;
  v_out jsonb;
begin
  select to_jsonb(c) into v_contact from public.crm_contact c
  where c.id = p_contact and c.organization_id = p_organization;
  if v_contact is null then
    raise exception 'export subject does not belong to this organization' using errcode = '22023';
  end if;
  v_out := jsonb_build_object('crm_contact.id', jsonb_build_array(v_contact));

  for v_entry in
    select * from app.person_data_registry
    where subject = 'contact' and excluded_reason is null
    order by table_name, column_name
  loop
    -- Sensitive notes follow their read rule: a contact nobody owns has none
    -- that anyone, administrators included, may read.
    if v_entry.table_name = 'crm_sensitive_note' and v_contact ->> 'owner_id' is null then
      continue;
    end if;
    v_out := v_out || jsonb_build_object(v_entry.table_name || '.' || v_entry.column_name,
      app.registry_section(v_entry, p_organization, p_contact, v_contact ->> 'email'));
  end loop;
  return v_out;
end;
$$;
revoke all on function public.contact_data_export(uuid, uuid) from public, anon, authenticated;
grant execute on function public.contact_data_export(uuid, uuid) to service_role;

-- 3. Requests.
alter table public.export_job
  add column subject_contact_id uuid references public.crm_contact(id) on delete set null;
-- Inserts are granted column by column (20261119100000_explicit_api_grants).
grant insert (subject_contact_id) on table public.export_job to authenticated;

drop policy export_job_request on public.export_job;
create policy export_job_request on public.export_job
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and status = 'queued'::public.export_status
    and storage_path is null and started_at is null and completed_at is null
    and download_count = 0 and downloaded_at is null
    and (
      (app.is_org_admin(organization_id)
        and kind = any (array['organization_data', 'person_data', 'contact_data']::public.export_kind[]))
      or (app.is_org_staff(organization_id)
        and kind = any (array['crm_contacts', 'task_history', 'report_bundle']::public.export_kind[]))
    )
    and (
      (kind <> all (array['person_data', 'contact_data']::public.export_kind[])
        and subject_user_id is null and subject_contact_id is null)
      or (kind = 'person_data'::public.export_kind and subject_contact_id is null
        and exists (
          select 1 from public.organization_membership m
          where m.organization_id = export_job.organization_id and m.user_id = export_job.subject_user_id))
      or (kind = 'contact_data'::public.export_kind and subject_user_id is null
        and exists (
          select 1 from public.crm_contact c
          where c.id = export_job.subject_contact_id and c.organization_id = export_job.organization_id))
    )
  );

create or replace function app.audit_export_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id, metadata
  ) values (
    new.organization_id, new.requested_by, 'data_export', 'export_requested',
    'export_job', new.id,
    jsonb_build_object('kind', new.kind, 'subject_user_id', new.subject_user_id,
      'subject_contact_id', new.subject_contact_id)
  );
  return new;
end;
$$;
revoke all on function app.audit_export_request() from public, anon, authenticated;
