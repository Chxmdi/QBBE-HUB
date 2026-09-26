-- message_read and channel_member_read are the rules they were, restated
-- (#115, migration 20260925030000). For every organization member at AAL1 and
-- AAL2, and one stranger, the messages and channel members each table shows
-- must be exactly those the original functions admit:
--   message:        (channel_id is not null and app.can_read_channel(channel_id))
--                   or (conversation_id is not null and app.is_conversation_member(conversation_id))
--   channel_member: app.can_read_channel(channel_id)
-- Expected rows are computed as the table owner with the reader's claims.
-- Run after qa-users.sql and rls.sql. Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_public uuid := gen_random_uuid();
  v_private uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_user record;
  v_level text;
  v_missing integer;
  v_extra integer;
  v_people integer := 0;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer);

  -- A public channel, a private one only the staff member is in, and a
  -- conversation between the owner and the volunteer, each with messages.
  insert into public.channel (id, organization_id, name, slug, type, privacy, owner_id, created_by)
  values (v_public, v_org, 'Equivalence public', 'eq-public-' || substr(v_public::text, 1, 8),
          'custom', 'public', v_owner, v_owner),
         (v_private, v_org, 'Equivalence private', 'eq-private-' || substr(v_private::text, 1, 8),
          'custom', 'private', v_owner, v_owner);
  -- Membership is granted, and channel_member follows the grants.
  insert into public.channel_access_grant (organization_id, channel_id, user_id, role, source, created_by)
  values (v_org, v_public, v_owner, 'member', 'direct', v_owner),
         (v_org, v_private, v_owner, 'member', 'direct', v_owner),
         (v_org, v_private, v_staff, 'member', 'direct', v_owner)
  on conflict do nothing;
  insert into public.conversation (id, organization_id, is_group, created_by)
  values (v_conversation, v_org, false, v_owner);
  insert into public.conversation_member (conversation_id, user_id)
  values (v_conversation, v_owner), (v_conversation, v_volunteer);
  insert into public.message (organization_id, channel_id, author_id, body)
  values (v_org, v_public, v_owner, 'eq: public'), (v_org, v_private, v_owner, 'eq: private');
  insert into public.message (organization_id, conversation_id, author_id, body)
  values (v_org, v_conversation, v_owner, 'eq: direct');

  create temp table expected_message (id uuid) on commit drop;
  create temp table expected_channel_member (channel_id uuid, user_id uuid) on commit drop;
  grant select on expected_message, expected_channel_member to authenticated;

  for v_user in
    select distinct m.user_id, true as member from public.organization_membership m
    union all
    select gen_random_uuid(), false
  loop
    foreach v_level in array case when v_user.member then array['aal1', 'aal2'] else array['aal1'] end loop
      perform tests.authenticate(v_user.user_id, v_level);

      perform set_config('role', 'postgres', true);
      truncate expected_message, expected_channel_member;
      insert into expected_message
      select id from public.message
      where (channel_id is not null and app.can_read_channel(channel_id))
         or (conversation_id is not null and app.is_conversation_member(conversation_id));
      insert into expected_channel_member
      select channel_id, user_id from public.channel_member where app.can_read_channel(channel_id);
      perform set_config('role', 'authenticated', true);

      select count(*) into v_missing from expected_message e
      where not exists (select 1 from public.message m where m.id = e.id);
      select count(*) into v_extra from public.message m
      where not exists (select 1 from expected_message e where e.id = m.id);
      perform tests.ok(v_missing = 0 and v_extra = 0,
        format('message_read matches can_read_channel/is_conversation_member for %s at %s (missing %s, extra %s)',
               v_user.user_id, v_level, v_missing, v_extra));

      select count(*) into v_missing from expected_channel_member e
      where not exists (select 1 from public.channel_member m
                        where m.channel_id = e.channel_id and m.user_id = e.user_id);
      select count(*) into v_extra from public.channel_member m
      where not exists (select 1 from expected_channel_member e
                        where e.channel_id = m.channel_id and e.user_id = m.user_id);
      perform tests.ok(v_missing = 0 and v_extra = 0,
        format('channel_member_read matches can_read_channel for %s at %s (missing %s, extra %s)',
               v_user.user_id, v_level, v_missing, v_extra));

      perform tests.clear_auth();
    end loop;
    v_people := v_people + 1;
  end loop;

  perform tests.ok(v_people >= 5, format('compared %s people', v_people));

  -- Both sides exercised: the volunteer reads the public channel and their
  -- conversation, not the private channel; the staff member reads the
  -- private channel, not the conversation.
  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.ok(
    exists (select 1 from public.message where body = 'eq: public')
      and exists (select 1 from public.message where body = 'eq: direct')
      and not exists (select 1 from public.message where body = 'eq: private'),
    'a volunteer reads the public channel and their conversation, not a private channel'
  );
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ok(
    exists (select 1 from public.message where body = 'eq: private')
      and not exists (select 1 from public.message where body = 'eq: direct'),
    'a private channel''s member reads it, and not a conversation they are not in'
  );
  perform tests.clear_auth();
end
$$;

rollback;
