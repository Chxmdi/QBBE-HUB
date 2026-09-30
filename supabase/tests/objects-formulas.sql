-- Workspace OS V1-8: formula properties (20261101010900_formula_properties.sql).
-- Owners and admins with two-step sign-in add formula properties with a
-- formula of 1–2000 characters; nobody else can, and nobody can add a rollup
-- or relation property by hand. Run after qa-users.sql and rls.sql. Rolled back.
begin;

create or replace function tests.formulas_raises(p_sql text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end;
$$;
grant execute on function tests.formulas_raises(text) to anon, authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_task_type uuid;
  v_person uuid;
  v_insert text := 'insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, options) values (%L, %L, %L, ''Days left'', ''Jours restants'', %L, %L::jsonb)';
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'guest', status = 'active'
  where organization_id = v_org and user_id = v_accountant;
  select id into v_task_type from public.object_type where organization_id = v_org and key = 'task';

  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      not tests.formulas_raises(format(v_insert, v_org, v_task_type, 'days_left_' || substr(md5(v_person::text), 1, 6),
        'formula', '{"expression":"dateBetween(prop(\"due\"), today(), \"days\")"}')),
      format('%s adds a formula property', v_person)
    );
    perform tests.ok(
      tests.formulas_raises(format(v_insert, v_org, v_task_type, 'no_formula', 'formula', '{}'))
        and tests.formulas_raises(format(v_insert, v_org, v_task_type, 'blank_formula', 'formula', '{"expression":""}'))
        and tests.formulas_raises(format(v_insert, v_org, v_task_type, 'long_formula', 'formula',
          jsonb_build_object('expression', repeat('1+', 1001))::text)),
      format('%s cannot add a formula property without a formula of 1 to 2000 characters', v_person)
    );
    perform tests.ok(
      tests.formulas_raises(format(v_insert, v_org, v_task_type, 'hand_rollup', 'rollup', '{}'))
        and tests.formulas_raises(format(v_insert, v_org, v_task_type, 'hand_relation', 'relation', '{}')),
      format('%s still cannot add rollup or relation properties by hand', v_person)
    );
    reset role;
  end loop;

  perform tests.authenticate(v_owner);
  perform tests.ok(
    tests.formulas_raises(format(
      'update public.property_definition set options = ''{"expression":""}'' where type_id = %L and key like ''days_left_%%''',
      v_task_type)),
    'a saved formula cannot be emptied'
  );
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(
    tests.formulas_raises(format(v_insert, v_org, v_task_type, 'aal1_formula', 'formula', '{"expression":"1"}')),
    'the owner without two-step sign-in cannot add a formula'
  );
  reset role;

  foreach v_person in array array[v_staff, v_volunteer, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      tests.formulas_raises(format(v_insert, v_org, v_task_type, 'denied_' || substr(md5(v_person::text), 1, 6),
        'formula', '{"expression":"1"}')),
      format('%s cannot add a formula property', v_person)
    );
    perform tests.ok(
      exists (select 1 from public.property_definition where type_id = v_task_type and kind = 'formula'),
      format('%s reads the formula definitions', v_person)
    );
    reset role;
  end loop;
end;
$$;

do $$
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.formulas_raises('insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, options) select organization_id, id, ''anon_f'', ''X'', ''X'', ''formula'', ''{"expression":"1"}'' from public.object_type limit 1'),
    'a signed-out visitor cannot add a formula'
  );
  reset role;
end;
$$;

rollback;
