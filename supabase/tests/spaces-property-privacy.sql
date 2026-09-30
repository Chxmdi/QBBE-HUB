-- Workspace OS property-level privacy (M10e): which property keys each role
-- may not see, as the query engine and public pages ask it. Every role:
-- owner, admin, staff, leadership viewer, volunteer, guest, accountant (a
-- guest with a ledger grant), a deactivated member, and signed-out.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

-- S1's property registry may not be on this branch: stand in for the
-- columns this reads, inside this transaction only.
do $$
begin
  if to_regclass('public.object_type') is null then
    create table public.object_type (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      key text not null,
      name_en text not null,
      name_fr text not null,
      kind text not null
    );
  end if;
  if to_regclass('public.property_definition') is null then
    create table public.property_definition (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      type_id uuid not null,
      key text not null,
      name_en text not null,
      name_fr text not null,
      kind text not null,
      visible_to_roles public.org_role[],
      archived_at timestamptz
    );
  end if;
end;
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_viewer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_contributor uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  v_org uuid;
  v_other_org uuid;
  v_type uuid;
  v_other_type uuid;
  v_case record;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'leadership_viewer' where organization_id = v_org and user_id = v_viewer;
  update public.organization_membership set status = 'deactivated' where organization_id = v_org and user_id = v_contributor;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '1 day', v_admin);

  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_org, 'pp_donor', 'Donor', 'Donateur', 'custom') returning id into v_type;
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, visible_to_roles)
  values
    (v_org, v_type, 'name', 'Name', 'Nom', 'text', null),
    (v_org, v_type, 'gift_amount', 'Gift amount', 'Montant du don', 'currency', array['owner', 'admin']::public.org_role[]),
    (v_org, v_type, 'health_notes', 'Health notes', 'Notes de santé', 'text', array['owner']::public.org_role[]),
    (v_org, v_type, 'staff_notes', 'Staff notes', 'Notes du personnel', 'text', array['owner', 'admin', 'staff']::public.org_role[]);

  -- Another organization's type with the same key must not leak into answers.
  insert into public.organization (name, slug) values ('Other org', 'pp-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_other_org;
  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_other_org, 'pp_donor', 'Donor', 'Donateur', 'custom') returning id into v_other_type;
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, visible_to_roles)
  values (v_other_org, v_other_type, 'other_secret', 'Secret', 'Secret', 'text', array['owner']::public.org_role[]);

  for v_case in
    select * from (values
      (v_owner, 'owner', array[]::text[]),
      (v_admin, 'admin', array['health_notes']),
      (v_staff, 'staff', array['gift_amount', 'health_notes']),
      (v_viewer, 'leadership viewer', array['gift_amount', 'health_notes', 'staff_notes']),
      (v_volunteer, 'volunteer', array['gift_amount', 'health_notes', 'staff_notes']),
      (v_guest, 'guest and accountant', array['gift_amount', 'health_notes', 'staff_notes']),
      (v_contributor, 'deactivated member (fails closed)', array['gift_amount', 'health_notes', 'other_secret', 'staff_notes'])
    ) as c (who, label, expected)
  loop
    perform tests.authenticate(v_case.who);
    perform tests.ok(public.hidden_property_keys('pp_donor') = v_case.expected,
      format('%s: hidden keys are %s (got %s)', v_case.label, v_case.expected, public.hidden_property_keys('pp_donor')));
    reset role;
  end loop;

  perform tests.authenticate(v_owner);
  perform tests.ok(cardinality(public.hidden_property_keys('no_such_type')) = 0,
    'an unknown type has nothing to hide');
  reset role;
end;
$$;

-- Signed out: the question cannot be asked at all.
do $$
declare
  v_error text;
begin
  perform tests.clear_auth();
  begin
    perform public.hidden_property_keys('pp_donor');
  exception when insufficient_privilege then
    v_error := sqlerrm;
  end;
  reset role;
  perform tests.ok(v_error is not null, 'a signed-out visitor cannot call hidden_property_keys');
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'hidden_property_keys' and n.nspname in ('app', 'public')),
    'hidden_property_keys is security definer with an empty search path');
end;
$$;

rollback;
