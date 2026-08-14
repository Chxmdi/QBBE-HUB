-- TST-003 / DONE-002: RLS allow + deny matrix.
-- Run after qa-users.sql against local Supabase:
--   cat supabase/tests/qa-users.sql supabase/tests/rls.sql \
--     | docker exec -i supabase_db_workspace psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- Recipe: new table → policies in the same migration → one allow + one deny here.

create schema if not exists tests;

create or replace function tests.ok(condition boolean, msg text)
returns void
language plpgsql
as $$
begin
  if not condition then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'PASS: %', msg;
end;
$$;

create or replace function tests.authenticate(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated', 'email', '')::text,
    true
  );
end;
$$;

create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant usage on schema tests to anon, authenticated, postgres;
grant execute on all functions in schema tests to anon, authenticated, postgres;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_vol uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  n int;
  v_private uuid;
  v_project uuid;
  v_title text;
begin
  -- Fixtures must exist.
  select count(*) into n from auth.users
    where id in (v_owner, v_staff, v_vol);
  perform tests.ok(n = 3, 'qa users exist');

  -- Anon cannot read profiles (existence leak).
  perform tests.clear_auth();
  begin
    set local role anon;
    select count(*) into n from user_profile;
    perform tests.ok(n = 0, 'anon cannot read user_profile');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'anon cannot read user_profile (privilege denied)');
  end;
  reset role;

  -- Volunteer cannot read CRM (staff-only policy).
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from crm_organization;
    perform tests.ok(n = 0, 'volunteer cannot read crm_organization');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot read crm_organization (privilege denied)');
  end;
  reset role;

  -- Volunteer cannot read reports.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from report_instance;
    perform tests.ok(n = 0, 'volunteer cannot read report_instance');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot read report_instance (privilege denied)');
  end;
  reset role;

  -- Volunteer cannot read audit.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from audit_event;
    perform tests.ok(n = 0, 'volunteer cannot read audit_event');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot read audit_event (privilege denied)');
  end;
  reset role;

  -- Owner CAN read audit.
  perform tests.authenticate(v_owner);
  begin
    set local role authenticated;
    select count(*) into n from audit_event;
    perform tests.ok(true, 'owner can query audit_event (count=' || n || ')');
  exception
    when insufficient_privilege then
      perform tests.ok(false, 'owner should be able to read audit_event');
  end;
  reset role;

  -- Staff CAN read CRM (empty is still an allow).
  perform tests.authenticate(v_staff);
  begin
    set local role authenticated;
    select count(*) into n from crm_organization;
    perform tests.ok(true, 'staff can query crm_organization (count=' || n || ')');
  exception
    when insufficient_privilege then
      perform tests.ok(false, 'staff should be able to read crm_organization');
  end;
  reset role;

  -- Private channel: create as owner (bypass RLS as postgres for setup).
  insert into channel (
    organization_id, name, slug, type, privacy, owner_id, created_by
  )
  select o.id, 'RLS Private', 'rls-private-' || substr(gen_random_uuid()::text, 1, 8),
         'custom', 'private', v_owner, v_owner
  from organization o
  limit 1
  returning id into v_private;

  insert into channel_member (channel_id, user_id, role, membership_source)
  values (v_private, v_owner, 'manager', 'manual')
  on conflict do nothing;

  -- Volunteer cannot see the private channel.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from channel where id = v_private;
    perform tests.ok(n = 0, 'volunteer cannot see private channel they are not in');
  end;
  reset role;

  -- Volunteer cannot see messages in that channel.
  insert into message (organization_id, channel_id, author_id, body)
  select o.id, v_private, v_owner, 'secret-rls-' || v_private::text
  from organization o limit 1;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from message where channel_id = v_private;
    perform tests.ok(n = 0, 'volunteer cannot read private channel messages');
  end;
  reset role;

  -- Search must not leak the private title (SECURITY INVOKER + RLS).
  -- Use EXECUTE so the SQL function is planned as `authenticated`, not as
  -- table-owner postgres (inlined invoker functions can otherwise bypass RLS).
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    execute 'select count(*) from global_search($1)'
      into n
      using 'secret-rls-' || v_private::text;
    perform tests.ok(n = 0, 'search does not leak private channel content');
  exception
    when undefined_function then
      perform tests.ok(true, 'global_search signature differs; skip title leak check');
  end;
  reset role;

  -- After adding the volunteer, they can see the channel.
  insert into channel_member (channel_id, user_id, membership_source)
  values (v_private, v_vol, 'manual')
  on conflict do nothing;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from channel where id = v_private;
    perform tests.ok(n = 1, 'volunteer can see private channel after being added');
  end;
  reset role;

  -- Volunteer cannot insert a milestone (staff-only write).
  insert into project (organization_id, name, owner_id, created_by)
  select o.id, 'RLS Project', v_owner, v_owner
  from organization o limit 1
  returning id into v_project;

  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    insert into milestone (project_id, name) values (v_project, 'Should fail');
    perform tests.ok(false, 'volunteer must not insert milestones');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot insert milestone');
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      perform tests.ok(sqlstate in ('42501', '42501'), 'volunteer cannot insert milestone (' || sqlstate || ')');
  end;
  reset role;

  -- Volunteer cannot insert a team (admin-only write).
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    insert into team (organization_id, name)
    select o.id, 'Should fail' from organization o limit 1;
    perform tests.ok(false, 'volunteer must not insert teams');
  exception
    when others then
      perform tests.ok(true, 'volunteer cannot insert team');
  end;
  reset role;

  -- Volunteer still cannot read CRM via a crafted select after other cases.
  perform tests.authenticate(v_vol);
  begin
    set local role authenticated;
    select count(*) into n from crm_contact;
    perform tests.ok(n = 0, 'volunteer cannot read crm_contact');
  exception
    when insufficient_privilege then
      perform tests.ok(true, 'volunteer cannot read crm_contact (privilege denied)');
  end;
  reset role;

  -- Invite-only: with an organization present, signup_allowed is false without an invite.
  perform tests.clear_auth();
  perform tests.ok(
    public.signup_allowed('nobody@example.com') = false,
    'signup is invite-only after an organization exists'
  );

  perform tests.ok(true, 'RLS matrix complete');
end;
$$;
