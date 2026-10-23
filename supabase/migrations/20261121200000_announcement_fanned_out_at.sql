-- An announcement's readers are notified once.
--
-- The scheduled-announcements job re-read every announcement due in the last
-- two days on every pass, oldest first, 50 at a time. Sending again found the
-- earlier notification by its dedupe key and re-opened it: unread again, and
-- emailed again to anyone who had read it. Once more than 50 were due in the
-- window, the newest were never reached until older ones aged out.
--
-- announcement.fanned_out_at marks an announcement whose readers have been
-- notified. public.fan_out_announcement sets it and creates the
-- notifications in one transaction: a failure leaves neither, so the next
-- run tries again, and a second call sends nothing. It writes the
-- notifications itself, once per active member, and only once the
-- announcement is published. The job selects only due
-- announcements not yet fanned out; publishing at once uses the same
-- function.

alter table public.announcement add column fanned_out_at timestamptz;
comment on column public.announcement.fanned_out_at is
  'When its readers were notified; set by public.fan_out_announcement only.';

-- Announcements already out: those that notified someone, and anything due
-- before the job's two-day window, count as fanned out. Due ones within the
-- window that notified nobody (the ones the job never reached) are left for
-- the next run.
update public.announcement a
set fanned_out_at = a.publish_at
where a.message_id is not null
  and a.publish_at <= now()
  and (a.publish_at < now() - interval '2 days'
       or exists (select 1 from public.notification n
                  where n.source_type = 'announcement' and n.source_id = a.id));

create index announcement_awaiting_fan_out
  on public.announcement (publish_at, id)
  where fanned_out_at is null and message_id is not null;

-- The rows say only who is told and in which words (title, body); the
-- function writes everything else itself, to active members of the
-- announcement's organization, once each.
create or replace function public.fan_out_announcement(p_announcement uuid, p_rows jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ann public.announcement;
  v_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_rows jsonb;
begin
  select * into v_ann from public.announcement a where a.id = p_announcement for update;
  if not found then
    raise exception 'There is no such announcement' using errcode = '22023';
  end if;
  -- The server, or its author while still an administrator there.
  if not v_service
     and (auth.uid() is null or auth.uid() <> v_ann.created_by or not app.is_org_admin(v_ann.organization_id)) then
    raise exception 'Only the server or its author fans out an announcement' using errcode = '42501';
  end if;
  -- (A minute's grace: publishing at once stamps the app server's clock.)
  if v_ann.message_id is null or v_ann.publish_at > now() + interval '1 minute' then
    raise exception 'An announcement is fanned out once it is published' using errcode = '22023';
  end if;
  if v_ann.fanned_out_at is not null then
    return null;
  end if;
  if not v_service then
    perform app_limits.count_insert('announcement:publish');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', r.user_id,
      'organization_id', v_ann.organization_id,
      'category', 'announcement',
      'title', left(r.title, 200),
      'body', left(r.body, 140),
      'source_type', 'announcement',
      'source_id', v_ann.id,
      'link', '/announcements#' || v_ann.id,
      'urgency', case when v_ann.priority::text = 'critical' then 'critical'
                      when v_ann.requires_ack then 'high' else 'normal' end,
      'reason', 'announcement',
      'context', left(v_ann.title, 200),
      'dedupe_key', 'announcement:' || v_ann.id || ':' || r.user_id)), '[]'::jsonb)
    into v_rows
  from (
    select distinct on (lower(e ->> 'user_id')) lower(e ->> 'user_id')::uuid as user_id,
           coalesce(nullif(e ->> 'title', ''), v_ann.title) as title, e ->> 'body' as body
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e
    where lower(e ->> 'user_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) r
  -- Someone who left since the job read the members is skipped, not fatal.
  where exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_ann.organization_id and m.user_id = r.user_id and m.status = 'active');

  update public.announcement set fanned_out_at = now() where id = p_announcement;
  return public.create_notifications(v_rows);
end;
$$;
revoke all on function public.fan_out_announcement(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fan_out_announcement(uuid, jsonb) to authenticated, service_role;

-- The database counts an author's fan-outs against the same limit as the
-- app's publishing (SEC-024).
insert into app_limits.rule (action, max_count, window_seconds)
values ('announcement:publish', 20, 3600)
on conflict (action) do nothing;
