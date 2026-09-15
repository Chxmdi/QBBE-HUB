-- Run after qa-users.sql and rls.sql. All test mutations are rolled back.
begin;
do $$
declare
  u uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  o uuid;
  ch uuid := gen_random_uuid();
  dm uuid := gen_random_uuid();
  ch_msg uuid;
  n integer;
begin
  select organization_id into strict o from organization_membership where user_id = u;
  update organization_membership set status = 'active' where user_id = u and organization_id = o;
  insert into channel (id, organization_id, name, slug, privacy, type, created_by)
    values (ch, o, 'Deactivation fixture', 'deactivation-' || ch, 'private', 'custom', u);
  insert into channel_member(channel_id, user_id) values(ch, u);
  insert into conversation(id, organization_id, created_by) values(dm, o, u);
  insert into conversation_member(conversation_id, user_id) values(dm, u);
  insert into message(organization_id, channel_id, author_id, body)
    values(o, ch, u, 'Preserved channel history') returning id into ch_msg;
  insert into message(organization_id, conversation_id, author_id, body) values(o, dm, u, 'Preserved DM history');
  perform tests.authenticate(u);
  select count(*) into n from message where channel_id = ch or conversation_id = dm;
  perform tests.ok(n = 2, 'active member reads both communication histories');
  reset role;
  update organization_membership set status = 'deactivated' where user_id = u and organization_id = o;
  perform tests.authenticate(u);
  select count(*) into n from message where channel_id = ch or conversation_id = dm;
  perform tests.ok(n = 0, 'deactivated user cannot read channel or DM messages directly');
  begin
    insert into message(organization_id, channel_id, thread_root_id, author_id, body)
      values(o, ch, ch_msg, u, 'Must fail');
    raise exception 'FAIL: deactivated user replied in a channel';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into message(organization_id, conversation_id, author_id, body) values(o, dm, u, 'Must fail');
    raise exception 'FAIL: deactivated user inserted a DM';
  exception when insufficient_privilege then null;
  end;
  reset role;
  select count(*) into n from message where channel_id = ch or conversation_id = dm;
  perform tests.ok(n = 2, 'deactivation preserves historical messages');
  perform tests.ok(exists(select 1 from channel_member where channel_id=ch and user_id=u), 'deactivation preserves explicit channel grant');
  perform tests.ok(exists(select 1 from conversation_member where conversation_id=dm and user_id=u), 'deactivation preserves conversation history membership');
end;
$$;
rollback;
