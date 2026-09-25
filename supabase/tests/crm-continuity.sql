-- CRM continuity and sensitive notes (#38).
--
-- An active relationship needs an owner and a next action. Sensitive notes
-- are readable and writable only by the relationship owner or an
-- administrator, and that is enforced by which rows exist for the caller,
-- not by the interface declining to ask: a staff member querying the API
-- directly gets nothing. Run after qa-users.sql. Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_other_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_crm uuid;
  v_contact uuid;
  v_foreign_org uuid;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  -- A second staff member who does not own the relationship, and an active
  -- administrator, in the same organization.
  update public.organization_membership set role = 'staff', status = 'active'
  where organization_id = v_org and user_id = v_other_staff;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_admin);

  -- The columns that exposed the notes to every reader are gone.
  select count(*) into n from information_schema.columns
  where table_schema = 'public'
    and table_name in ('crm_organization', 'crm_contact')
    and column_name = 'sensitive_notes';
  perform tests.ok(n = 0, 'crm_organization and crm_contact no longer hold sensitive notes');

  perform tests.authenticate(v_staff);

  failed := false;
  begin
    insert into public.crm_organization (organization_id, name, category, owner_id, status)
    values (v_org, 'School without a date', 'school', v_staff, 'active');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'an active relationship without a next action is refused');

  insert into public.crm_organization (
    organization_id, name, category, owner_id, status, next_action_at
  ) values (
    v_org, 'Westside School', 'school', v_staff, 'active', current_date + 7
  ) returning id into v_crm;
  perform tests.ok(v_crm is not null, 'an active relationship with an owner and next action is accepted');

  insert into public.crm_contact (organization_id, crm_organization_id, full_name, owner_id)
  values (v_org, v_crm, 'Jordan Lee', v_staff)
  returning id into v_contact;

  -- The owner writes and reads the notes.
  insert into public.crm_sensitive_note (organization_id, crm_organization_id, notes)
  values (v_org, v_crm, 'Private consent note');
  insert into public.crm_sensitive_note (organization_id, crm_contact_id, notes)
  values (v_org, v_contact, 'Private contact note');
  select count(*) into n from public.crm_sensitive_note
  where crm_organization_id = v_crm or crm_contact_id = v_contact;
  perform tests.ok(n = 2, 'the relationship owner reads the organization and contact notes');

  -- Another staff member can read the relationship itself but not its notes.
  perform tests.authenticate(v_other_staff);
  select count(*) into n from public.crm_organization where id = v_crm;
  perform tests.ok(n = 1, 'another staff member reads the relationship');
  select count(*) into n from public.crm_sensitive_note;
  perform tests.ok(n = 0, 'another staff member reads no sensitive notes, even querying the table directly');

  failed := false;
  begin
    insert into public.crm_sensitive_note (organization_id, crm_organization_id, notes)
    values (v_org, v_crm, 'Overwrite attempt')
    on conflict (crm_organization_id) do update set notes = excluded.notes;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'another staff member cannot write the notes');

  update public.crm_sensitive_note set notes = 'Changed' where crm_organization_id = v_crm;
  delete from public.crm_sensitive_note where crm_contact_id = v_contact;

  -- An administrator of the organization reads them, and sees them unchanged.
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into n from public.crm_sensitive_note
  where (crm_organization_id = v_crm and notes = 'Private consent note')
     or (crm_contact_id = v_contact and notes = 'Private contact note');
  perform tests.ok(n = 2, 'an administrator reads both notes, untouched by the other staff member');

  -- A note cannot be attached to a record while claiming another tenant.
  perform tests.authenticate(v_staff);
  select id into v_foreign_org from public.organization where id <> v_org limit 1;
  if v_foreign_org is not null then
    failed := false;
    begin
      insert into public.crm_sensitive_note (organization_id, crm_contact_id, notes)
      values (v_foreign_org, v_contact, 'Cross-tenant');
    exception when others then failed := true;
    end;
    perform tests.ok(failed, 'a note cannot claim a different organization than its record');
  end if;

  -- Each note belongs to exactly one record.
  reset role;
  failed := false;
  begin
    insert into public.crm_sensitive_note (organization_id, crm_organization_id, crm_contact_id, notes)
    values (v_org, v_crm, v_contact, 'Both');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'a note is attached to one organization or one contact, not both');
end;
$$;

rollback;
