-- A channel owner/admin can explicitly revoke the direct source without
-- destroying independent team/mandatory/program/project/event provenance.
create or replace function public.remove_channel_member(
  p_channel_id uuid, p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel public.channel;
  v_deleted integer;
begin
  select * into v_channel from public.channel where id = p_channel_id;
  if not found or not (
    app.is_org_admin(v_channel.organization_id)
    or (
      (v_channel.owner_id = auth.uid() or v_channel.created_by = auth.uid())
      and app.is_org_member(v_channel.organization_id)
    )
  ) then
    raise exception 'Channel owner or administrator access required' using errcode = '42501';
  end if;

  if p_user_id = v_channel.owner_id then
    raise exception 'Transfer channel ownership before removing its owner'
      using errcode = '23514';
  end if;

  delete from public.channel_access_grant
  where channel_id = p_channel_id
    and user_id = p_user_id
    and source = 'direct';
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.remove_channel_member(uuid, uuid) from public, anon;
grant execute on function public.remove_channel_member(uuid, uuid) to authenticated, service_role;
