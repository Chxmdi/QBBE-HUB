-- EXT-CHANNELS (#42): large private history is readable, page by page, by
-- a member; removing that member closes every way back in (list, permalink,
-- reply) without destroying the history; and every effective membership
-- records why it exists.
begin;
do $$
declare
  author uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  reader uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  o uuid;
  ch uuid := gen_random_uuid();
  first_msg uuid;
  cursor_at timestamptz;
  cursor_id uuid;
  seen uuid[] := '{}';
  page_ids uuid[];
  n integer;
begin
  select a.organization_id into strict o
    from organization_membership a
    join organization_membership b on b.organization_id = a.organization_id
    where a.user_id = author and b.user_id = reader
    limit 1;
  update organization_membership set status = 'active'
    where organization_id = o and user_id in (author, reader);

  insert into channel (id, organization_id, name, slug, privacy, type, created_by)
    values (ch, o, 'History fixture', 'history-' || ch, 'private', 'custom', author);
  insert into channel_member (channel_id, user_id) values (ch, author), (ch, reader);

  -- One statement, so all 150 share a created_at: the case that a
  -- timestamp-only cursor used to skip at every page boundary.
  insert into message (organization_id, channel_id, author_id, body)
    select o, ch, author, 'History ' || i from generate_series(1, 150) as i;
  select id into first_msg from message where channel_id = ch order by created_at, id limit 1;

  perform tests.authenticate(reader);

  select count(*) into n from message where channel_id = ch;
  perform tests.ok(n = 150, 'a member reads the whole private history');

  -- Scroll back exactly as the channel view does: the newest page, then
  -- (same instant, smaller id) together with (earlier instant), 100 at a time.
  select array_agg(id), (array_agg(created_at order by created_at, id))[1], (array_agg(id order by created_at, id))[1]
    into page_ids, cursor_at, cursor_id
    from (select id, created_at from message where channel_id = ch
          order by created_at desc, id desc limit 100) newest;
  seen := seen || page_ids;
  loop
    select array_agg(id), (array_agg(created_at order by created_at, id))[1], (array_agg(id order by created_at, id))[1]
      into page_ids, cursor_at, cursor_id
      from (
        select id, created_at from (
          (select id, created_at from message
            where channel_id = ch and created_at = cursor_at and id < cursor_id
            order by id desc limit 100)
          union all
          (select id, created_at from message
            where channel_id = ch and created_at < cursor_at
            order by created_at desc, id desc limit 100)
        ) both_halves
        order by created_at desc, id desc limit 100
      ) older;
    exit when page_ids is null;
    seen := seen || page_ids;
  end loop;
  perform tests.ok(
    cardinality(seen) = 150 and (select count(distinct x) from unnest(seen) x) = 150,
    'scrolling back pages through all 150 messages exactly once despite a shared timestamp');

  reset role;
  delete from channel_access_grant where channel_id = ch and user_id = reader;
  perform tests.ok(
    not exists (select 1 from channel_member where channel_id = ch and user_id = reader),
    'removing the last grant removes the effective membership');

  perform tests.authenticate(reader);
  select count(*) into n from message where channel_id = ch;
  perform tests.ok(n = 0, 'a removed member cannot list the private history');
  select count(*) into n from message where id = first_msg;
  perform tests.ok(n = 0, 'a removed member cannot open a message by its permalink');
  begin
    insert into message (organization_id, channel_id, thread_root_id, author_id, body)
      values (o, ch, first_msg, reader, 'Must fail');
    raise exception 'FAIL: a removed member replied in a private channel';
  exception when insufficient_privilege then null;
  end;
  perform tests.ok(true, 'a removed member cannot reply in the private channel');

  reset role;
  select count(*) into n from message where channel_id = ch;
  perform tests.ok(n = 150, 'removing a member leaves the history intact');

  perform tests.authenticate(author);
  select count(*) into n from message where channel_id = ch;
  perform tests.ok(n = 150, 'remaining members still read the whole history');

  reset role;
  select count(*) into n
    from channel_member m
    where not exists (
      select 1 from channel_access_grant g
      where g.channel_id = m.channel_id and g.user_id = m.user_id
    );
  perform tests.ok(n = 0, 'every effective channel membership records why it exists');

  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
