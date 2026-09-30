-- Workspace OS custom roles (M10d): only owners and admins with two-step
-- sign-in define them; they share like built-in roles; changing one updates
-- access at once; one in use cannot be deleted. Run after qa-users.sql and
-- rls.sql. All mutations are rolled back.
begin;

create function tests.cr_raises(p_sql text, p_pattern text, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  perform tests.ok(v_error is not null and v_error ilike '%' || p_pattern || '%',
    format('%s (%s)', p_msg, coalesce(v_error, 'no error')));
end;
$$;
grant execute on function tests.cr_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_other_org uuid;
  v_custom uuid;
  v_role uuid;
  v_grant uuid;
  v_rows integer;
  v_viewer uuid := (select id from public.access_role where key = 'viewer' and organization_id is null);
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  insert into public.organization (name, slug) values ('Other org', 'cr-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_other_org;
  insert into public.space (organization_id, kind, name_en, name_fr)
  values (v_org, 'custom', 'Finance committee', 'Comité des finances') returning id into v_custom;

  -- Who may define roles.
  foreach v_rows in array array[1, 2, 3] loop
    perform tests.authenticate(case v_rows when 1 then v_staff when 2 then v_volunteer else v_guest end);
    perform tests.cr_raises(format(
      'insert into public.access_role (organization_id, key, name_en, name_fr, caps) values (%L, ''x'', ''X'', ''X'', 3)', v_org),
      'row-level security', case v_rows when 1 then 'staff' when 2 then 'a volunteer' else 'a guest' end || ' cannot define a role');
    reset role;
  end loop;
  perform tests.authenticate(v_admin, 'aal1');
  perform tests.cr_raises(format(
    'insert into public.access_role (organization_id, key, name_en, name_fr, caps) values (%L, ''x'', ''X'', ''X'', 3)', v_org),
    'row-level security', 'an admin without two-step sign-in cannot define a role');
  reset role;

  perform tests.authenticate(v_admin);
  -- comment (2) + share (64): view is added because everything needs it.
  insert into public.access_role (organization_id, key, name_en, name_fr, caps)
  values (v_org, 'reviewer_sharer', 'Reviewer who shares', 'Réviseur qui partage', 2 | 64)
  returning id, caps into v_role, v_rows;
  perform tests.ok(v_rows = 1 | 2 | 64, 'an admin defines a role; view comes with any other capability');
  perform tests.cr_raises(format(
    'insert into public.access_role (organization_id, key, name_en, name_fr, caps) values (%L, ''y'', ''Y'', ''Y'', 1024)', v_org),
    'access_role_custom_caps', 'custom roles hold Workspace OS capabilities only, not today''s record words');
  perform tests.cr_raises(format(
    'insert into public.access_role (organization_id, key, name_en, name_fr, caps) values (%L, ''z'', ''Z'', ''Z'', 3)', v_other_org),
    'row-level security', 'an admin cannot define roles for another organization');
  update public.access_role set caps = 1 where key = 'manager' and organization_id is null;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'built-in roles cannot be changed, even by an admin');
  delete from public.access_role where key = 'viewer' and organization_id is null;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'built-in roles cannot be deleted through the API');

  -- Sharing with the custom role.
  insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id)
  values (v_org, v_custom, 'person', v_staff, v_role) returning id into v_grant;
  reset role;

  perform tests.authenticate(v_staff);
  perform tests.ok(public.space_capabilities(v_custom) = array['view', 'comment', 'share'],
    'the custom role gives exactly its capabilities');
  select count(*) into v_rows from public.access_role where id = v_role;
  perform tests.ok(v_rows = 1, 'members read their organization''s custom roles (the share menu lists them)');
  select count(*) into v_rows from public.access_role_usage();
  perform tests.ok(v_rows = 0, 'role usage counts are for admins only');
  -- They hold share, so they may pass on this role or a smaller one.
  insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id)
  values (v_org, v_custom, 'person', v_volunteer, v_viewer);
  perform tests.ok(found, 'a person holding share through a custom role passes on a smaller role');
  reset role;

  -- Changing the role changes access at once.
  perform tests.authenticate(v_admin);
  update public.access_role set caps = 1 | 4 where id = v_role;
  perform tests.ok(
    (select grants from public.access_role_usage() where role_id = v_role) = 1,
    'admins see how many shares use a role');
  reset role;
  perform tests.authenticate(v_staff);
  perform tests.ok(public.space_capabilities(v_custom) = array['view', 'edit_content'],
    'changing a role''s capabilities changes what its holders can do, immediately');
  reset role;

  -- A role in use cannot be deleted.
  perform tests.authenticate(v_admin);
  perform tests.cr_raises(format('delete from public.access_role where id = %L', v_role),
    'still used', 'a role still used to share something cannot be deleted');
  delete from public.access_grant where id = v_grant;
  delete from public.access_role where id = v_role;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 1, 'once nothing uses it, an admin deletes the role');
  reset role;

  perform tests.authenticate(v_staff);
  perform tests.ok(cardinality(public.space_capabilities(v_custom)) = 0,
    'with the share removed, access is gone');
  reset role;
end;
$$;

-- Built-in roles cannot be deleted even where row-level security does not apply.
do $$
begin
  perform tests.cr_raises('delete from public.access_role where key = ''viewer'' and organization_id is null',
    'built-in', 'the guard keeps built-in roles even for the service');
end;
$$;

-- Signed out: nothing.
do $$
begin
  perform tests.clear_auth();
  perform tests.cr_raises('select count(*) from public.access_role', 'permission denied', 'a signed-out visitor cannot read roles');
  perform tests.cr_raises('select count(*) from public.access_role_usage()', 'permission denied',
    'a signed-out visitor cannot read role usage');
  reset role;
end;
$$;

rollback;
