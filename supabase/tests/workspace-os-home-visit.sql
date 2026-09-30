-- While-you-were-away visits (M17d): each person records and reads only their
-- own Home visit, through home_away_since(); nobody writes the table directly;
-- a visit's starting point survives a reload and moves on after a gap. Every
-- role, allow and deny. Run after qa-users.sql and rls.sql; rolled back.
begin;

create function tests.home_visit_denied(p_sql text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;
grant execute on function tests.home_visit_denied(text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  v_org uuid;
  v_person uuid;
  v_first timestamptz;
  v_again timestamptz;
  v_earlier timestamptz := now() - interval '2 hours';
  v_count integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  -- Start from no visits, whatever a browser run left behind (rolled back).
  delete from public.home_visit where organization_id = v_org;

  -- The accountant is a Guest with a live ledger grant (#154).
  update public.organization_membership set role = 'guest'
  where organization_id = v_org and user_id = v_accountant;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '1 day', v_admin);

  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.home_visit'::regclass),
    'home_visit has row-level security'
  );
  perform tests.ok(
    (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'home_away_since'),
    'home_away_since is security definer with an empty search_path'
  );

  -- Every active role: records its own visit, reads only its own row, and
  -- cannot write the table directly.
  foreach v_person in array array[v_owner, v_admin, v_staff, v_volunteer, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    v_first := public.home_away_since(v_org);
    perform tests.ok(v_first is null, format('%s: the first visit has no starting point', v_person));
    v_again := public.home_away_since(v_org);
    perform tests.ok(v_again is null, format('%s: a reload keeps the visit''s starting point', v_person));

    select count(*) into v_count from public.home_visit;
    perform tests.ok(v_count = 1, format('%s reads exactly their own visit (%s rows)', v_person, v_count));
    perform tests.ok(
      tests.home_visit_denied(format(
        'insert into public.home_visit (organization_id, user_id) values (%L, %L)', v_org, gen_random_uuid())),
      format('%s cannot insert a visit directly', v_person));
    perform tests.ok(
      tests.home_visit_denied('update public.home_visit set away_since = now() - interval ''1 year'''),
      format('%s cannot rewrite a visit directly', v_person));
    perform tests.ok(
      tests.home_visit_denied('delete from public.home_visit'),
      format('%s cannot delete visits', v_person));
    reset role;
  end loop;

  -- After a gap, the next visit starts where the last one ended.
  update public.home_visit set last_seen_at = v_earlier
  where organization_id = v_org and user_id = v_staff;
  perform tests.authenticate(v_staff);
  v_first := public.home_away_since(v_org);
  perform tests.ok(v_first = v_earlier, 'a new visit starts at the previous visit''s last look');
  v_again := public.home_away_since(v_org);
  perform tests.ok(v_again = v_earlier, 'and keeps that starting point for the rest of the visit');
  reset role;

  -- Nobody reads another person's visit, even the owner.
  perform tests.authenticate(v_owner);
  select count(*) into v_count from public.home_visit where user_id <> v_owner;
  perform tests.ok(v_count = 0, 'the owner cannot read anyone else''s visit');
  begin
    perform public.home_away_since(gen_random_uuid());
    perform tests.ok(false, 'a visit cannot be recorded in another organization');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a visit cannot be recorded in another organization');
  end;
  reset role;

  -- A deactivated member can neither record nor read.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_volunteer;
  perform tests.authenticate(v_volunteer);
  begin
    perform public.home_away_since(v_org);
    perform tests.ok(false, 'a deactivated member cannot record a visit');
  exception when insufficient_privilege then
    perform tests.ok(true, 'a deactivated member cannot record a visit');
  end;
  select count(*) into v_count from public.home_visit;
  perform tests.ok(v_count = 0, 'a deactivated member reads no visits');
  reset role;
end;
$$;

-- Signed out: no rows and no function.
do $$
declare
  v_count integer;
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.home_visit_denied('select public.home_away_since(gen_random_uuid())'),
    'a signed-out caller cannot call home_away_since'
  );
  perform tests.ok(
    tests.home_visit_denied('select count(*) from public.home_visit'),
    'a signed-out caller cannot read home_visit'
  );
  reset role;
end;
$$;

rollback;
