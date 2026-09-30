-- Insight map lens (V2-1, epic #199): the lens adds no table. It reads events
-- and their location through the viewer's own session, so a place appears on
-- the map only for someone the event's own rules let read it. Checked for
-- every role: owner, admin, staff, member (guest), volunteer, the external
-- accountant (a guest with a ledger grant) and signed-out.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_event uuid;
  v_role record;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);

  -- An organization-wide event nobody else is assigned to.
  insert into public.event (organization_id, name, starts_at, location, owner_id, created_by)
  values (v_org, 'Map check', now() + interval '3 days', '45.5019, -73.5674', v_owner, v_owner)
  returning id into v_event;

  for v_role in select * from (values (v_owner, 'owner'), (v_admin, 'admin')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.event where id = v_event and location = '45.5019, -73.5674';
    perform tests.ok(n = 1, v_role.name || ' sees the event and its location');
    reset role;
  end loop;

  for v_role in select * from (values
      (v_staff, 'staff'), (v_volunteer, 'volunteer'), (v_guest, 'member (guest) and accountant')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select count(*) into n from public.event where id = v_event;
    perform tests.ok(n = 0, v_role.name || ' does not see an event they are not part of');
    reset role;
  end loop;

  -- Assigned to the event: now it is on their map.
  insert into public.event_assignment (event_id, user_id, role) values (v_event, v_volunteer, 'venue');
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.event where id = v_event;
  perform tests.ok(n = 1, 'a volunteer assigned to the event sees it');
  reset role;

  perform tests.clear_auth();
  select count(*) into n from public.event where id = v_event;
  perform tests.ok(n = 0, 'signed-out: no events');
  reset role;
end;
$$;

rollback;
