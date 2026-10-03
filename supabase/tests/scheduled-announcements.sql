-- A scheduled announcement stays hidden until its publish time
-- (20261112010000_scheduled_announcements_wait.sql). Run after qa-users.sql
-- and rls.sql; everything is rolled back.
--
-- Fixture people: owner a1, staff a2, admin a4.
begin;

create or replace function tests.ack_allowed(p_announcement uuid, p_user uuid)
returns boolean
language plpgsql
as $$
begin
  insert into public.announcement_acknowledgment (announcement_id, user_id)
  values (p_announcement, p_user);
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

do $$
declare
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_other_org uuid;
  v_other_channel uuid;
  v_other_message uuid;
  v_other_announcement uuid;
  v_channel uuid;
  v_message uuid;
  v_now_ann uuid;
  v_later uuid;
  v_due uuid;
  v_released uuid;
  v_count integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_staff;
  select id into strict v_channel
  from public.channel
  where organization_id = v_org and type = 'announcements' and is_mandatory;

  -- Another organization's announcement, for the cross-organization check.
  insert into public.organization (name, slug)
  values ('Elsewhere', 'elsewhere-' || substr(md5(random()::text), 1, 8))
  returning id into v_other_org;
  insert into public.channel (organization_id, name, slug, type, is_mandatory, created_by)
  values (v_other_org, 'Other news', 'other-news-' || substr(md5(random()::text), 1, 8), 'announcements', true, v_admin)
  returning id into v_other_channel;
  insert into public.message (organization_id, channel_id, author_id, body)
  values (v_other_org, v_other_channel, v_admin, 'Other body') returning id into v_other_message;
  insert into public.announcement (organization_id, message_id, title, created_by)
  values (v_other_org, v_other_message, 'Other', v_admin) returning id into v_other_announcement;

  -- -------------------------------------------------------------------------
  -- Shape and hardening
  -- -------------------------------------------------------------------------
  perform tests.ok(
    not has_function_privilege('authenticated', 'public.release_scheduled_announcement(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.release_scheduled_announcement(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.release_scheduled_announcement(uuid)', 'execute'),
    'only the job (service role) can post a waiting announcement'
  );

  begin
    insert into public.announcement (organization_id, title, created_by)
    values (v_org, 'No text anywhere', v_admin);
    perform tests.ok(false, 'an announcement with neither a message nor waiting text is rejected');
  exception when check_violation then
    perform tests.ok(true, 'an announcement with neither a message nor waiting text is rejected');
  end;

  -- -------------------------------------------------------------------------
  -- An administrator publishes one now and schedules two
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_admin, 'aal2');
  insert into public.message (organization_id, channel_id, author_id, body)
  values (v_org, v_channel, v_admin, 'Published now body') returning id into v_message;
  insert into public.announcement (organization_id, message_id, title, created_by)
  values (v_org, v_message, 'Published now', v_admin) returning id into v_now_ann;
  insert into public.announcement (organization_id, title, created_by, body, channel_id, publish_at)
  values (v_org, 'Later', v_admin, 'Secret until Friday', v_channel, now() + interval '3 days')
  returning id into v_later;
  insert into public.announcement (organization_id, title, created_by, body, channel_id, publish_at)
  values (v_org, 'Due', v_admin, 'Due text', v_channel, now() - interval '1 minute')
  returning id into v_due;

  select count(*) into v_count from public.announcement where id in (v_later, v_due);
  perform tests.ok(v_count = 2, 'administrators can read waiting announcements');
  reset role;

  -- -------------------------------------------------------------------------
  -- Staff cannot read or acknowledge what is waiting
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.announcement where id in (v_later, v_due);
  perform tests.ok(v_count = 0, 'staff cannot read a scheduled announcement before it is posted');
  select count(*) into v_count from public.message where body = 'Secret until Friday';
  perform tests.ok(v_count = 0, 'the scheduled text is not in any channel message');
  select count(*) into v_count from public.announcement where id = v_now_ann;
  perform tests.ok(v_count = 1, 'staff read an announcement published now');

  perform tests.ok(not tests.ack_allowed(v_later, v_staff), 'staff cannot acknowledge a scheduled announcement');
  perform tests.ok(
    not tests.ack_allowed(v_other_announcement, v_staff),
    'staff cannot acknowledge another organization''s announcement'
  );
  perform tests.ok(tests.ack_allowed(v_now_ann, v_staff), 'staff acknowledge a posted announcement');
  reset role;

  -- -------------------------------------------------------------------------
  -- The job posts what is due, once, and leaves the rest waiting
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_released := public.release_scheduled_announcement(v_due);
  perform tests.ok(v_released is not null, 'a due announcement is posted');
  perform tests.ok(
    public.release_scheduled_announcement(v_due) is null,
    'posting it again reports nothing new and posts nothing'
  );
  select count(*) into v_count from public.message where body = 'Due text';
  perform tests.ok(v_count = 1, 'the due text is posted exactly once');
  perform tests.ok(
    (select channel_id = v_channel and author_id = v_admin from public.message where id = v_released),
    'the message lands in the announcements channel under its author'
  );
  perform tests.ok(
    (select message_id = v_released and body is null and channel_id is null
     from public.announcement where id = v_due),
    'the announcement points at its message and no longer holds the text'
  );
  perform tests.ok(
    public.release_scheduled_announcement(v_later) is null
      and (select message_id is null from public.announcement where id = v_later),
    'an announcement that is not due yet stays waiting'
  );
  perform tests.ok(
    public.release_scheduled_announcement(gen_random_uuid()) is null,
    'an unknown announcement posts nothing'
  );
  perform set_config('request.jwt.claims', '', true);

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.announcement where id = v_due;
  perform tests.ok(v_count = 1, 'staff read the announcement once it is posted');
  perform tests.ok(tests.ack_allowed(v_due, v_staff), 'staff acknowledge it once it is posted');
  reset role;
end;
$$;

rollback;
