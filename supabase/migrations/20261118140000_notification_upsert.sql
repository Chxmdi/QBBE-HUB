-- A second notification about the same record reaches the person again.
--
-- Notifications are unique per person and event (user_id, dedupe_key). The
-- app read the existing rows first to merge into them, but a person can only
-- read their own notifications, so for anyone else it saw none, inserted, hit
-- the unique key and dropped the notification. A second mention on the same
-- project, a task coming back for review, a reassignment back: the person was
-- never told, and the old notification stayed read.
--
-- create_notifications does it in the database. It runs as the caller, so the
-- caller's own insert rule on public.notification (row-level security) decides
-- what they may create, exactly as before, whatever that rule is. Only when
-- that rule and the person's Hub mutes admitted the notification and the
-- person already has one for the event does a narrow helper re-open the
-- existing one: unread, refreshed, reasons merged. A re-opened
-- notification that had been read queues one more email, under its own
-- delivery key; an unread one queues none.

-- Comma-separated reasons, without duplicates, in first-seen order (as
-- mergeReasons in src/features/jobs/services/notify.ts).
create or replace function app.notification_merge_reasons(p_existing text, p_incoming text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(string_agg(part, ', ' order by first_seen), '')
  from (
    select btrim(part) as part, min(ord) as first_seen
    from unnest(string_to_array(coalesce(p_existing, '') || ',' || coalesce(p_incoming, ''), ','))
      with ordinality as x(part, ord)
    where btrim(part) <> ''
    group by btrim(part)
  ) parts;
$$;
revoke all on function app.notification_merge_reasons(text, text) from public, anon, authenticated;

-- Re-opens a person's notification for an event with the newer details.
-- create_notifications calls it, as the caller, right after the caller's
-- insert rule admitted that very notification; it says so in a
-- transaction-local setting no API caller can set. Called any other way, it
-- refuses.
create or replace function public.notification_reopen(p_row public.notification)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev public.notification;
begin
  if p_row.user_id is null or p_row.dedupe_key is null
     or coalesce(current_setting('app.notification_reopen', true), '') is distinct from p_row.user_id || ':' || p_row.dedupe_key then
    raise exception 'Notifications are re-opened by create_notifications' using errcode = '42501';
  end if;
  perform set_config('app.notification_reopen', '', true);
  -- Only the same organization's notification about the same record. The
  -- insert rule admitted the new row for its organization and source, so
  -- that is all it may touch; a key that matches another organization's
  -- notification re-opens nothing.
  select * into v_prev from public.notification n
  where n.user_id = p_row.user_id and n.dedupe_key = p_row.dedupe_key
    and n.organization_id = p_row.organization_id
    and n.source_type is not distinct from p_row.source_type
    and n.source_id is not distinct from p_row.source_id
  for update;
  if not found then
    return;
  end if;
  update public.notification set
    reason = app.notification_merge_reasons(v_prev.reason, p_row.reason),
    category = p_row.category,
    title = p_row.title,
    body = p_row.body,
    link = p_row.link,
    urgency = coalesce(p_row.urgency, 'normal'),
    context = p_row.context,
    owner_label = p_row.owner_label,
    due_on = p_row.due_on,
    read_at = null,
    created_at = now()
  where id = v_prev.id;

  if v_prev.read_at is not null then
    begin
      perform pgmq.send('notifications', jsonb_build_object(
        'kind', 'notification',
        'notification_id', v_prev.id,
        'user_id', v_prev.user_id,
        'category', p_row.category,
        'urgency', coalesce(p_row.urgency, 'normal'),
        'dedupe_key', v_prev.dedupe_key || ':reopened:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
      ));
    exception when others then
      raise warning 'could not enqueue notification email for %: %', v_prev.id, sqlerrm;
    end;
  end if;
end;
$$;
revoke all on function public.notification_reopen(public.notification) from public, anon, authenticated;
grant execute on function public.notification_reopen(public.notification) to authenticated, service_role;

-- p_rows: a JSON array of notifications (user_id, organization_id, category,
-- title, body, source_type, source_id, link, urgency, dedupe_key, reason,
-- context, owner_label, due_on, project_id, thread_id). Returns how many new
-- notifications were created; a re-opened one is not counted.
--
-- Each row is a plain insert, as the caller. Postgres runs the person's Hub
-- mutes (a BEFORE trigger) and then the caller's insert rule before it checks
-- the unique key, so a duplicate-key error means the notification was
-- admitted and the person already has one for this event: that one is
-- re-opened. (INSERT ... ON CONFLICT cannot be used: under row-level security
-- it also needs the caller to be able to read the person's row.)
create or replace function public.create_notifications(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.notification;
  v_rows integer;
  v_created integer := 0;
  v_exists boolean;
begin
  for r in select * from jsonb_populate_recordset(null::public.notification, coalesce(p_rows, '[]'::jsonb)) loop
    if r.dedupe_key is null then
      raise exception 'A notification needs a dedupe key' using errcode = '22023';
    end if;
    v_exists := false;
    v_rows := 0;
    begin
      insert into public.notification (user_id, organization_id, category, title, body, source_type,
        source_id, link, urgency, dedupe_key, reason, context, owner_label, due_on, project_id, thread_id)
      values (r.user_id, r.organization_id, r.category, r.title, r.body, r.source_type,
        r.source_id, r.link, coalesce(r.urgency, 'normal'), r.dedupe_key, r.reason, r.context,
        r.owner_label, r.due_on, r.project_id, r.thread_id);
      get diagnostics v_rows = row_count;
    exception when unique_violation then
      v_exists := true;
    end;
    if v_rows = 1 then
      v_created := v_created + 1;
    elsif v_exists then
      perform set_config('app.notification_reopen', r.user_id || ':' || r.dedupe_key, true);
      perform public.notification_reopen(r);
    end if;
  end loop;
  return v_created;
end;
$$;
revoke all on function public.create_notifications(jsonb) from public, anon, authenticated;
grant execute on function public.create_notifications(jsonb) to authenticated, service_role;
