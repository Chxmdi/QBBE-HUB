-- A member may create a notification for another member (a mention, an
-- assignment), but only an ordinary one: for an active member of the same
-- organization, never in the 'security' category (only server code raises
-- those), and with no link or an in-app path. The link rule is also a table
-- constraint, so a person cannot point their own notification off-site either.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  guest_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  former_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  outside_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  org uuid;
  refused boolean;
  n int;
  bad_link text;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  update public.organization_membership set status = 'deactivated', deactivated_at = now()
  where user_id = former_user and organization_id = org;
  delete from public.organization_membership where user_id = outside_user;

  perform tests.authenticate(guest_user, 'aal1');
  set local role authenticated;

  insert into public.notification (user_id, organization_id, category, title, link, dedupe_key)
  values (owner_user, org, 'mention', 'Guest mentioned you', '/my-work?task=1&comment=2#c', 'nf-ok:' || owner_user);
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a guest can still mention an active member with an in-app link');

  insert into public.notification (user_id, organization_id, category, title, dedupe_key)
  values (staff_user, org, 'assignment', 'No link', 'nf-nolink:' || staff_user);
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a notification without a link is still allowed');

  refused := false;
  begin
    insert into public.notification (user_id, organization_id, category, title, link)
    values (owner_user, org, 'security', 'Verify your account', '/settings');
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a member cannot create a security notification');

  foreach bad_link in array array[
    'https://evil.example/login',
    '//evil.example/login',
    '/\evil.example',
    '/"><a href="https://evil.example/login">Verify</a>',
    'javascript:alert(1)',
    '/a b'
  ] loop
    refused := false;
    begin
      insert into public.notification (user_id, organization_id, category, title, link)
      values (owner_user, org, 'mention', 'Look', bad_link);
    exception when insufficient_privilege or check_violation then refused := true;
    end;
    perform tests.ok(refused, format('a member cannot create a notification linking to %s', bad_link));
  end loop;

  insert into public.notification (user_id, organization_id, category, title, link)
  values (former_user, org, 'mention', 'Look', '/inbox');
  reset role;
  select count(*) into n from public.notification where user_id = former_user and title = 'Look';
  perform tests.ok(n = 0, 'a notification for a deactivated member is skipped, not delivered');
  perform tests.authenticate(guest_user, 'aal1');
  set local role authenticated;

  insert into public.notification (user_id, organization_id, category, title, link)
  values (outside_user, org, 'mention', 'Look', '/inbox');
  reset role;
  select count(*) into n from public.notification where user_id = outside_user and title = 'Look';
  perform tests.ok(n = 0, 'a notification for someone outside the organization is skipped, not delivered');
  perform tests.authenticate(guest_user, 'aal1');
  set local role authenticated;

  insert into public.notification (user_id, organization_id, category, title, link)
  select m.user_id, org, 'mention', 'Bulk', null
  from public.organization_membership m where m.organization_id = org
    and m.user_id <> guest_user
  union all select former_user, org, 'mention', 'Bulk', null;
  reset role;
  select count(*) into n from public.notification where title = 'Bulk' and user_id = former_user;
  perform tests.ok(n = 0, 'a bulk insert skips the recipient who left');
  select count(*) into n from public.notification where title = 'Bulk';
  perform tests.ok(n > 0, 'and still notifies the active members');
  perform tests.authenticate(guest_user, 'aal1');
  set local role authenticated;

  refused := false;
  begin
    insert into public.notification (user_id, organization_id, category, title, urgency)
    values (owner_user, org, 'announcement', 'IT: re-verify your account', 'critical');
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a member cannot invent an announcement notification');

  refused := false;
  begin
    insert into public.notification (user_id, organization_id, category, title, urgency, source_type, source_id)
    values (owner_user, org, 'announcement', 'Fake', 'critical', 'announcement', gen_random_uuid());
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a member cannot point an announcement notification at an announcement they did not publish');

  -- The recipient cannot repoint their own notification off-site either.
  reset role;
  perform tests.authenticate(owner_user, 'aal2');
  set local role authenticated;
  refused := false;
  begin
    update public.notification set link = 'https://evil.example'
    where user_id = owner_user and dedupe_key = 'nf-ok:' || owner_user;
  exception when check_violation then refused := true;
  end;
  perform tests.ok(refused, 'a stored notification link cannot be changed to an outside address');

  -- Server code (the service role and definer functions) keeps raising
  -- security notifications.
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  insert into public.notification (user_id, organization_id, category, title, link, dedupe_key)
  values (owner_user, org, 'security', 'New sign-in', '/settings/security', 'nf-sec:' || owner_user);
  get diagnostics n = row_count;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform tests.ok(n = 1, 'the service role can still create a security notification');
end;
$$;
rollback;
