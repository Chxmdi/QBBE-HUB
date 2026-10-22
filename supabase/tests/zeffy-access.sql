-- Zeffy integration (migration 20261115010000). Proves in the database,
-- whoever calls: volunteers see nothing; staff see campaigns and the
-- supporters waiting to be matched but no payment; finance readers (admins
-- with MFA, named ledger readers) see payments; nobody writes any of it from
-- the app; staff cannot forge a supporter's Zeffy link; the two server-only
-- functions are server only and do what the sync relies on; and one Zeffy
-- account can be connected to only one organization.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_other_org uuid;
  v_linked uuid;
  v_hub uuid;
  v_rows integer;
  v_text text;
  v_kinds text[];
  v_last timestamptz;
  v_denied boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.organization (name, slug) values ('Zeffy other org', 'zeffy-other-org')
  returning id into v_other_org;

  -- Start from no Zeffy data, whatever a local run left behind (rolled back).
  delete from public.zeffy_payment where organization_id = v_org;
  delete from public.zeffy_campaign where organization_id = v_org;
  delete from public.zeffy_contact_match where organization_id = v_org;
  delete from public.zeffy_sync_state where organization_id = v_org;
  delete from public.zeffy_webhook_event where organization_id = v_org;
  delete from public.integration_connection where provider = 'zeffy';
  update public.crm_contact set zeffy_contact_id = null where organization_id = v_org and zeffy_contact_id is not null;

  -- What the sync writes (as the server).
  insert into public.crm_contact (organization_id, full_name, email, source, zeffy_contact_id)
  values (v_org, 'Zeffy Supporter', 'supporter@example.com', 'zeffy', 'zc-1')
  returning id into v_linked;
  insert into public.crm_contact (organization_id, full_name, email)
  values (v_org, 'Hub Contact', 'Hub.Contact@Example.com')
  returning id into v_hub;
  insert into public.zeffy_campaign (organization_id, zeffy_id, title, goal_cents, raised_cents)
  values (v_org, 'camp-1', 'Annual Gala', 100000, 42000),
         (v_other_org, 'camp-x', 'Other gala', 1, 1);
  insert into public.zeffy_payment (organization_id, zeffy_id, zeffy_contact_id, paid_at, amount_cents,
    currency, status, refund_status, item_kinds)
  values
    (v_org, 'pay-1', 'zc-1', '2026-03-01', 5000, 'cad', 'succeeded', 'none', '{donor}'),
    (v_org, 'pay-2', 'zc-1', '2026-05-01', 3000, 'cad', 'succeeded', 'none', '{ticket}'),
    (v_org, 'pay-3', 'zc-1', '2026-07-01', 9000, 'cad', 'succeeded', 'full', '{member}'),
    (v_org, 'pay-4', 'zc-1', '2026-08-01', 9000, 'cad', 'failed', 'none', '{shop}');
  insert into public.zeffy_payment (organization_id, zeffy_id, zeffy_contact_id, paid_at, amount_cents,
    currency, status, refund_status, item_kinds, deleted_at)
  values (v_org, 'pay-5', 'zc-1', '2026-09-01', 9000, 'cad', 'succeeded', 'none', '{raffle}', now());
  insert into public.zeffy_contact_match (organization_id, zeffy_contact_id, full_name, email, candidate_ids)
  values (v_org, 'zc-2', 'Twin', 'twin@example.com', array[v_hub]);
  insert into public.zeffy_sync_state (organization_id, state) values (v_org, '{"firstSyncDoneAt": "2026-10-01"}');
  insert into public.zeffy_webhook_event (event_id, organization_id, event_type, resource_id)
  values ('evt-1', v_org, 'payment.updated', 'pay-1');

  -- -------------------------------------------------------------------
  -- Volunteers see none of it
  -- -------------------------------------------------------------------
  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_rows from public.zeffy_payment;
  perform tests.ok(v_rows = 0, 'a volunteer sees no Zeffy payment');
  select count(*) into v_rows from public.zeffy_campaign;
  perform tests.ok(v_rows = 0, 'a volunteer sees no Zeffy campaign');
  select count(*) into v_rows from public.zeffy_contact_match;
  perform tests.ok(v_rows = 0, 'a volunteer sees no supporter waiting to be matched');
  select count(*) into v_rows from public.crm_contact where id = v_linked;
  perform tests.ok(v_rows = 0, 'a volunteer sees no supporter');
  perform tests.clear_auth(); reset role;

  -- -------------------------------------------------------------------
  -- Staff: supporters and campaigns, never amounts
  -- -------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_rows from public.zeffy_payment;
  perform tests.ok(v_rows = 0, 'staff who are not finance readers see no Zeffy payment');
  select count(*) into v_rows from public.zeffy_campaign;
  perform tests.ok(v_rows = 1, format('staff see their own organization''s campaigns only (%s)', v_rows));
  select count(*) into v_rows from public.zeffy_contact_match;
  perform tests.ok(v_rows = 1, 'staff see the supporters waiting to be matched');
  select count(*) into v_rows from public.zeffy_sync_state;
  perform tests.ok(v_rows = 0, 'staff do not see the sync''s bookkeeping');

  v_denied := false;
  begin
    select count(*) into v_rows from public.zeffy_webhook_event;
  exception when insufficient_privilege then v_denied := true;
  end;
  perform tests.ok(v_denied, 'nobody signed in reads webhook deliveries');

  v_denied := false;
  begin
    insert into public.zeffy_payment (organization_id, zeffy_id, paid_at, amount_cents, currency, status)
    values (v_org, 'forged', now(), 1, 'cad', 'succeeded');
  exception when insufficient_privilege then v_denied := true;
  end;
  perform tests.ok(v_denied, 'staff cannot add a Zeffy payment');

  v_denied := false;
  begin
    update public.zeffy_campaign set raised_cents = 0 where zeffy_id = 'camp-1';
    get diagnostics v_rows = row_count;
    v_denied := v_rows = 0;
  exception when insufficient_privilege then v_denied := true;
  end;
  perform tests.ok(v_denied, 'staff cannot change a Zeffy campaign');

  -- Staff edit contacts, but not whose giving a contact shows.
  update public.crm_contact set full_name = 'Renamed by staff' where id = v_linked;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 1, 'staff can still edit a supporter''s ordinary details');

  v_text := null;
  begin
    update public.crm_contact set zeffy_contact_id = 'zc-someone-else' where id = v_hub;
  exception when others then v_text := sqlerrm;
  end;
  perform tests.ok(v_text ilike '%Zeffy sync only%', format('staff cannot link a contact to Zeffy giving (%s)', coalesce(v_text, 'no error')));

  v_text := null;
  begin
    update public.crm_contact set zeffy_kinds = '{donor}' where id = v_hub;
  exception when others then v_text := sqlerrm;
  end;
  perform tests.ok(v_text ilike '%Zeffy sync only%', 'staff cannot mark a contact as a donor');

  v_text := null;
  begin
    insert into public.crm_contact (organization_id, full_name, source, zeffy_contact_id)
    values (v_org, 'Forged supporter', 'zeffy', 'zc-forged');
  exception when others then v_text := sqlerrm;
  end;
  perform tests.ok(v_text ilike '%Zeffy sync only%', 'staff cannot create a contact that claims to come from Zeffy');

  insert into public.crm_contact (organization_id, full_name) values (v_org, 'Ordinary new contact');
  perform tests.ok(true, 'staff still create ordinary contacts');

  v_denied := false;
  begin
    perform * from public.zeffy_contacts_by_email(v_org, array['supporter@example.com']);
  exception when insufficient_privilege then v_denied := true;
  end;
  perform tests.ok(v_denied, 'the email lookup is for the server only');

  v_denied := false;
  begin
    perform public.zeffy_refresh_supporter_kinds(v_org, array['zc-1']);
  exception when insufficient_privilege then v_denied := true;
  end;
  perform tests.ok(v_denied, 'recomputing supporters is for the server only');
  perform tests.clear_auth(); reset role;

  -- -------------------------------------------------------------------
  -- Finance readers see payments
  -- -------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into v_rows from public.zeffy_payment where organization_id = v_org;
  perform tests.ok(v_rows = 5, format('an admin with MFA sees the payments (%s)', v_rows));
  select count(*) into v_rows from public.zeffy_sync_state;
  perform tests.ok(v_rows = 1, 'an admin sees how far the sync got');
  insert into public.ledger_reader (organization_id, user_id) values (v_org, v_staff);
  perform tests.clear_auth(); reset role;

  -- Ledger readers read the books only with MFA.
  perform tests.ensure_verified_mfa_factor(v_staff);
  perform tests.authenticate(v_staff, 'aal2');
  select count(*) into v_rows from public.zeffy_payment where organization_id = v_org;
  perform tests.ok(v_rows = 5, 'a named ledger reader sees the payments');
  select count(*) into v_rows from public.zeffy_payment where organization_id = v_other_org;
  perform tests.ok(v_rows = 0, 'and none of another organization''s');
  perform tests.clear_auth(); reset role;

  -- -------------------------------------------------------------------
  -- The server-only functions
  -- -------------------------------------------------------------------
  select count(*) into v_rows from public.zeffy_contacts_by_email(v_org, array['HUB.contact@example.COM', 'nobody@example.com']);
  perform tests.ok(v_rows = 1, 'the email lookup ignores case');
  select count(*) into v_rows from public.zeffy_contacts_by_email(v_other_org, array['hub.contact@example.com']);
  perform tests.ok(v_rows = 0, 'the email lookup stays inside the organization');

  perform public.zeffy_refresh_supporter_kinds(v_org, array['zc-1', 'zc-nobody']);
  select zeffy_kinds, zeffy_last_activity_at into v_kinds, v_last from public.crm_contact where id = v_linked;
  perform tests.ok(v_kinds = '{donor,ticket}'::text[],
    format('a refunded, failed or deleted payment does not count (%s)', v_kinds));
  perform tests.ok(v_last = '2026-05-01'::timestamptz, format('last activity is the last payment that counts (%s)', v_last));

  update public.zeffy_payment set refund_status = 'full' where zeffy_id in ('pay-1', 'pay-2');
  perform public.zeffy_refresh_supporter_kinds(v_org, array['zc-1']);
  select zeffy_kinds, zeffy_last_activity_at into v_kinds, v_last from public.crm_contact where id = v_linked;
  perform tests.ok(v_kinds = '{}'::text[] and v_last is null, 'once everything is refunded the supporter shows no activity');

  -- -------------------------------------------------------------------
  -- One Zeffy account, one organization
  -- -------------------------------------------------------------------
  insert into public.integration_connection (organization_id, user_id, provider, status)
  values (v_org, null, 'zeffy', 'connected');
  v_denied := false;
  begin
    insert into public.integration_connection (organization_id, user_id, provider, status)
    values (v_other_org, null, 'zeffy', 'connected');
  exception when unique_violation then v_denied := true;
  end;
  perform tests.ok(v_denied, 'a second organization cannot connect the same Zeffy account');
  update public.integration_connection set status = 'disconnected'
  where organization_id = v_org and provider = 'zeffy';
  insert into public.integration_connection (organization_id, user_id, provider, status)
  values (v_other_org, null, 'zeffy', 'connected');
  perform tests.ok(true, 'once the first disconnects, another organization may connect');

  -- Each Zeffy contact links to one CRM contact per organization.
  v_denied := false;
  begin
    insert into public.crm_contact (organization_id, full_name, source, zeffy_contact_id)
    values (v_org, 'Duplicate', 'zeffy', 'zc-1');
  exception when unique_violation then v_denied := true;
  end;
  perform tests.ok(v_denied, 'a Zeffy contact is linked to one CRM contact only');

  -- Both jobs are registered and scheduled.
  select count(*) into v_rows from public.job_definition where name in ('zeffy-sync', 'zeffy-events');
  perform tests.ok(v_rows = 2, 'the Zeffy jobs are registered');
  select count(*) into v_rows from cron.job where jobname in ('zeffy-sync', 'zeffy-events');
  perform tests.ok(v_rows = 2, 'the Zeffy jobs are scheduled');
end;
$$;

rollback;
