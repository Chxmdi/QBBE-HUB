-- CRM ownership. A record's owner (and administrators) read its sensitive
-- note, so ownership cannot be taken by any staff member: only the current
-- owner can hand a record off, and administrators can reassign. Owning a
-- record gives no access once the owner stops being staff (moved to
-- volunteer or guest, or deactivated).
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  lead_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  org uuid;
  c_owner uuid;
  c_lead uuid;
  o_lead uuid;
  refused boolean;
  n int;
  new_role text;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  perform tests.ensure_verified_mfa_factor(admin_user);

  insert into public.crm_contact (organization_id, full_name, email, owner_id)
  values (org, 'COG owner contact', 'cog-owner@example.com', owner_user) returning id into c_owner;
  insert into public.crm_sensitive_note (organization_id, crm_contact_id, notes)
  values (org, c_owner, 'COG health note');
  insert into public.crm_contact (organization_id, full_name, email, owner_id)
  values (org, 'COG lead contact', 'cog-lead@example.com', lead_user) returning id into c_lead;
  insert into public.crm_sensitive_note (organization_id, crm_contact_id, notes)
  values (org, c_lead, 'COG lead note');
  insert into public.crm_organization (organization_id, name, owner_id, next_action_at)
  values (org, 'COG partner', lead_user, now() + interval '7 days') returning id into o_lead;
  insert into public.crm_interaction (organization_id, crm_organization_id, owner_id, summary)
  values (org, o_lead, lead_user, 'COG interaction');

  -- Taking ownership.
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    update public.crm_contact set owner_id = staff_user where id = c_owner;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'staff cannot make themselves owner of someone else''s contact');
  refused := false;
  begin
    update public.crm_organization set owner_id = staff_user where id = o_lead;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'staff cannot make themselves owner of someone else''s organization');
  select count(*) into n from public.crm_sensitive_note where crm_contact_id = c_owner;
  perform tests.ok(n = 0, 'so the sensitive note stays out of reach');
  refused := false;
  begin
    insert into public.crm_contact (organization_id, full_name, owner_id)
    values (org, 'COG planted', lead_user);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'staff cannot create a contact owned by someone else');
  insert into public.crm_contact (organization_id, full_name, owner_id)
  values (org, 'COG own contact', staff_user);
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'staff still create contacts they own');
  update public.crm_contact set notes = 'edited by staff' where id = c_owner;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'staff still edit other fields of a contact they do not own');

  -- An administrator of another organization cannot move a record there
  -- (where they could take it) and back.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.organization (id, name, slug) values ('cccccccc-0000-4000-8000-00000000c0c0', 'COG other org', 'cog-other-org');
  insert into public.organization_membership (organization_id, user_id, role, status)
  values ('cccccccc-0000-4000-8000-00000000c0c0', staff_user, 'admin', 'active');
  perform tests.ensure_verified_mfa_factor(staff_user);
  perform tests.authenticate(staff_user, 'aal2');
  set local role authenticated;
  refused := false;
  begin
    update public.crm_contact
    set organization_id = 'cccccccc-0000-4000-8000-00000000c0c0', owner_id = staff_user
    where id = c_owner;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a CRM record cannot be moved to another organization to take it over');
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  delete from public.organization_membership where organization_id = 'cccccccc-0000-4000-8000-00000000c0c0';

  -- The current owner hands off; an administrator reassigns.
  reset role;
  perform tests.authenticate(lead_user, 'aal1');
  set local role authenticated;
  update public.crm_contact set owner_id = staff_user where id = c_lead;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'the current owner can hand a contact to someone else');
  reset role;
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  update public.crm_contact set owner_id = lead_user where id = c_lead;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'an administrator can reassign a contact');

  -- The owner stops being staff.
  foreach new_role in array array['volunteer', 'guest', 'deactivated'] loop
    reset role;
    perform set_config('request.jwt.claims', '{}', true);
    if new_role = 'deactivated' then
      update public.organization_membership set role = 'staff', status = 'deactivated', deactivated_at = now()
      where user_id = lead_user and organization_id = org;
    else
      update public.organization_membership set role = new_role::public.org_role
      where user_id = lead_user and organization_id = org;
    end if;
    perform tests.authenticate(lead_user, 'aal1');
    set local role authenticated;
    select count(*) into n from public.crm_contact where id = c_lead;
    perform tests.ok(n = 0, format('a former owner (%s) cannot read the contact', new_role));
    select count(*) into n from public.crm_organization where id = o_lead;
    perform tests.ok(n = 0, format('a former owner (%s) cannot read the organization', new_role));
    select count(*) into n from public.crm_interaction where crm_organization_id = o_lead;
    perform tests.ok(n = 0, format('a former owner (%s) cannot read its interactions', new_role));
    select count(*) into n from public.crm_sensitive_note where crm_contact_id = c_lead;
    perform tests.ok(n = 0, format('a former owner (%s) cannot read the sensitive note', new_role));
    update public.crm_sensitive_note set notes = 'rewritten' where crm_contact_id = c_lead;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('a former owner (%s) cannot rewrite the sensitive note', new_role));
    delete from public.crm_sensitive_note where crm_contact_id = c_lead;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('a former owner (%s) cannot delete the sensitive note', new_role));
  end loop;

  -- Administrators can list what former staff still own, to reassign it.
  reset role;
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  select count(*) into n from public.crm_records_owned_by_former_staff()
  where record_id in (c_lead, o_lead);
  perform tests.ok(n = 2, 'an administrator sees the records a former staff member still owns');
  reset role;
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    perform * from public.crm_records_owned_by_former_staff();
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'staff cannot list them');

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
