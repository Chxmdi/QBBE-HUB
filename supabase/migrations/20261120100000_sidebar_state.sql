-- The workspace sidebar's live state in one call.
--
-- The workspace layout runs on every page. It counted unread notifications,
-- called my_open_task_count, listed channel memberships, and then asked one
-- more query per channel whether anything was unread, for the first ten
-- memberships only, in no particular order. That was up to fourteen
-- statements per page, and channels past the tenth never showed as unread.
-- Direct messages had no unread signal outside /messages.
--
-- sidebar_state() returns all of it from one statement:
--   unread_notifications  the caller's unread notifications
--   open_tasks            my_open_task_count()
--   channels              every unarchived channel the caller is a member of
--                         and can read: mandatory channels first, then the
--                         most recently active, each with an unread flag
--   unread_conversations  direct conversations whose latest message is from
--                         someone else and after the caller's read cursor,
--                         the rule /messages uses to show one as unread
--
-- It runs as the caller (security invoker), so every row it reads passes the
-- same row-level security the separate queries did, and it answers nothing the
-- caller could not already read. supabase/tests/sidebar-state.sql compares it
-- with those queries for each role.

create or replace function public.sidebar_state()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as id
  ),
  channels as (
    select
      c.id,
      c.slug,
      c.is_mandatory,
      (select max(m.created_at) from public.message m where m.channel_id = c.id) as last_activity,
      exists (
        select 1 from public.message m
        where m.channel_id = c.id
          and m.created_at > cm.last_read_at
          and m.author_id <> (select id from me)
      ) as unread
    from public.channel_member cm
    join public.channel c on c.id = cm.channel_id
    where cm.user_id = (select id from me)
      and c.archived_at is null
  )
  select jsonb_build_object(
    'unread_notifications',
      (select count(*) from public.notification n where n.read_at is null),
    'open_tasks',
      public.my_open_task_count(),
    'channels',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object('id', ch.id, 'slug', ch.slug, 'unread', ch.unread)
                  order by ch.is_mandatory desc, ch.last_activity desc nulls last, ch.slug)
         from channels ch),
        '[]'::jsonb),
    'unread_conversations',
      (select count(*)
       from public.conversation_member cm
       cross join lateral (
         select m.created_at, m.author_id
         from public.message m
         where m.conversation_id = cm.conversation_id
         order by m.created_at desc
         limit 1
       ) latest
       where cm.user_id = (select id from me)
         and latest.created_at > cm.last_read_at
         and latest.author_id <> (select id from me))
  );
$$;

revoke all on function public.sidebar_state() from public, anon;
grant execute on function public.sidebar_state() to authenticated;

comment on function public.sidebar_state() is
  'The workspace sidebar''s counts and per-channel unread flags in one call, read as the caller. '
  'supabase/tests/sidebar-state.sql keeps it equal to the separate queries it replaced.';
