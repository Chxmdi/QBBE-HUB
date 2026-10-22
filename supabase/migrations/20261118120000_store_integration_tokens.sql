-- Connecting Gmail, Google Calendar or Google Drive stores the tokens.
--
-- integration_secret has insert and update policies and, on purpose, no
-- select policy: nobody reads tokens through the API. But the OAuth callback
-- wrote them with the person's own session as INSERT ... ON CONFLICT DO
-- UPDATE, which row-level security refuses without a select policy, so every
-- connection failed with "Token store failed". The callback's later updates
-- (the Gmail history id, the Calendar and Drive sync tokens) filter by
-- connection id, which also needs a select policy, so they matched nothing
-- and saved nothing, without an error. And the read of the previous refresh
-- token always came back empty.
--
-- Two narrow functions now do these writes for the connection's owner only.
-- No select policy is added: the tokens stay unreadable through the API.
--
-- Ownership of a connection is fixed. The integration_admin policy lets an
-- admin update any connection in the organization, including its user_id,
-- so "the owner" could otherwise be changed for a moment to store one's own
-- tokens on someone else's connection (or point their tokens elsewhere).
-- Changing user_id is refused for API callers; disconnect and connect again
-- instead.

create or replace function app.guard_integration_connection_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id and current_user in ('authenticated', 'anon') then
    raise exception 'A connection stays with the person who connected it' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_integration_connection_owner() from public, anon, authenticated;
create trigger integration_connection_owner_guard
before update of user_id on public.integration_connection
for each row execute function app.guard_integration_connection_owner();

create or replace function public.store_integration_tokens(
  p_connection uuid, p_access text, p_refresh text, p_expires timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.integration_connection c
                 where c.id = p_connection and c.user_id = auth.uid()) then
    raise exception 'This connection is not yours' using errcode = '42501';
  end if;
  if nullif(btrim(p_access), '') is null then
    raise exception 'An access token is required' using errcode = '22023';
  end if;
  insert into public.integration_secret (connection_id, access_token, refresh_token, token_expires_at, updated_at)
  values (p_connection, p_access, nullif(p_refresh, ''), p_expires, now())
  on conflict (connection_id) do update set
    access_token = excluded.access_token,
    -- Google usually sends no refresh token on a reconnect; keep the stored
    -- one rather than turning a lasting authorization into one that dies
    -- with the access token.
    refresh_token = coalesce(excluded.refresh_token, public.integration_secret.refresh_token),
    token_expires_at = excluded.token_expires_at,
    updated_at = now();
end;
$$;
revoke all on function public.store_integration_tokens(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.store_integration_tokens(uuid, text, text, timestamptz) to authenticated;

-- Saves where a sync left off. Only these columns can be written this way;
-- any other key in p_state is ignored. A key that is absent keeps its value;
-- a key that is present with null clears it.
create or replace function public.store_integration_sync_state(p_connection uuid, p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.integration_connection c
                 where c.id = p_connection and c.user_id = auth.uid()) then
    raise exception 'This connection is not yours' using errcode = '42501';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'The sync state is an object of named values' using errcode = '22023';
  end if;
  update public.integration_secret s set
    gmail_history_id = case when p_state ? 'gmail_history_id'
      then p_state->>'gmail_history_id' else s.gmail_history_id end,
    gmail_pending_history_id = case when p_state ? 'gmail_pending_history_id'
      then p_state->>'gmail_pending_history_id' else s.gmail_pending_history_id end,
    gmail_watch_expiration_at = case when p_state ? 'gmail_watch_expiration_at'
      then (p_state->>'gmail_watch_expiration_at')::timestamptz else s.gmail_watch_expiration_at end,
    google_calendar_sync_token = case when p_state ? 'google_calendar_sync_token'
      then p_state->>'google_calendar_sync_token' else s.google_calendar_sync_token end,
    google_drive_page_token = case when p_state ? 'google_drive_page_token'
      then p_state->>'google_drive_page_token' else s.google_drive_page_token end,
    updated_at = now()
  where s.connection_id = p_connection;
  if not found then
    raise exception 'Store the tokens before the sync state' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.store_integration_sync_state(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.store_integration_sync_state(uuid, jsonb) to authenticated;
