-- CRM continuity (#38): an active relationship needs an owner and a next
-- action, and only the owner or an administrator can change sensitive notes.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_crm uuid;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  perform tests.authenticate(v_owner);

  failed := false;
  begin
    insert into public.crm_organization (organization_id, name, category, owner_id, status)
    values (v_org, 'School without a date', 'school', v_owner, 'active');
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'an active relationship without a next action is refused');

  insert into public.crm_organization (
    organization_id, name, category, owner_id, status, next_action_at, sensitive_notes
  ) values (
    v_org, 'Westside School', 'school', v_owner, 'active', current_date + 7, 'Private consent note'
  ) returning id into v_crm;
  perform tests.ok(v_crm is not null, 'an active relationship with an owner and next action is accepted');

  perform tests.authenticate(v_staff);
  failed := false;
  begin
    update public.crm_organization
    set sensitive_notes = 'Staff should not see this change'
    where id = v_crm;
  exception when others then failed := true;
  end;
  perform tests.ok(failed, 'staff who do not own the relationship cannot change sensitive notes');

  perform tests.authenticate(v_owner);
  update public.crm_organization
  set sensitive_notes = 'Updated by the owner'
  where id = v_crm;
  select count(*) into n from public.crm_organization
  where id = v_crm and sensitive_notes = 'Updated by the owner';
  perform tests.ok(n = 1, 'the relationship owner can change sensitive notes');

  reset role;
end;
$$;

rollback;
