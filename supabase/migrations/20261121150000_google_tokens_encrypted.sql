-- Google tokens are stored encrypted, nobody signed in can read them, and
-- every stored token that is deleted is revoked at Google (PRIV-011).
--
-- 1. The app encrypts tokens before storing them, with a key only the server
--    holds (GOOGLE_TOKEN_KEY; src/features/inbox/services/google-token-crypto.ts).
--    integration_secret now refuses a token written in any other form. A
--    trigger, not a check constraint: a NOT VALID check would also refuse
--    every later update of a row stored before encryption (a sync cursor
--    save), and its error would print the row, tokens included, into the
--    database log. The trigger looks only at a token being written, and its
--    message names no value. The google-token-upkeep job seals the tokens
--    stored before this (and reseals after a key rotation).
-- 2. The API roles lose every grant on integration_secret. The tokens were
--    already hidden by row security (no select policy); now they are not
--    even selectable. Signed-in writes go through store_integration_tokens
--    and store_integration_sync_state, which run as their owner.
-- 3. Deleting a stored token, by any path (disconnecting, deactivating the
--    member, deleting the connection), queues it in google_token_revocation;
--    the upkeep job asks Google to revoke it, records the outcome and
--    deletes the queued copy, whatever Google answers, or after five tries
--    that could not reach Google.

create or replace function app.integration_secret_sealed_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sealed constant text := '^enc:v1:[0-9a-f]{8}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$';
begin
  if new.access_token is not null and new.access_token !~ v_sealed
     and (tg_op = 'INSERT' or new.access_token is distinct from old.access_token) then
    raise exception 'Google tokens are stored only in sealed form' using errcode = '23514';
  end if;
  if new.refresh_token is not null and new.refresh_token !~ v_sealed
     and (tg_op = 'INSERT' or new.refresh_token is distinct from old.refresh_token) then
    raise exception 'Google tokens are stored only in sealed form' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.integration_secret_sealed_only() from public, anon, authenticated;
create trigger integration_secret_sealed_only
before insert or update of access_token, refresh_token on public.integration_secret
for each row execute function app.integration_secret_sealed_only();

revoke all on table public.integration_secret from public, anon, authenticated;

create table public.google_token_revocation (
  id uuid primary key default gen_random_uuid(),
  -- No foreign keys: the connection is usually gone by the time Google is asked.
  connection_id uuid not null,
  organization_id uuid,
  user_id uuid,
  provider text,
  -- The sealed token (or a token stored before encryption), revoked and then deleted.
  token text not null,
  queued_at timestamptz not null default now(),
  -- Tries that could not reach Google; the job gives up after five.
  attempts integer not null default 0
);
alter table public.google_token_revocation enable row level security;
revoke all on table public.google_token_revocation from public, anon, authenticated, service_role;
grant select, delete on table public.google_token_revocation to service_role;
grant update (attempts) on table public.google_token_revocation to service_role;

create or replace function app.queue_google_token_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection record;
begin
  -- Revoking the refresh token ends the whole grant; an access token alone
  -- ends itself.
  if coalesce(old.refresh_token, old.access_token) is null then
    return old;
  end if;
  select c.organization_id, c.user_id, c.provider into v_connection
  from public.integration_connection c where c.id = old.connection_id;
  insert into public.google_token_revocation (connection_id, organization_id, user_id, provider, token)
  values (old.connection_id, v_connection.organization_id, v_connection.user_id, v_connection.provider,
          coalesce(old.refresh_token, old.access_token));
  return old;
end;
$$;
revoke all on function app.queue_google_token_revocation() from public, anon, authenticated;

create trigger integration_secret_queue_revocation
before delete on public.integration_secret
for each row execute function app.queue_google_token_revocation();

-- A connection deleted outright takes its tokens with it by cascade, but by
-- then the connection row is gone and the queued token would not say whose
-- it was. Delete the tokens first, while the connection is still there.
create or replace function app.integration_connection_delete_tokens_first()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.integration_secret where connection_id = old.id;
  return old;
end;
$$;
revoke all on function app.integration_connection_delete_tokens_first() from public, anon, authenticated;
create trigger integration_connection_delete_tokens_first
before delete on public.integration_connection
for each row execute function app.integration_connection_delete_tokens_first();

insert into public.job_definition (name, description, schedule, queue, batch_size, max_attempts)
values ('google-token-upkeep',
        'Seals Google tokens stored in the clear or under an old key, and revokes deleted tokens at Google.',
        '*/5 * * * *', 'integrations', 200, 3)
on conflict (name) do nothing;

do $$
begin
  perform cron.unschedule('google-token-upkeep')
    where exists (select 1 from cron.job where jobname = 'google-token-upkeep');
  perform cron.schedule('google-token-upkeep', '*/5 * * * *', format('select app.dispatch_job(%L)', 'google-token-upkeep'));
end;
$$;
