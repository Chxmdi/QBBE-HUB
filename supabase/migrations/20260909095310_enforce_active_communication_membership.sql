-- Keep historical membership rows while immediately revoking communication access.
create or replace function app.is_channel_member(p_channel uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.channel_member cm
    join public.channel c on c.id = cm.channel_id
    where cm.channel_id = p_channel and cm.user_id = auth.uid()
      and app.is_org_member(c.organization_id)
  );
$$;

create or replace function app.is_conversation_member(p_conversation uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversation_member cm
    join public.conversation c on c.id = cm.conversation_id
    where cm.conversation_id = p_conversation and cm.user_id = auth.uid()
      and app.is_org_member(c.organization_id)
  );
$$;

-- can_read_channel, can_post_in_channel and can_reply_in_channel all delegate
-- membership checks to the first helper. Conversation/message RLS uses the second.
revoke all on function app.is_channel_member(uuid) from public, anon;
revoke all on function app.is_conversation_member(uuid) from public, anon;
grant execute on function app.is_channel_member(uuid) to authenticated, service_role;
grant execute on function app.is_conversation_member(uuid) to authenticated, service_role;
