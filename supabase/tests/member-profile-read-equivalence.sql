-- membership_read and profile_read are the rules they were, restated (#115,
-- migration 20260925020000). For every organization member at AAL1 and AAL2,
-- and one stranger, the rows each table shows must be exactly the rows the
-- original functions admit: app.is_org_member(organization_id) for
-- memberships, and id = auth.uid() or app.can_read_profile(id) for profiles.
--
-- The expected rows are computed as the table owner (no row-level security)
-- with the same JWT claims, then compared with what the authenticated role
-- actually reads. Run after qa-users.sql and rls.sql. Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_user record;
  v_level text;
  v_missing integer;
  v_extra integer;
  v_people integer := 0;
begin
  -- A deactivated member makes both rules non-trivial: they read nothing
  -- themselves, yet stay visible to the people they worked with.
  update public.organization_membership set status = 'deactivated'
  where user_id = v_guest
    and organization_id = (select organization_id from public.organization_membership
                           where user_id = v_owner limit 1);

  create temp table expected_membership (id uuid) on commit drop;
  create temp table expected_profile (id uuid) on commit drop;
  grant select on expected_membership, expected_profile to authenticated;

  for v_user in
    select distinct m.user_id, true as member from public.organization_membership m
    union all
    select gen_random_uuid(), false
  loop
    foreach v_level in array case when v_user.member then array['aal1', 'aal2'] else array['aal1'] end loop
      perform tests.authenticate(v_user.user_id, v_level);

      -- Expected rows, as the owner, with the reader's claims still set.
      perform set_config('role', 'postgres', true);
      truncate expected_membership, expected_profile;
      insert into expected_membership
      select id from public.organization_membership where app.is_org_member(organization_id);
      insert into expected_profile
      select id from public.user_profile
      where id = auth.uid() or app.can_read_profile(id);
      perform set_config('role', 'authenticated', true);

      select count(*) into v_missing from expected_membership e
      where not exists (select 1 from public.organization_membership m where m.id = e.id);
      select count(*) into v_extra from public.organization_membership m
      where not exists (select 1 from expected_membership e where e.id = m.id);
      perform tests.ok(v_missing = 0 and v_extra = 0,
        format('membership_read matches app.is_org_member for %s at %s (missing %s, extra %s)',
               v_user.user_id, v_level, v_missing, v_extra));

      select count(*) into v_missing from expected_profile e
      where not exists (select 1 from public.user_profile p where p.id = e.id);
      select count(*) into v_extra from public.user_profile p
      where not exists (select 1 from expected_profile e where e.id = p.id);
      perform tests.ok(v_missing = 0 and v_extra = 0,
        format('profile_read matches app.can_read_profile for %s at %s (missing %s, extra %s)',
               v_user.user_id, v_level, v_missing, v_extra));

      perform tests.clear_auth();
    end loop;
    v_people := v_people + 1;
  end loop;

  perform tests.ok(v_people >= 5, format('compared %s people', v_people));

  -- Both sides of each rule were exercised: the owner reads the deactivated
  -- guest's profile and membership; the deactivated guest reads neither
  -- anyone else's membership nor anyone else's profile.
  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(
    exists (select 1 from public.user_profile where id = v_guest)
      and exists (select 1 from public.organization_membership where user_id = v_guest),
    'an active member still sees a deactivated colleague''s profile and membership'
  );
  perform tests.authenticate(v_guest, 'aal1');
  perform tests.ok(
    not exists (select 1 from public.organization_membership where user_id <> v_guest)
      and not exists (select 1 from public.user_profile where id <> v_guest),
    'a deactivated member reads no one else''s membership or profile'
  );
  perform tests.clear_auth();
end
$$;

rollback;
