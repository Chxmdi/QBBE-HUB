-- sidebar_state() (migration 20261120100000) answers, in one call, what the
-- workspace layout used to ask in up to fourteen: the unread notification
-- count, the open task count, an unread flag for every channel the person is
-- in, and how many direct conversations have unread messages. For the owner,
-- staff, volunteer and guest it must equal the separate queries it replaced,
-- read through row-level security as that person. A staff member in twelve
-- channels must see the twelfth unread (the layout used to check only ten),
-- and a channel the person can no longer read must not be reported.
-- Run after qa-users.sql and rls.sql. Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_other_org uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  v_mandatory uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_read_conversation uuid := gen_random_uuid();
  v_replied_conversation uuid := gen_random_uuid();
  v_channels uuid[] := array[]::uuid[];
  v_channel uuid;
  v_person uuid;
  v_state jsonb;
  v_expected jsonb;
  v_count bigint;
  v_tasks bigint;
  v_dm bigint;
  i integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_guest);

  -- Twelve channels the staff member is in, read up to now, oldest activity
  -- first; the owner then posts in the twelfth.
  for i in 1..12 loop
    v_channel := gen_random_uuid();
    v_channels := v_channels || v_channel;
    insert into public.channel (id, organization_id, name, slug, type, privacy, owner_id, created_by)
    values (v_channel, v_org, 'Sidebar ' || i, 'sidebar-' || i || '-' || substr(v_channel::text, 1, 8),
            'custom', 'private', v_owner, v_owner);
    insert into public.channel_access_grant (organization_id, channel_id, user_id, role, source, created_by)
    values (v_org, v_channel, v_staff, 'member', 'direct', v_owner),
           (v_org, v_channel, v_owner, 'member', 'direct', v_owner);
    insert into public.message (organization_id, channel_id, author_id, body, created_at)
    values (v_org, v_channel, v_owner, 'Earlier ' || i, now() - interval '2 days' + i * interval '1 minute');
  end loop;
  update public.channel_member set last_read_at = now() - interval '1 day'
  where channel_id = any (v_channels);
  insert into public.message (organization_id, channel_id, author_id, body)
  values (v_org, v_channels[12], v_owner, 'New in the twelfth');
  -- A message the staff member wrote themselves does not make a channel unread.
  insert into public.message (organization_id, channel_id, author_id, body, created_at)
  values (v_org, v_channels[11], v_staff, 'My own', now() - interval '1 minute');

  -- A mandatory channel with no recent activity is still listed first.
  insert into public.channel (id, organization_id, name, slug, type, privacy, owner_id, created_by, is_mandatory)
  values (v_mandatory, v_org, 'Sidebar mandatory', 'sidebar-mandatory-' || substr(v_mandatory::text, 1, 8),
          'custom', 'private', v_owner, v_owner, true);
  insert into public.channel_access_grant (organization_id, channel_id, user_id, role, source, created_by)
  values (v_org, v_mandatory, v_staff, 'member', 'direct', v_owner);

  -- A channel in another organization, with a membership row and a new
  -- message: unreadable to the staff member, so never reported.
  insert into public.organization (id, name, slug)
  values (v_other_org, 'Sidebar other org', 'sidebar-other-' || substr(v_other_org::text, 1, 8));
  insert into public.channel (id, organization_id, name, slug, type, privacy, owner_id, created_by)
  values (v_foreign, v_other_org, 'Foreign', 'foreign-' || substr(v_foreign::text, 1, 8),
          'custom', 'public', null, null);
  -- The row is left behind as by a removed membership; written without the
  -- triggers that would refuse it today.
  set local session_replication_role = replica;
  insert into public.channel_member (channel_id, user_id, last_read_at)
  values (v_foreign, v_staff, now() - interval '1 day');
  set local session_replication_role = origin;
  insert into public.message (organization_id, channel_id, author_id, body)
  values (v_other_org, v_foreign, v_owner, 'Not yours');

  -- Two conversations with the staff member: one with an unread message from
  -- the owner, one read up to date.
  insert into public.conversation (id, organization_id, created_by)
  values (v_conversation, v_org, v_owner), (v_read_conversation, v_org, v_owner);
  insert into public.conversation_member (conversation_id, user_id, last_read_at)
  values (v_conversation, v_owner, now()), (v_conversation, v_staff, now() - interval '1 day'),
         (v_read_conversation, v_owner, now()), (v_read_conversation, v_staff, now() + interval '1 minute');
  insert into public.message (organization_id, conversation_id, author_id, body)
  values (v_org, v_conversation, v_owner, 'Direct, unread'),
         (v_org, v_read_conversation, v_owner, 'Direct, read');
  -- A third where the staff member replied last, with an old read cursor:
  -- /messages shows it as read, so it is not counted.
  insert into public.conversation (id, organization_id, created_by)
  values (v_replied_conversation, v_org, v_owner);
  insert into public.conversation_member (conversation_id, user_id, last_read_at)
  values (v_replied_conversation, v_owner, now()),
         (v_replied_conversation, v_staff, now() - interval '1 hour');
  insert into public.message (organization_id, conversation_id, author_id, body, created_at)
  values (v_org, v_replied_conversation, v_owner, 'Hi', now() - interval '10 minutes'),
         (v_org, v_replied_conversation, v_staff, 'My reply', now() - interval '5 minutes');

  -- Three unread notifications and one read one for the staff member, one
  -- unread for the volunteer.
  insert into public.notification (user_id, organization_id, category, title, read_at)
  values (v_staff, v_org, 'mention', 'Sidebar 1', null),
         (v_staff, v_org, 'mention', 'Sidebar 2', null),
         (v_staff, v_org, 'mention', 'Sidebar 3', null),
         (v_staff, v_org, 'mention', 'Sidebar read', now()),
         (v_volunteer, v_org, 'mention', 'Sidebar volunteer', null);

  -- Equal to the separate queries, as each person.
  foreach v_person in array array[v_owner, v_staff, v_volunteer, v_guest] loop
    perform tests.authenticate(v_person, 'aal2');
    select public.sidebar_state() into v_state;

    select count(*) into v_count from public.notification where read_at is null;
    perform tests.ok((v_state ->> 'unread_notifications')::bigint = v_count,
      format('%s: unread notifications %s = %s', v_person, v_state ->> 'unread_notifications', v_count));

    select public.my_open_task_count() into v_tasks;
    perform tests.ok((v_state ->> 'open_tasks')::bigint = v_tasks,
      format('%s: open tasks %s = %s', v_person, v_state ->> 'open_tasks', v_tasks));

    -- The layout's old per-channel probe, for every membership it can read.
    select coalesce(jsonb_object_agg(c.id, exists (
             select 1 from public.message m
             where m.channel_id = c.id and m.created_at > cm.last_read_at and m.author_id <> v_person
           )), '{}'::jsonb)
      into v_expected
    from public.channel_member cm
    join public.channel c on c.id = cm.channel_id
    where cm.user_id = v_person and c.archived_at is null;
    perform tests.ok(
      (select coalesce(jsonb_object_agg(ch ->> 'id', (ch ->> 'unread')::boolean), '{}'::jsonb)
       from jsonb_array_elements(v_state -> 'channels') ch) = v_expected,
      format('%s: an unread flag for every readable channel, matching the old probe', v_person));

    -- /messages' rule: a conversation is unread when its latest message is
    -- someone else's and after the person's read cursor.
    select count(*) into v_dm
    from public.conversation_member cm
    where cm.user_id = v_person
      and (select m.created_at > cm.last_read_at and m.author_id <> v_person
           from public.message m
           where m.conversation_id = cm.conversation_id
           order by m.created_at desc limit 1);
    perform tests.ok((v_state ->> 'unread_conversations')::bigint = v_dm,
      format('%s: unread conversations %s = %s', v_person, v_state ->> 'unread_conversations', v_dm));
    perform tests.clear_auth();
  end loop;

  -- The staff member's specifics.
  perform tests.authenticate(v_staff, 'aal1');
  select public.sidebar_state() into v_state;
  perform tests.ok(
    exists (select 1 from jsonb_array_elements(v_state -> 'channels') ch
            where ch ->> 'id' = v_channels[12]::text and (ch ->> 'unread')::boolean),
    'staff in twelve channels sees the twelfth unread');
  perform tests.ok(
    exists (select 1 from jsonb_array_elements(v_state -> 'channels') ch
            where ch ->> 'id' = v_channels[11]::text and not (ch ->> 'unread')::boolean),
    'a channel whose only new message is your own is not unread');
  perform tests.ok(
    not exists (select 1 from jsonb_array_elements(v_state -> 'channels') ch
                where ch ->> 'id' = v_foreign::text),
    'a channel the person cannot read is not reported');
  perform tests.ok(
    (select count(*) from jsonb_array_elements(v_state -> 'channels') ch
     where ch ->> 'id' = any (v_channels::text[])) = 12,
    'all twelve channels are reported, not the first ten');
  perform tests.ok(v_state -> 'channels' -> 0 ->> 'id' in (
      select c.id::text from public.channel c
      join public.channel_member cm on cm.channel_id = c.id and cm.user_id = v_staff
      where c.is_mandatory),
    'mandatory channels come first');
  -- After the mandatory ones, most recent activity first: the twelfth, then the eleventh.
  perform tests.ok(
    (select array_agg(ch ->> 'id' order by ord)
     from jsonb_array_elements(v_state -> 'channels') with ordinality as t(ch, ord)
     where ch ->> 'id' = any (array[v_channels[12]::text, v_channels[11]::text, v_channels[1]::text]))
      = array[v_channels[12]::text, v_channels[11]::text, v_channels[1]::text],
    'then the most recently active');
  perform tests.ok((v_state ->> 'unread_notifications')::int >= 3,
    'the staff member''s unread notifications are counted, the read one is not');
  perform tests.ok((v_state ->> 'unread_conversations')::int = 1,
    'the unread direct message is counted; one you replied to last is not');
  perform tests.clear_auth();

  -- Anonymous callers cannot run it.
  begin
    set local role anon;
    perform public.sidebar_state();
    perform tests.ok(false, 'anon cannot call sidebar_state');
  exception when insufficient_privilege then
    perform tests.ok(true, 'anon cannot call sidebar_state');
  end;
  reset role;

  perform tests.ok(
    not has_function_privilege('public', 'public.sidebar_state()', 'execute'),
    'PUBLIC has no execute on sidebar_state');
  perform tests.ok(
    not (select prosecdef from pg_proc where oid = 'public.sidebar_state()'::regprocedure),
    'sidebar_state runs as the caller, under row-level security');
end
$$;

rollback;
