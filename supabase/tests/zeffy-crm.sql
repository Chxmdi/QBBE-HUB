-- Zeffy giving in the CRM (migration 20261115020000). Proves: a supporter's
-- timeline shows staff what and when but never how much; finance readers see
-- amounts and receipts, and that reading is audited; totals and the
-- supporter list are finance only and audited; the overview gives staff
-- counts and finance readers money; and staff can place a supporter the sync
-- could not, only onto a suggested contact, once.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_ana uuid;
  v_twin_a uuid;
  v_twin_b uuid;
  v_match uuid;
  v_rows integer;
  v_cents bigint;
  v_text text;
  v_json jsonb;
  v_placed uuid;
  v_denied boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  delete from public.zeffy_payment where organization_id = v_org;
  delete from public.zeffy_contact_match where organization_id = v_org;
  update public.crm_contact set zeffy_contact_id = null where organization_id = v_org and zeffy_contact_id is not null;

  insert into public.crm_contact (organization_id, full_name, email, source, zeffy_contact_id)
  values (v_org, 'Ana Supporter', 'ana@example.com', 'zeffy', 'zt-ana') returning id into v_ana;
  insert into public.crm_contact (organization_id, full_name, email)
  values (v_org, 'Twin A', 'twin@example.com') returning id into v_twin_a;
  insert into public.crm_contact (organization_id, full_name, email)
  values (v_org, 'Twin B', 'TWIN@example.com') returning id into v_twin_b;

  insert into public.zeffy_payment (organization_id, zeffy_id, zeffy_contact_id, zeffy_campaign_id, campaign_title,
    campaign_category, paid_at, amount_cents, refunded_cents, currency, status, refund_status, item_kinds, items,
    receipt_url, is_recurring, recurring_interval, recurring_status)
  values
    (v_org, 'zt-1', 'zt-ana', 'c-annual', 'Annual appeal', 'donation', now() - interval '10 days', 10000, 0, 'cad',
     'succeeded', 'none', '{donor}', '[{"type":"donation","amount_cents":10000}]', 'https://zeffy.com/r/1', true, 'monthly', 'active'),
    (v_org, 'zt-2', 'zt-ana', 'c-gala', 'Gala', 'event', now() - interval '5 days', 15000, 5000, 'cad',
     'succeeded', 'partial', '{ticket}', '[{"type":"ticket","amount_cents":7500},{"type":"ticket","amount_cents":7500}]', null, false, null, null),
    (v_org, 'zt-3', 'zt-ana', 'c-gala', 'Gala', 'event', now() - interval '4 days', 9900, 0, 'cad',
     'failed', 'none', '{ticket}', '[]', null, false, null, null),
    (v_org, 'zt-4', 'zt-old', 'c-annual', 'Annual appeal', 'donation', now() - interval '18 months', 2000, 0, 'cad',
     'succeeded', 'none', '{donor}', '[]', null, false, null, null);
  insert into public.zeffy_contact_match (organization_id, zeffy_contact_id, full_name, email, candidate_ids)
  values (v_org, 'zt-twin', 'Twin Zeffy', 'twin@example.com', array[v_twin_a, v_twin_b])
  returning id into v_match;

  -- -------------------------------------------------------------------
  -- Staff: what and when, never how much
  -- -------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select count(*), max(amount_cents), max(receipt_url) into v_rows, v_cents, v_text
  from public.zeffy_supporter_activity(v_ana);
  perform tests.ok(v_rows = 2, format('staff see a supporter''s payments, failed ones left out (%s)', v_rows));
  perform tests.ok(v_cents is null and v_text is null, 'staff see no amount and no receipt');
  select count(*) into v_rows from public.audit_event
  where organization_id = v_org and action = 'supporter_giving_viewed' and actor_id = v_staff;
  perform tests.ok(v_rows = 0, 'nothing to audit when no amount was shown');

  v_text := null;
  begin
    perform * from public.zeffy_supporter_totals(v_org);
  exception when others then v_text := sqlerrm;
  end;
  perform tests.ok(v_text ilike '%do not have access%', 'staff cannot list giving per supporter');

  v_json := public.zeffy_overview(v_org, (now() - interval '30 days')::date, now()::date);
  perform tests.ok(v_json->'money' = 'null'::jsonb, 'staff get the overview without money');
  perform tests.ok((v_json->>'payments')::int = 2, format('the overview counts payments that went through (%s)', v_json->>'payments'));
  perform tests.ok((v_json->'attendance'->0->>'tickets')::int = 2,
    format('attendance counts tickets, not payments (%s)', v_json->'attendance'));
  perform tests.ok((v_json->>'needs_matching')::int = 1, 'the overview counts supporters waiting to be matched');

  -- Placing a supporter: only onto a suggested contact, once.
  v_text := null;
  begin
    perform public.zeffy_resolve_match(v_match, v_ana);
  exception when others then v_text := sqlerrm;
  end;
  perform tests.ok(v_text ilike '%suggested contacts%', 'staff cannot place a supporter on a contact that was not suggested');
  v_placed := public.zeffy_resolve_match(v_match, v_twin_b);
  perform tests.ok(v_placed = v_twin_b, 'staff place the supporter on the contact they chose');
  perform tests.ok((select zeffy_contact_id from public.crm_contact where id = v_twin_b) = 'zt-twin',
    'the chosen contact now carries the Zeffy link');
  v_text := null;
  begin
    perform public.zeffy_resolve_match(v_match, v_twin_a);
  exception when others then v_text := sqlerrm;
  end;
  perform tests.ok(v_text ilike '%already been placed%', 'a supporter is placed once');
  perform tests.clear_auth(); reset role;

  perform tests.ok(exists (select 1 from public.audit_event where organization_id = v_org
    and action = 'supporter_matched' and actor_id = v_staff), 'placing a supporter is audited with who did it');

  -- -------------------------------------------------------------------
  -- Volunteers: nothing
  -- -------------------------------------------------------------------
  perform tests.authenticate(v_volunteer, 'aal1');
  v_text := null;
  begin
    perform * from public.zeffy_supporter_activity(v_ana);
  exception when others then v_text := sqlerrm;
  end;
  perform tests.ok(v_text ilike '%do not have access%', 'a volunteer cannot read a supporter''s timeline');
  v_text := null;
  begin
    perform public.zeffy_overview(v_org, now()::date - 30, now()::date);
  exception when others then v_text := sqlerrm;
  end;
  perform tests.ok(v_text ilike '%do not have access%', 'a volunteer cannot read the overview');
  perform tests.clear_auth(); reset role;

  -- -------------------------------------------------------------------
  -- Finance readers: amounts, audited
  -- -------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  select sum(amount_cents), max(receipt_url) into v_cents, v_text from public.zeffy_supporter_activity(v_ana);
  perform tests.ok(v_cents = 25000 and v_text = 'https://zeffy.com/r/1', 'a finance reader sees amounts and receipts');
  perform tests.ok(exists (select 1 from public.audit_event where organization_id = v_org
    and action = 'supporter_giving_viewed' and actor_id = v_admin), 'seeing a supporter''s amounts is audited');

  select net_cents, payment_count, recurring_active into v_cents, v_rows, v_denied
  from public.zeffy_supporter_totals(v_org, 'export') where contact_id = v_ana;
  perform tests.ok(v_cents = 20000 and v_rows = 2,
    format('totals net refunds and leave failed payments out (%s over %s)', v_cents, v_rows));
  perform tests.ok(v_denied, 'an active monthly gift shows as recurring');
  perform tests.ok(exists (select 1 from public.audit_event where organization_id = v_org
    and action = 'supporter_list_exported' and actor_id = v_admin), 'exporting giving per supporter is audited');

  v_json := public.zeffy_overview(v_org, (now() - interval '30 days')::date, now()::date);
  perform tests.ok((v_json->'money'->>'raised_cents')::bigint = 20000,
    format('raised in the period is net of refunds (%s)', v_json->'money'->>'raised_cents'));
  perform tests.ok((v_json->'money'->>'monthly_recurring_cents')::bigint = 10000, 'monthly recurring sums active monthly gifts');
  perform tests.ok((v_json->'money'->>'lapsed_donors')::int = 1, 'a donor with no gift in 12 to 24 months counts as lapsed');
  perform tests.ok((v_json->'money'->>'refunded_cents')::bigint = 5000, 'refunds in the period are shown');
  perform tests.clear_auth(); reset role;
end;
$$;

rollback;
