-- Basic deny cases for tables no other file in this suite touched: who must
-- not read a row, and who must not write one. Run after qa-users.sql and
-- rls.sql (which defines tests.refused_ok). Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_event uuid;
  v_connection uuid;
  v_empty_connection uuid;
  v_notification uuid;
  v_message uuid;
  v_channel uuid;
  v_table text;
  n integer;
begin
  select organization_id into strict v_org
  from organization_membership m
  where m.user_id = v_owner
    and exists (select 1 from organization_membership p where p.organization_id = m.organization_id and p.user_id = v_guest)
    and exists (select 1 from organization_membership p where p.organization_id = m.organization_id and p.user_id = v_volunteer);

  -- One row in each, written as the database owner.
  insert into agenda_template (organization_id, name, kind) values (v_org, 'Deny agenda', 'meeting');
  insert into crm_follow_up (organization_id, owner_id, title, due_at) values (v_org, v_owner, 'Deny follow-up', current_date + 7);
  insert into crm_interaction (organization_id, owner_id, summary) values (v_org, v_owner, 'Deny interaction');
  insert into event (organization_id, name, starts_at) values (v_org, 'Deny event', now() + interval '7 days')
    returning id into v_event;
  insert into event_checklist_item (event_id, title) values (v_event, 'Deny checklist item');
  insert into finance_billing_settings (organization_id) values (v_org) on conflict do nothing;
  insert into integration_connection (organization_id, user_id, provider, status)
    values (v_org, v_owner, 'deny-test', 'connected') returning id into v_connection;
  insert into integration_secret (connection_id) values (v_connection);
  -- A second connection without a secret, so a guest insert that got through
  -- would fail as a refusal that did not happen, not as a duplicate key.
  insert into integration_connection (organization_id, user_id, provider, status)
    values (v_org, v_owner, 'deny-test-2', 'connected') returning id into v_empty_connection;
  insert into ledger_accountant_session (organization_id, session_id, user_id) values (v_org, 'deny-session', v_owner);
  insert into notification (user_id, organization_id, category, title)
    values (v_owner, v_org, 'mention', 'Deny notice') returning id into v_notification;
  insert into notification_delivery (notification_id, dedupe_key) values (v_notification, 'deny-' || v_notification);
  select id into strict v_channel from channel
  where organization_id = v_org and type = 'announcements' and is_mandatory limit 1;
  insert into message (organization_id, channel_id, author_id, body)
    values (v_org, v_channel, v_owner, 'Deny message') returning id into v_message;
  insert into message_reaction (message_id, user_id, emoji) values (v_message, v_owner, '👍');
  insert into record_retention_report (organization_id) values (v_org);
  insert into scoped_access_backfill_issue (organization_id, scope_type, scope_id, reason)
    values (v_org, 'project', gen_random_uuid(), 'Deny issue');
  insert into vms_assignment_reference (organization_id, user_id, external_assignment_id, title)
    values (v_org, v_owner, 'deny-assignment', 'Deny assignment');

  -- Signed out: nothing at all. The inserts are all-null rows, so they only
  -- catch a table left writable by anyone; the signed-in cases below are the
  -- ones that test real values.
  perform tests.clear_auth();
  set local role anon;
  foreach v_table in array array[
    'agenda_template', 'crm_follow_up', 'crm_interaction', 'event_checklist_item', 'finance_billing_settings',
    'finance_invoice_line', 'integration_secret', 'ledger_accountant_session', 'message_reaction',
    'notification_delivery', 'pinned_resource', 'record_retention_report', 'scoped_access_backfill_issue',
    'vms_assignment_reference'
  ] loop
    begin
      execute format('select count(*) from public.%I', v_table) into n;
    exception when insufficient_privilege then
      n := 0;
    end;
    perform tests.ok(n = 0, format('signed out, %s shows no rows', v_table));
    perform tests.refused_ok(format('insert into public.%I default values', v_table),
      format('signed out, nothing can be added to %s', v_table));
  end loop;
  perform tests.refused_ok($q$update public.retention_subject set default_days = 1$q$,
    'signed out, the retention rules cannot be changed');
  reset role;

  -- A guest: a member, but none of these are theirs to read or write.
  perform tests.authenticate(v_guest, 'aal1');
  foreach v_table in array array[
    'crm_follow_up', 'crm_interaction', 'finance_billing_settings', 'integration_secret',
    'ledger_accountant_session', 'notification_delivery', 'record_retention_report',
    'scoped_access_backfill_issue', 'vms_assignment_reference'
  ] loop
    execute format('select count(*) from public.%I', v_table) into n;
    perform tests.ok(n = 0, format('a guest reads no %s rows', v_table));
  end loop;
  perform tests.refused_ok(format($q$insert into agenda_template (organization_id, name, kind) values (%L, 'Guest agenda', 'meeting')$q$, v_org),
    'a guest cannot add an agenda template');
  perform tests.refused_ok($q$update agenda_template set name = 'Guest renamed'$q$,
    'a guest cannot change an agenda template');
  perform tests.refused_ok(format($q$insert into event_checklist_item (event_id, title) values (%L, 'Guest item')$q$, v_event),
    'a guest cannot add to the checklist of an event they are not part of');
  perform tests.refused_ok(format($q$insert into integration_secret (connection_id) values (%L)$q$, v_empty_connection),
    'a guest cannot add a secret to someone else''s connection');
  perform tests.refused_ok(format($q$insert into message_reaction (message_id, user_id, emoji) values (%L, %L, '🎉')$q$, v_message, v_owner),
    'a guest cannot react in someone else''s name');
  perform tests.refused_ok(format($q$delete from message_reaction where message_id = %L$q$, v_message),
    'a guest cannot remove someone else''s reaction');
  perform tests.refused_ok(format($q$insert into notification_delivery (notification_id, dedupe_key) values (%L, 'guest')$q$, v_notification),
    'a guest cannot record a delivery');
  perform tests.refused_ok(format($q$insert into pinned_resource (channel_id, title) values (%L, 'Guest pin')$q$, v_channel),
    'a guest cannot pin to the announcements channel');
  perform tests.refused_ok($q$update retention_record_type set label = 'Guest label'$q$,
    'a guest cannot change the record types');
  perform tests.refused_ok($q$update retention_subject set minimum_days = 0$q$,
    'a guest cannot shorten a retention minimum');
  perform tests.refused_ok(format($q$insert into vms_assignment_reference (organization_id, user_id, external_assignment_id, title)
      values (%L, %L, 'guest', 'Guest assignment')$q$, v_org, v_guest),
    'a guest cannot record a volunteer assignment');

  -- Staff: the finance and administration records are not theirs either.
  perform tests.authenticate(v_staff, 'aal2');
  foreach v_table in array array['ledger_accountant_session', 'record_retention_report', 'scoped_access_backfill_issue'] loop
    execute format('select count(*) from public.%I', v_table) into n;
    perform tests.ok(n = 0, format('staff read no %s rows', v_table));
  end loop;
  perform tests.refused_ok(format($q$insert into finance_billing_settings (organization_id) values (%L)$q$, v_org),
    'staff cannot write billing settings directly');
  perform tests.refused_ok(format($q$insert into finance_invoice_line (organization_id, invoice_id, line_no, description, amount_cents)
      values (%L, gen_random_uuid(), 1, 'Staff line', 100)$q$, v_org),
    'staff cannot write invoice lines directly');
  perform tests.refused_ok(format($q$insert into ledger_accountant_session (organization_id, session_id, user_id) values (%L, 'staff', %L)$q$, v_org, v_staff),
    'staff cannot open an accountant session directly');
  perform tests.refused_ok(format($q$insert into record_retention_report (organization_id) values (%L)$q$, v_org),
    'staff cannot write a retention report directly');

  perform tests.clear_auth();
end;
$$;

rollback;
