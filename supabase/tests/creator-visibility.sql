-- Creators can read what they create, and no further (#112, migration
-- 20260924190000). Before it, a private channel or a conversation could not be
-- created through the product at all, because its creator could not read it
-- back before membership existed.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_conversation uuid := gen_random_uuid();
  v_untouched uuid := gen_random_uuid();
  v_channel uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_staff limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_guest);

  -- A conversation, started the way startConversation starts one.
  perform tests.authenticate(v_volunteer, 'aal1');
  insert into public.conversation (id, organization_id, is_group, created_by)
  values (v_conversation, v_org, false, v_volunteer);
  select count(*) into n from public.conversation where id = v_conversation;
  perform tests.ok(n = 1, 'the creator reads a conversation they just started, before anyone is in it');

  insert into public.conversation_member (conversation_id, user_id)
  values (v_conversation, v_volunteer), (v_conversation, v_staff);
  select count(*) into n from public.conversation_member where conversation_id = v_conversation;
  perform tests.ok(n = 2, 'the creator can add the people, which used to fail row-level security');

  -- Someone else's empty conversation stays invisible.
  insert into public.conversation (id, organization_id, is_group, created_by)
  values (v_untouched, v_org, false, v_volunteer);
  perform tests.authenticate(v_guest, 'aal1');
  select count(*) into n from public.conversation where id = v_untouched;
  perform tests.ok(n = 0, 'a conversation someone else started is invisible to a non-member, even while empty');
  select count(*) into n from public.conversation where id = v_conversation;
  perform tests.ok(n = 0, 'a non-member cannot read a conversation with members');

  -- The exception ends once people are in it: a creator who leaves loses it.
  perform tests.authenticate(v_volunteer, 'aal1');
  delete from public.conversation_member
  where conversation_id = v_conversation and user_id = v_volunteer;
  select count(*) into n from public.conversation where id = v_conversation;
  perform tests.ok(n = 0, 'a creator who leaves a conversation loses it like anyone else');

  -- A private channel, created the way createChannel creates one.
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.channel (organization_id, name, slug, type, privacy, owner_id, created_by)
  values (v_org, 'Creator visibility', 'creator-visibility-' || substr(gen_random_uuid()::text, 1, 8),
          'custom', 'private', v_staff, v_staff)
  returning id into v_channel;
  perform tests.ok(v_channel is not null,
    'a staff member can create a private channel and read it back, which used to fail row-level security');

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into n from public.channel where id = v_channel;
  perform tests.ok(n = 0, 'a private channel is invisible to someone who is neither its owner nor a member');

  perform tests.clear_auth();
end
$$;

rollback;
