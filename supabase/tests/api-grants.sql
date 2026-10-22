-- API role grants (migration 20261119100000). Proves access to the public
-- schema comes from explicit grants, not from Supabase's automatic ones:
-- signed-out visitors reach only published pages, signed-in users keep the
-- table access the app uses, nobody but the owner can TRUNCATE, and new
-- objects are not granted to the API roles by default. Run after
-- qa-users.sql and rls.sql. All changes are rolled back.
begin;

do $$
declare
  v_count int;
  v_list text;
  v_error text;
begin
  -- Signed-out visitors.
  perform tests.ok(not has_table_privilege('anon', 'public.task', 'insert'), 'anon cannot insert tasks');
  perform tests.ok(not has_table_privilege('anon', 'public.task', 'select'), 'anon cannot read tasks');
  perform tests.ok(has_table_privilege('anon', 'public.published_page', 'select'), 'anon can read published pages');

  select count(*), string_agg(c.relname, ', ' order by c.relname) into v_count, v_list
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
    and c.relname <> 'published_page'
    and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
      or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'));
  perform tests.ok(v_count = 0, format('anon holds no other table or view privilege (%s)', coalesce(v_list, 'none')));

  -- Signed-in users keep what the app uses; row-level security still applies.
  perform tests.ok(has_table_privilege('authenticated', 'public.task', 'select'), 'authenticated can read tasks');
  perform tests.ok(has_table_privilege('authenticated', 'public.task', 'insert'), 'authenticated can insert tasks');
  perform tests.ok(has_table_privilege('authenticated', 'public.organization', 'select'), 'authenticated can read organizations');
  perform tests.ok(has_table_privilege('authenticated', 'public.notification', 'select'), 'authenticated can read notifications');

  -- No API role may TRUNCATE (it ignores row-level security) or add triggers.
  select count(*), string_agg(c.relname, ', ' order by c.relname) into v_count, v_list
  from pg_class c, unnest(array['anon', 'authenticated', 'service_role']) r(role)
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and (has_table_privilege(r.role, c.oid, 'truncate') or has_table_privilege(r.role, c.oid, 'trigger')
      or has_table_privilege(r.role, c.oid, 'references'));
  perform tests.ok(v_count = 0, format('no API role can truncate, add triggers or reference (%s)', coalesce(v_list, 'none')));

  -- Every table and view is reachable by the service role, so a missing grant
  -- shows up here rather than as "permission denied" in a job.
  select count(*), string_agg(c.relname, ', ' order by c.relname) into v_count, v_list
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
    and not has_table_privilege('service_role', c.oid, 'select');
  perform tests.ok(v_count = 0, format('the service role can read every table and view (%s)', coalesce(v_list, 'none')));

  -- New objects get no automatic grants.
  select count(*) into v_count
  from pg_default_acl d, aclexplode(d.defaclacl) a
  where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
    and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole);
  perform tests.ok(v_count = 0, 'no default privileges for the API roles on new public objects');

  create table public.tests_api_grants_probe (id int);
  perform tests.ok(not has_table_privilege('authenticated', 'public.tests_api_grants_probe', 'select')
      and not has_table_privilege('anon', 'public.tests_api_grants_probe', 'select'),
    'a new table is not granted to the API roles until a migration grants it');

  -- A signed-out query is refused outright rather than filtered to nothing.
  set local role anon;
  begin
    perform 1 from public.task limit 1;
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  reset role;
  perform tests.ok(v_error ilike '%permission denied%', format('anon reading tasks is refused (%s)', coalesce(v_error, 'no error')));
end;
$$;

rollback;
