-- Chat messages and channel settings.
--
-- A message's author (or an administrator) could update every column of it,
-- not just its text: move it into a channel they cannot post in (the
-- admins-only Announcements channel included), into someone else's thread,
-- mark it a system message, or backdate it. The same columns could be set
-- when posting. And a channel's owner could change its type and make it
-- mandatory, so a staff member could create a second mandatory
-- announcements channel, after which publishing announcements failed.
--
-- Now members may update only a message's text and its edited/deleted
-- times; posting stamps the time, never makes a system message, takes the
-- channel's organization and replies only within the same place; editing
-- your own message still needs posting rights where it is. A channel's type,
-- mandatory flag and posting policy are fixed for members after creation,
-- only administrators create a mandatory or announcements channel, and an
-- organization has one mandatory announcements channel.

-- Messages ---------------------------------------------------------------------

revoke update on public.message from anon, authenticated;
grant update (body, edited_at, deleted_at) on public.message to authenticated;

-- One trigger for member-written messages, for later rules to extend.
-- Invoker: current_user is 'authenticated' only for a member's own
-- statement, not inside server functions.
create or replace function app.guard_message_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A message belongs to the organization of the channel or conversation
    -- it is posted in, and a reply to a top-level message in the same place.
    if new.channel_id is not null then
      select c.organization_id into new.organization_id from public.channel c where c.id = new.channel_id;
    elsif new.conversation_id is not null then
      select c.organization_id into new.organization_id from public.conversation c where c.id = new.conversation_id;
    end if;
    if new.thread_root_id is not null and not exists (
      select 1 from public.message r
      where r.id = new.thread_root_id
        and r.thread_root_id is null
        and r.channel_id is not distinct from new.channel_id
        and r.conversation_id is not distinct from new.conversation_id
    ) then
      raise exception 'A reply must be to a message in the same place.' using errcode = '42501';
    end if;
    new.created_at := now();
    new.is_system := false;
    new.source_record_type := null;
    new.source_record_id := null;
    new.edited_at := null;
    new.deleted_at := null;
  elsif (new.organization_id, new.channel_id, new.conversation_id, new.thread_root_id,
         new.author_id, new.is_system, new.source_record_type, new.source_record_id, new.created_at)
        is distinct from
        (old.organization_id, old.channel_id, old.conversation_id, old.thread_root_id,
         old.author_id, old.is_system, old.source_record_type, old.source_record_id, old.created_at) then
    raise exception 'Only a message''s text can be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_message_client_write() from public, anon, authenticated;

drop trigger if exists message_guard_client_write on public.message;
create trigger message_guard_client_write
  before insert or update on public.message
  for each row execute function app.guard_message_client_write();

drop policy if exists message_author_update on public.message;
create policy message_author_update on public.message
  for update to authenticated
  using ((author_id = (select auth.uid())) or app.is_org_admin(organization_id))
  with check (
    app.is_org_admin(organization_id)
    or (
      author_id = (select auth.uid())
      and (
        (channel_id is not null and (
          app.can_post_in_channel(channel_id)
          or (thread_root_id is not null and app.can_reply_in_channel(channel_id))))
        or (conversation_id is not null and app.is_conversation_member(conversation_id))
      )
    )
  );

-- Channels ---------------------------------------------------------------------

revoke update on public.channel from anon, authenticated;
grant update (name, slug, privacy, purpose, topic, owner_id, program_id, project_id, event_id,
              reply_policy, archived_at, team_id, updated_at)
  on public.channel to authenticated;

drop policy if exists channel_staff_insert on public.channel;
create policy channel_staff_insert on public.channel
  for insert to authenticated
  with check (
    app.is_org_staff(organization_id)
    and ((type <> 'announcements' and not is_mandatory) or app.is_org_admin(organization_id))
  );

-- Any organization that already has more than one mandatory announcements
-- channel keeps its oldest one mandatory; the others stay as ordinary
-- channels, so nothing is lost.
update public.channel c
set is_mandatory = false
where c.type = 'announcements' and c.is_mandatory
  and exists (
    select 1 from public.channel older
    where older.organization_id = c.organization_id
      and older.type = 'announcements' and older.is_mandatory
      and (older.created_at, older.id) < (c.created_at, c.id)
  );

create unique index if not exists channel_one_mandatory_announcements
  on public.channel (organization_id)
  where type = 'announcements' and is_mandatory;

-- Meeting summaries are system messages linked to their meeting. The
-- function that posts them ran with the caller's rights, so the guard above
-- would treat its insert as the member's own and strip that; it now runs as
-- definer, keeping its own management check and adding the posting check
-- that row-level security used to make for it.
create or replace function public.complete_meeting(p_meeting uuid, p_summary text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare m public.meeting; v_channel uuid;
begin
  if auth.uid() is null or not public.can_manage_meeting(p_meeting) then
    raise exception 'Meeting management access required' using errcode = '42501';
  end if;
  select * into m from public.meeting where id = p_meeting for update;
  if not found or m.status = 'cancelled' then
    raise exception 'Meeting is unavailable';
  end if;
  if p_summary is null or length(trim(p_summary)) = 0 then
    raise exception 'Summary is required';
  end if;
  v_channel := m.channel_id;
  if v_channel is null and m.project_id is not null then
    select id into v_channel from public.channel
      where project_id = m.project_id and archived_at is null order by id limit 1;
  end if;
  if v_channel is not null and m.summary_posted_at is null then
    if not app.can_post_in_channel(v_channel) then
      raise exception 'You cannot post in this meeting''s channel' using errcode = '42501';
    end if;
    insert into public.message (organization_id, channel_id, author_id, body,
      is_system, source_record_type, source_record_id)
    values (m.organization_id, v_channel, auth.uid(), p_summary, true, 'meeting', m.id);
  end if;
  update public.meeting set status = 'completed',
    summary_posted_at = case when v_channel is not null then coalesce(m.summary_posted_at, now())
      else m.summary_posted_at end
    where id = m.id;
  if not found then raise exception 'Meeting update denied' using errcode = '42501'; end if;
  return m.id;
end;
$$;

revoke all on function public.complete_meeting(uuid, text) from public, anon;
grant execute on function public.complete_meeting(uuid, text) to authenticated, service_role;
