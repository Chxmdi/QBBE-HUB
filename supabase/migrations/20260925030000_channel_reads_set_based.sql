-- Channel, message and channel member reads answered once per query (#115).
--
-- After the member/profile change, the perf run's query statistics put a
-- channel's messages (about 300 ms a call) and its member count (about
-- 290 ms) at the top. message_read and channel_member_read (0002) call
-- app.can_read_channel(channel_id) for every row, and that function looks
-- the channel up, checks the reader's organization membership and their
-- channel membership (a join plus another membership check) each time; a
-- channel page reads up to 1,000 messages' worth of those.
--
-- Who can read what does not change. The same rules are restated against
-- arrays computed once per statement. The helpers below are
-- app.can_read_channel and app.is_conversation_member written as sets:
--   a channel is readable when the reader is an active member of its
--   organization and it is public or they are in channel_member;
--   a conversation is readable when the reader is in conversation_member and
--   an active member of its organization.
-- supabase/tests/channel-read-equivalence.sql compares every member's
-- visible rows with the original functions.

create or replace function app.readable_channel_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}')
  from public.channel c
  where c.organization_id = any ((select app.task_read_member_organizations())::uuid[])
    and (
      c.privacy = 'public'
      or exists (
        select 1 from public.channel_member cm
        where cm.channel_id = c.id and cm.user_id = (select auth.uid())
      )
    );
$$;

create or replace function app.readable_conversation_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct c.id), '{}')
  from public.conversation c
  join public.conversation_member cm
    on cm.conversation_id = c.id and cm.user_id = (select auth.uid())
  where c.organization_id = any ((select app.task_read_member_organizations())::uuid[]);
$$;

revoke all on function app.readable_channel_ids(), app.readable_conversation_ids() from public, anon;
grant execute on function app.readable_channel_ids(), app.readable_conversation_ids()
  to authenticated, service_role;

drop policy if exists message_read on public.message;
create policy message_read on public.message for select to authenticated
  using (
    (channel_id is not null and channel_id = any ((select app.readable_channel_ids())::uuid[]))
    or (
      conversation_id is not null
      and conversation_id = any ((select app.readable_conversation_ids())::uuid[])
    )
  );

drop policy if exists channel_member_read on public.channel_member;
create policy channel_member_read on public.channel_member for select to authenticated
  using (channel_id = any ((select app.readable_channel_ids())::uuid[]));
