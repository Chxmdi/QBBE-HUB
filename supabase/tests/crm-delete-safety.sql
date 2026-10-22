-- CRM organizations, contacts and opportunities are archived, not deleted,
-- by staff. And a delete that does happen (by server code) cannot silently
-- take the interactions, follow-ups, agreements, sensitive notes, links,
-- opportunities and approval requests attached to the record with it.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  org uuid;
  partner uuid;
  person uuid;
  opp uuid;
  n int;
  blocked boolean;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;

  insert into public.crm_organization (organization_id, name, owner_id, next_action_at)
  values (org, 'CDS partner', staff_user, now() + interval '7 days') returning id into partner;
  insert into public.crm_contact (organization_id, crm_organization_id, full_name, owner_id)
  values (org, partner, 'CDS person', staff_user) returning id into person;
  insert into public.crm_interaction (organization_id, crm_organization_id, owner_id, summary)
  values (org, partner, staff_user, 'CDS call');
  insert into public.crm_sensitive_note (organization_id, crm_organization_id, notes)
  values (org, partner, 'CDS partner note');
  insert into public.crm_sensitive_note (organization_id, crm_contact_id, notes)
  values (org, person, 'CDS person note');
  insert into public.crm_agreement (organization_id, crm_organization_id, title)
  values (org, partner, 'CDS agreement');
  insert into public.opportunity (organization_id, crm_organization_id, title, owner_id, decision_expected_at)
  values (org, partner, 'CDS grant', staff_user, current_date + 30) returning id into opp;

  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  delete from public.crm_organization where id = partner;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'staff cannot delete a CRM organization');
  delete from public.crm_contact where id = person;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'staff cannot delete a CRM contact');
  delete from public.opportunity where id = opp;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'staff cannot delete an opportunity');
  update public.crm_organization set status = 'archived' where id = partner;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'staff can still archive a CRM organization');
  update public.crm_organization set status = 'active' where id = partner;

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select count(*) into n from public.crm_interaction where crm_organization_id = partner;
  perform tests.ok(n = 1, 'the interaction is still there');
  select count(*) into n from public.crm_sensitive_note where crm_organization_id = partner or crm_contact_id = person;
  perform tests.ok(n = 2, 'the sensitive notes are still there');

  -- Even server code cannot remove a parent with history attached.
  blocked := false;
  begin
    delete from public.crm_organization where id = partner;
  exception when foreign_key_violation then blocked := true;
  end;
  perform tests.ok(blocked, 'deleting an organization with history attached fails instead of wiping it');
  blocked := false;
  begin
    delete from public.crm_contact where id = person;
  exception when foreign_key_violation then blocked := true;
  end;
  perform tests.ok(blocked, 'deleting a contact with a sensitive note fails instead of wiping it');
  select count(*) into n from public.opportunity where id = opp;
  perform tests.ok(n = 1, 'the opportunity is still there');
end;
$$;
rollback;
