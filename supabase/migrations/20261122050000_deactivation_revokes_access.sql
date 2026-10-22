-- Deactivating a member.
--
-- Deactivation only changed the membership's status: the member's Google
-- connections in the organization kept syncing their mailbox, calendar and
-- Drive metadata and kept working tokens, and their sign-in sessions stayed
-- valid (the app's sign-out call was given a user id instead of a token and
-- failed silently).
--
-- Now, whenever a membership becomes deactivated (whatever path does it),
-- the member's connections in that organization are disconnected, their
-- stored tokens deleted and the mailbox, calendar and Drive copies made
-- through them removed; when no active membership remains, their sign-in
-- sessions are ended. The app also bans the account's sign-in in that case
-- (and lifts the ban on reactivation) through the Auth admin API.

create or replace function app.revoke_member_integrations(p_organization uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connections uuid[];
  v_document uuid;
begin
  select coalesce(array_agg(c.id), '{}') into v_connections
  from public.integration_connection c
  where c.organization_id = p_organization and c.user_id = p_user;

  if cardinality(v_connections) > 0 then
    delete from public.gmail_message where connection_id = any (v_connections);
    delete from public.calendar_event_link where connection_id = any (v_connections);
    -- Drive-imported entries go, except one under a legal hold or still in
    -- its retention period: that one is kept, detached from the connection.
    for v_document in
      select d.id from public.document d where d.integration_connection_id = any (v_connections)
    loop
      begin
        delete from public.document where id = v_document;
      exception when others then
        update public.document set integration_connection_id = null where id = v_document;
      end;
    end loop;
    delete from public.integration_secret where connection_id = any (v_connections);
    update public.integration_connection
    set status = 'disconnected', last_error = 'Member deactivated', updated_at = now()
    where id = any (v_connections);
  end if;

  if not exists (
    select 1 from public.organization_membership m
    where m.user_id = p_user and m.status = 'active'
  ) then
    -- Ending sessions needs rights on the auth schema; where the database
    -- refuses it, the app's sign-in ban still applies.
    begin
      delete from auth.sessions where user_id = p_user;
    exception when insufficient_privilege then
      null;
    end;
  end if;
end;
$$;

revoke all on function app.revoke_member_integrations(uuid, uuid) from public, anon, authenticated;

create or replace function app.revoke_access_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'deactivated' and old.status is distinct from 'deactivated' then
    perform app.revoke_member_integrations(new.organization_id, new.user_id);
  end if;
  return null;
end;
$$;

revoke all on function app.revoke_access_on_deactivation() from public, anon, authenticated;

drop trigger if exists organization_membership_revoke_access on public.organization_membership;
create trigger organization_membership_revoke_access
  after update of status on public.organization_membership
  for each row execute function app.revoke_access_on_deactivation();

-- People deactivated before this change.
do $$
declare
  r record;
begin
  for r in
    select distinct c.organization_id, c.user_id
    from public.integration_connection c
    join public.organization_membership m
      on m.organization_id = c.organization_id and m.user_id = c.user_id
    where m.status = 'deactivated'
  loop
    perform app.revoke_member_integrations(r.organization_id, r.user_id);
  end loop;
end;
$$;
