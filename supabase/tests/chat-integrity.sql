-- A message's author may change only its text (and soft-delete it); where it
-- was posted, who wrote it, when, and whether it is a system message are
-- fixed. Only administrators make a channel the announcements channel or
-- mandatory, and an organization has one mandatory announcements channel.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  guest_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  org uuid;
  general uuid;
  announcements uuid;
  owner_post uuid;
  msg uuid;
  own_channel uuid;
  refused boolean;
  n int;
  r record;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  perform tests.ensure_verified_mfa_factor(admin_user);
  select id into strict general from public.channel where organization_id = org and name = 'General';
  select id into strict announcements from public.channel
  where organization_id = org and type = 'announcements' and is_mandatory;
  insert into public.channel_member (channel_id, user_id) values (general, guest_user)
  on conflict do nothing;
  insert into public.message (organization_id, channel_id, author_id, body)
  values (org, general, owner_user, 'CI owner post') returning id into owner_post;

  perform tests.authenticate(guest_user, 'aal1');
  set local role authenticated;
  insert into public.message (organization_id, channel_id, author_id, body)
  values (org, general, guest_user, 'CI guest post') returning id into msg;

  refused := false;
  begin
    update public.message set channel_id = announcements where id = msg;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an author cannot move their message into the announcements channel');

  refused := false;
  begin
    update public.message set is_system = true where id = msg;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an author cannot mark their message as a system message');

  refused := false;
  begin
    update public.message set created_at = '2020-01-01' where id = msg;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an author cannot backdate their message');

  refused := false;
  begin
    update public.message set thread_root_id = owner_post where id = msg;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an author cannot move their message into someone else''s thread');

  refused := false;
  begin
    insert into public.message (organization_id, channel_id, author_id, body, thread_root_id)
    values (org, announcements, guest_user, 'CI stray reply', owner_post);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a reply cannot point at a message in another channel');

  update public.message set body = 'CI guest post (edited)', edited_at = now() where id = msg;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'an author can still edit their message');
  update public.message set deleted_at = now() where id = msg;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'an author can still delete their message');

  insert into public.message (organization_id, channel_id, author_id, body, is_system, created_at)
  values (org, general, guest_user, 'CI forged system', true, '2020-01-01') returning id into msg;
  reset role;
  select is_system, created_at into r from public.message where id = msg;
  perform tests.ok(not r.is_system and r.created_at > now() - interval '1 minute',
    'a new message cannot be posted as a system message or backdated');

  -- A meeting summary is still posted as a system message for its meeting.
  declare
    v_meeting uuid;
  begin
    insert into public.meeting (organization_id, title, starts_at, channel_id, organizer_id)
    values (org, 'CI meeting', now(), general, owner_user) returning id into v_meeting;
    perform tests.authenticate(owner_user, 'aal2');
    set local role authenticated;
    perform public.complete_meeting(v_meeting, 'CI meeting summary');
    reset role;
    select is_system, source_record_type, source_record_id into r
    from public.message where body = 'CI meeting summary';
    perform tests.ok(r.is_system and r.source_record_type = 'meeting' and r.source_record_id = v_meeting,
      'a meeting summary is still a system message linked to its meeting');
  end;

  -- Administrators moderate anyone's message.
  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  update public.message set deleted_at = now() where id = owner_post;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'an administrator can delete someone else''s message');

  -- Channels.
  reset role;
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  insert into public.channel (organization_id, name, slug, owner_id, created_by)
  values (org, 'CI staff channel', 'ci-staff-channel', staff_user, staff_user) returning id into own_channel;
  refused := false;
  begin
    update public.channel set type = 'announcements', is_mandatory = true where id = own_channel;
  exception when insufficient_privilege or unique_violation then refused := true;
  end;
  perform tests.ok(refused, 'a channel owner cannot turn their channel into an announcements channel');
  refused := false;
  begin
    update public.channel set is_mandatory = true where id = own_channel;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a channel owner cannot make their channel mandatory');
  update public.channel set topic = 'CI topic' where id = own_channel;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a channel owner can still edit their channel');
  refused := false;
  begin
    insert into public.channel (organization_id, name, slug, owner_id, created_by, type, is_mandatory)
    values (org, 'CI fake announcements', 'ci-fake-ann', staff_user, staff_user, 'announcements', true);
  exception when insufficient_privilege or unique_violation then refused := true;
  end;
  perform tests.ok(refused, 'staff cannot create a mandatory announcements channel');

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  refused := false;
  begin
    insert into public.channel (organization_id, name, slug, type, is_mandatory)
    values (org, 'CI second announcements', 'ci-second-ann', 'announcements', true);
  exception when unique_violation then refused := true;
  end;
  perform tests.ok(refused, 'an organization has only one mandatory announcements channel');
end;
$$;
rollback;
