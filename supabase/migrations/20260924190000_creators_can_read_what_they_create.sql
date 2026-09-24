-- The creator of a private channel or a conversation could not read it back,
-- so neither could be created through the product (#112).
--
-- Both read policies were membership-only. Membership is written after the
-- row exists, so:
--   * createChannel's insert(...).select() failed row-level security for any
--     private channel ("Could not create the channel."), and
--   * startConversation could insert the conversation but not its members:
--     conversation_member_insert checks that the conversation EXISTS, that
--     subquery runs under conversation's own read policy, and the creator is
--     not a member yet ("Could not add participants.").
-- Found by the first browser journey that started a DM (collaboration.spec).
--
-- The fix reads the row's own columns, which RETURNING can see, instead of
-- looking the row up again:
--   * a channel is readable by its owner, as it is already updatable by them
--     (channel_manage);
--   * a conversation is readable by its creator only while it has no members,
--     i.e. between creating it and adding the people. After that membership
--     decides, so a creator who later leaves a conversation loses it like
--     anyone else.

create or replace function app.conversation_has_no_members(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.conversation_member cm where cm.conversation_id = p_conversation
  );
$$;

revoke all on function app.conversation_has_no_members(uuid) from public, anon;
grant execute on function app.conversation_has_no_members(uuid) to authenticated;

drop policy if exists conversation_read on public.conversation;
create policy conversation_read on public.conversation
  for select
  using (
    app.is_conversation_member(id)
    or (
      created_by = (select auth.uid())
      and app.conversation_has_no_members(id)
    )
  );

drop policy if exists channel_read on public.channel;
create policy channel_read on public.channel
  for select
  to authenticated
  using (
    ((privacy = 'public'::public.channel_privacy) and app.is_org_member(organization_id))
    or app.is_channel_member(id)
    or owner_id = (select auth.uid())
  );
