-- A second notification about the same record reaches the person again
-- (migration 20261118140000). Proves: create_notifications inserts a new
-- notification under the caller's own insert rule; when the person already
-- has one for the same event (same dedupe key), it is re-opened (unread,
-- refreshed, reasons merged) instead of being dropped, even though the
-- caller cannot read it; a read one re-opening queues exactly one more
-- email, an unread one queues none; a person's Hub mute still applies on
-- that path; the caller still cannot read the person's notifications; a
-- call the insert rule refuses changes nothing; anon cannot call it. All
-- mutations are rolled back.
begin;

create function tests.nu_raises(p_sql text, p_pattern text, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
    v_error := null;
  exception when others then
    v_error := sqlstate || ' ' || sqlerrm;
  end;
  perform tests.ok(v_error is not null and v_error ilike '%' || p_pattern || '%',
    format('%s (%s)', p_msg, coalesce(v_error, 'no error')));
end;
$$;
grant execute on function tests.nu_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_lead uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_pm uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
  v_org uuid;
  v_other_org uuid;
  v_row jsonb;
  v_count integer;
  v_queued_before bigint;
  v_queued bigint;
  v_title text;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_staff limit 1;
  insert into public.organization (name, slug) values ('Notify other org', 'notify-other-org')
  returning id into v_other_org;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_lead, v_pm);
  delete from public.notification where user_id = v_pm and dedupe_key like 'nu-test:%';
  delete from public.notification_preference where user_id = v_pm;

  v_row := jsonb_build_object('user_id', v_pm, 'organization_id', v_org, 'category', 'mention',
    'title', 'QA Staff mentioned you', 'source_type', 'project', 'link', '/projects/x',
    'dedupe_key', 'nu-test:project:x:' || v_pm, 'reason', 'mentioned');

  -- qa-staff mentions qa-pm.
  perform tests.authenticate(v_staff, 'aal1');
  v_count := public.create_notifications(jsonb_build_array(v_row));
  perform tests.ok(v_count = 1, 'the first notification is created');
  select count(*) into v_count from public.notification where user_id = v_pm;
  perform tests.ok(v_count = 0, 'the sender cannot read the person''s notifications');
  perform tests.clear_auth(); reset role;

  -- qa-pm reads it.
  update public.notification set read_at = now() - interval '1 hour', created_at = now() - interval '2 hours'
  where user_id = v_pm and dedupe_key = v_row->>'dedupe_key';
  select count(*) into v_queued_before from pgmq.q_notifications;

  -- Later qa-lead mentions qa-pm on the same project.
  perform tests.authenticate(v_lead, 'aal1');
  v_count := public.create_notifications(jsonb_build_array(v_row
    || jsonb_build_object('title', 'QA Lead mentioned you', 'reason', 'mentioned, followed')));
  perform tests.ok(v_count = 0, 'the repeat creates no second row');
  perform tests.clear_auth(); reset role;

  select count(*) into v_count from public.notification where user_id = v_pm and dedupe_key = v_row->>'dedupe_key';
  perform tests.ok(v_count = 1, 'still one notification for the event');
  select * into r from public.notification where user_id = v_pm and dedupe_key = v_row->>'dedupe_key';
  perform tests.ok(r.read_at is null and r.created_at > now() - interval '1 minute'
    and r.title = 'QA Lead mentioned you' and r.reason = 'mentioned, followed',
    format('the repeat re-opens it, unread and refreshed, reasons merged (%s)', r.reason));
  select count(*) into v_queued from pgmq.q_notifications;
  perform tests.ok(v_queued = v_queued_before + 1, format('re-opening a read notification queues one email (%s)', v_queued - v_queued_before));
  perform tests.ok(exists (select 1 from pgmq.q_notifications q
    where q.message->>'notification_id' = r.id::text and q.message->>'dedupe_key' like (v_row->>'dedupe_key') || ':reopened:%'),
    'that email has its own delivery key, so the first email''s key does not swallow it');

  -- Repeating again while it is still unread sends no further email.
  perform tests.authenticate(v_staff, 'aal1');
  perform public.create_notifications(jsonb_build_array(v_row));
  perform tests.clear_auth(); reset role;
  perform tests.ok((select count(*) from pgmq.q_notifications) = v_queued, 'an unread notification re-opening queues no email');

  -- A person who muted mentions in the Hub is not re-opened either.
  update public.notification set read_at = now() where user_id = v_pm and dedupe_key = v_row->>'dedupe_key';
  insert into public.notification_preference (user_id, hub_muted_categories) values (v_pm, array['mention']);
  perform tests.authenticate(v_lead, 'aal1');
  perform public.create_notifications(jsonb_build_array(v_row));
  perform tests.clear_auth(); reset role;
  perform tests.ok((select read_at is not null from public.notification
    where user_id = v_pm and dedupe_key = v_row->>'dedupe_key'), 'a muted category is not re-opened');
  delete from public.notification_preference where user_id = v_pm;

  -- The insert rule still decides: here, an organization the caller and the
  -- person are not in. Depending on the rule in force it is refused or
  -- skipped; either way nothing is created and nothing is re-opened.
  select title into v_title from public.notification where user_id = v_pm and dedupe_key = v_row->>'dedupe_key';
  perform tests.authenticate(v_staff, 'aal1');
  begin
    v_count := public.create_notifications(jsonb_build_array(v_row
      || jsonb_build_object('organization_id', v_other_org, 'title', 'Forged')));
  exception when insufficient_privilege then
    v_count := 0;
  end;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_count = 0
    and not exists (select 1 from public.notification where organization_id = v_other_org)
    and (select title from public.notification where user_id = v_pm and dedupe_key = v_row->>'dedupe_key') = v_title,
    'a notification the insert rule does not admit creates and re-opens nothing');
  -- Another organization's notification with the same key is not touched by
  -- someone outside it, even though their own row for their organization is
  -- admitted.
  insert into public.notification (user_id, organization_id, category, title, dedupe_key, read_at)
  values (v_pm, v_other_org, 'mention', 'Other org notice', 'nu-test:xorg:1', now());
  perform tests.authenticate(v_staff, 'aal1');
  perform public.create_notifications(jsonb_build_array(v_row
    || jsonb_build_object('dedupe_key', 'nu-test:xorg:1', 'title', 'Forged', 'link', '/inbox')));
  perform tests.clear_auth(); reset role;
  perform tests.ok((select title = 'Other org notice' and read_at is not null from public.notification
    where organization_id = v_other_org and dedupe_key = 'nu-test:xorg:1'),
    'a matching key in another organization is not re-opened or rewritten');
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.nu_raises('select public.notification_reopen(null::public.notification)',
    '42501', 'the re-open helper refuses an empty row');
  perform tests.nu_raises(format('select public.create_notifications(%L::jsonb)', jsonb_build_array(v_row - 'dedupe_key')),
    'dedupe key', 'a notification needs a dedupe key');
  perform tests.nu_raises(format('select public.notification_reopen(jsonb_populate_record(null::public.notification, %L::jsonb))', v_row),
    '42501', 'the re-open helper cannot be called on its own');
  perform tests.clear_auth(); reset role;

  begin
    set local role anon;
    perform public.create_notifications(jsonb_build_array(v_row));
    reset role;
    perform tests.ok(false, 'anon cannot create notifications');
  exception when insufficient_privilege then
    reset role;
    perform tests.ok(true, 'anon cannot create notifications');
  end;
end;
$$;

rollback;
