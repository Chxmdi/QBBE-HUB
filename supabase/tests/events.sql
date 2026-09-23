-- P0-EVT-01/02: events, and the assignments that make somebody accountable for
-- one.
--
-- These assertions live at the database rather than beside the form, because
-- the form is not where the guarantee is. `assignEventRole` validates the role
-- with a Zod enum so it can refuse politely, but PostgREST is reachable without
-- the form at all, and the constraint and the trigger are what make the answer
-- the same either way.
--
-- Both gaps covered here were measured against the database before they were
-- fixed: an arbitrary role string was accepted, and a user whose only
-- membership was in another organization was assigned to this organization's
-- event.
--
-- Transactional; fixtures are rolled back.
begin;
do $$
declare
  owner_u uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  outsider uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd1';
  org uuid;
  other_org uuid;
  ev uuid;
  a uuid;
  n int;
  r text;
begin
  select organization_id into strict org
    from public.organization_membership where user_id = owner_u limit 1;

  -- An outsider, admitted through the real path into a different organization.
  insert into public.organization(name, slug)
    values ('Other org', 'other-org-events-test')
    returning id into other_org;
  insert into public.invitation(organization_id, email, intended_role, invited_by, expires_at)
    values (other_org, 'events-outsider@example.com', 'staff'::org_role,
            owner_u, now() + interval '30 days');
  perform tests.ensure_auth_user(outsider, 'events-outsider@example.com', 'Events Outsider');

  select count(*) into n from public.organization_membership
    where user_id = outsider and organization_id = org;
  perform tests.ok(n = 0, 'the outsider is not a member of the event organization');

  -- Fixture built as the suite builds one, before anybody authenticates.
  insert into public.event(organization_id, name, starts_at, owner_id, created_by)
    values (org, 'Community day', now() + interval '7 days', owner_u, owner_u)
    returning id into ev;
  perform tests.ok(ev is not null, 'an event can be recorded');

  perform tests.authenticate(owner_u, 'aal2');

  -- Each of the seven areas is assignable, because a constraint that refuses
  -- the real values would be worse than none.
  foreach r in array array['logistics', 'communications', 'volunteers', 'venue',
                           'content', 'registration', 'follow_up']
  loop
    insert into public.event_assignment(event_id, user_id, role)
      values (ev, staff, r);
  end loop;
  select count(*) into n from public.event_assignment where event_id = ev;
  perform tests.ok(n = 7, 'all seven event roles are assignable');

  -- The gap: `role` was plain text, so this was accepted.
  begin
    insert into public.event_assignment(event_id, user_id, role)
      values (ev, volunteer, 'not-a-real-role-at-all');
    raise exception 'FAIL: an event role outside the seven was accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a role outside the seven is refused');

  -- Case and spacing are not a way around it.
  begin
    insert into public.event_assignment(event_id, user_id, role)
      values (ev, volunteer, 'Logistics');
    raise exception 'FAIL: a differently-cased role was accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a role is matched exactly, not loosely');

  -- The second gap: the policy asked who was assigning, never who was
  -- assigned. This is the assertion that failed before the trigger existed.
  begin
    insert into public.event_assignment(event_id, user_id, role)
      values (ev, outsider, 'logistics');
    raise exception 'FAIL: a member of another organization was assigned';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'somebody from another organization cannot be assigned');

  -- Nor by editing an existing assignment into one.
  select id into a from public.event_assignment
   where event_id = ev and role = 'venue' limit 1;
  begin
    update public.event_assignment set user_id = outsider where id = a;
    raise exception 'FAIL: an assignment was edited onto an outsider';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'an assignment cannot be edited onto an outsider');

  -- A volunteer of this organization is a legitimate assignee. The guard is
  -- about belonging, not about rank.
  insert into public.event_assignment(event_id, user_id, role)
    values (ev, volunteer, 'volunteers');
  perform tests.ok(true, 'a volunteer of this organization can be assigned');

  -- A deactivated member cannot be newly assigned.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  update public.organization_membership set status = 'deactivated'
    where user_id = volunteer and organization_id = org;
  perform tests.authenticate(owner_u, 'aal2');
  begin
    insert into public.event_assignment(event_id, user_id, role)
      values (ev, volunteer, 'content');
    raise exception 'FAIL: a deactivated member was assigned';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a deactivated member cannot be newly assigned');

  -- But the assignment they already held survives, because deactivation
  -- removes access without erasing the record of what somebody was given.
  select count(*) into n from public.event_assignment
   where event_id = ev and user_id = volunteer and role = 'volunteers';
  perform tests.ok(n = 1, 'an assignment already held survives deactivation');

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  update public.organization_membership set status = 'active'
    where user_id = volunteer and organization_id = org;

  -- Who may assign at all. A volunteer can see an event they are a member of,
  -- but cannot hand out accountability for it.
  perform tests.authenticate(volunteer, 'aal1');
  select count(*) into n from public.event where id = ev;
  perform tests.ok(n = 1, 'a read-only member can see an event in their organization');
  begin
    insert into public.event_assignment(event_id, user_id, role)
      values (ev, volunteer, 'registration');
    raise exception 'FAIL: a read-only member assigned an event role';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a read-only member cannot assign an event role');

  -- An event in another organization is not visible here.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.event(organization_id, name, starts_at, owner_id, created_by)
    values (other_org, 'Someone else''s event', now() + interval '7 days', outsider, outsider);
  perform tests.authenticate(owner_u, 'aal2');
  select count(*) into n from public.event where organization_id = other_org;
  perform tests.ok(n = 0, 'an event in another organization is not readable here');
end $$;
rollback;
