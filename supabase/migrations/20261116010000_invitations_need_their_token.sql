-- ---------------------------------------------------------------------------
-- An invitation is claimed with the secret it was sent with, and grants
-- nothing until the address is proven (audit SEC-001).
--
-- `app.handle_new_user` matched an invitation on email alone and inserted an
-- ACTIVE membership in the same statement that created the auth user, before
-- the address was confirmed. Anyone who knew an invited address could sign up
-- first with a password of their choosing and take the seat — an `admin` seat
-- included. Where Auth confirms addresses on sign-up (locally, or a project
-- with autoconfirm on) that was a finished account takeover; with
-- confirmation on, it was still an active membership held by an unconfirmed
-- stranger. And `public.signup_allowed(email)`, granted to `anon`, answered
-- "is this address invited?" for any address, which is the list an attacker
-- needs. The invitation's own `token` column was generated and never read,
-- and no invitation was ever sent: the admin screen said "email not sent".
--
-- Now:
--
--   * Each invitation carries `token_hash`, the SHA-256 of a random secret the
--     server generates and emails as a link. Only the hash is kept on the
--     invitation.
--   * Creating the auth user needs an open, unexpired invitation for that
--     address and one of these proofs:
--       - the link's secret, passed as `invite_token` in the sign-up's user
--         metadata. This is how a person signs up with a password, and how an
--         operator provisions an account through the Auth admin API. The
--         secret is removed from the user's metadata as soon as it is checked,
--         so it does not stay on the account or in later sessions.
--       - a sign-in provider other than email (Google, per
--         docs/runbooks/google-sign-in.md) that says it has verified the
--         address.
--       - `provisioned_by_operator: true` in `raw_app_meta_data`, which a person
--         signing up cannot set. Only a direct SQL insert into auth.users
--         carries it at insert time (test fixtures do this); the Auth admin
--         API adds app_metadata after the insert, so it uses the token.
--   * The membership is granted only once `email_confirmed_at` is set: at
--     sign-up where Auth confirms immediately, otherwise by the new trigger
--     when Auth confirms the address (the confirmation email, or Google's own
--     confirmation, which Auth writes just after creating the user). At that
--     point the confirmed address is the proof, so the newest open invitation
--     for it is granted — including one an administrator re-issued with
--     "New link" between sign-up and confirmation.
--   * `signup_allowed` is no longer callable by `anon`. The sign-up page asks
--     `invitation_preview(token)`, which answers only for the holder of a
--     link, and `workspace_bootstrap_open()`, which only says whether the
--     very first account can still be created.
--
-- The first account still bootstraps the workspace exactly as before.
-- Invitations created before this migration have no `token_hash`: they still
-- work for Google sign-in, and an administrator issues a link for anyone else
-- (Admin, Invitations, New link; docs/runbooks/deployment.md lists them).
-- ---------------------------------------------------------------------------

alter table invitation add column if not exists token_hash text;

alter table invitation drop constraint if exists invitation_token_hash_format;
alter table invitation add constraint invitation_token_hash_format
  check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists invitation_token_hash_key
  on invitation (token_hash) where token_hash is not null;

comment on column invitation.token_hash is
  'SHA-256 (hex) of the secret emailed in the invitation link. The invitation keeps only the hash.';
comment on column invitation.token is
  'Unused legacy column. Invitations are claimed with token_hash (SEC-001).';

-- ---------------------------------------------------------------------------
-- The sign-up gate: which open invitation, if any, this new auth user proves
-- a claim to. Revoked, accepted and expired invitations never match.
-- ---------------------------------------------------------------------------
create or replace function app.claimable_invitation(
  p_email text,
  p_user_meta jsonb,
  p_app_meta jsonb,
  p_email_confirmed boolean
) returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text := nullif(trim(coalesce(p_user_meta ->> 'invite_token', '')), '');
  v_provider text := coalesce(nullif(p_app_meta ->> 'provider', ''), 'email');
  -- Compared as JSON, not cast, so an odd value is simply "not an operator".
  v_operator boolean := coalesce(p_app_meta -> 'provisioned_by_operator' = 'true'::jsonb, false);
  -- Only read for a provider other than email, where Auth fills user metadata
  -- from the provider's own claims; on a password sign-up the person writes
  -- user metadata themselves, so it proves nothing there.
  v_provider_verified boolean := v_provider <> 'email'
    and (p_email_confirmed or p_user_meta ->> 'email_verified' = 'true');
  v_invitation uuid;
begin
  if v_email = '' then
    return null;
  end if;

  if v_token is not null then
    -- The link's secret, for the address it was sent to.
    select i.id into v_invitation
    from invitation i
    where i.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
      and lower(i.email) = v_email
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now();
    return v_invitation;
  end if;

  if v_operator or v_provider_verified then
    select i.id into v_invitation
    from invitation i
    where lower(i.email) = v_email
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
    order by i.created_at desc
    limit 1;
    return v_invitation;
  end if;

  return null;
end;
$$;

revoke all on function app.claimable_invitation(text, jsonb, jsonb, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Spend an invitation on a person: membership, mandatory channels, audit.
-- Locks the invitation row so two confirmations cannot both spend it.
-- ---------------------------------------------------------------------------
create or replace function app.accept_invitation(p_user uuid, p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv invitation%rowtype;
  v_channel record;
begin
  select * into v_inv from invitation where id = p_invitation for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    return;
  end if;

  update invitation set accepted_at = now() where id = p_invitation;

  insert into organization_membership (organization_id, user_id, role, status)
  values (v_inv.organization_id, p_user, v_inv.intended_role, 'active')
  on conflict (organization_id, user_id) do nothing;

  -- Mandatory channels (P0-ANN-01), in the organization actually joined.
  for v_channel in
    select id from channel where organization_id = v_inv.organization_id and is_mandatory
  loop
    insert into channel_member (channel_id, user_id, membership_source)
    values (v_channel.id, p_user, 'mandatory')
    on conflict do nothing;
  end loop;

  insert into audit_event (organization_id, actor_id, event_type, action, object_type, object_id)
  values (v_inv.organization_id, p_user, 'auth', 'user_provisioned', 'user_profile', p_user);
end;
$$;

revoke all on function app.accept_invitation(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- New auth user: bootstrap the workspace, or check the invitation proof and
-- grant the membership if the address is already confirmed.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_channel record;
  v_invitation uuid;
  v_bootstrap boolean;
begin
  -- "Is there a workspace yet", asked as that and nothing else.
  v_bootstrap := not exists (select 1 from organization);

  if not v_bootstrap then
    -- The gate, before anything is written: an uninvited or unproven sign-up
    -- raises, which aborts the auth.users insert, so no account is left behind.
    v_invitation := app.claimable_invitation(
      new.email, new.raw_user_meta_data, new.raw_app_meta_data,
      new.email_confirmed_at is not null);

    if v_invitation is null then
      raise exception 'Sign-up is by invitation only.'
        using errcode = 'insufficient_privilege',
              hint = 'Open the link in your invitation email, or ask an administrator to invite this address.';
    end if;
  end if;

  -- The secret has done its job. Left in user metadata it would sit on the
  -- account and be copied into every session token the person is issued.
  -- Auth's own later writes are stripped by trg_auth_user_drop_invite_token.
  -- (Only an UPDATE of email_confirmed_at fires the confirmation trigger, so
  -- this does not.)
  if new.raw_user_meta_data ? 'invite_token' then
    update auth.users
    set raw_user_meta_data = raw_user_meta_data - 'invite_token'
    where id = new.id;
  end if;

  insert into user_profile (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  if v_bootstrap then
    -- First user bootstraps the workspace and becomes Primary Owner.
    insert into organization (name, slug)
    values ('Quebec Board of Black Educators', 'qbbe')
    returning id into v_org;

    insert into channel (organization_id, name, slug, type, privacy, purpose,
                         posting_policy, reply_policy, is_mandatory, owner_id, created_by)
    values
      (v_org, 'Announcements', 'announcements', 'announcements', 'public',
       'Official organization-wide announcements. Posting is restricted to leadership and admins.',
       'admins', 'threads_only', true, new.id, new.id),
      (v_org, 'General', 'general', 'organization', 'public',
       'Non-critical organization-wide conversation.', 'everyone', 'normal', true, new.id, new.id);

    insert into organization_membership (organization_id, user_id, role, status)
    values (v_org, new.id, 'owner', 'active')
    on conflict (organization_id, user_id) do nothing;

    for v_channel in select id from channel where organization_id = v_org and is_mandatory
    loop
      insert into channel_member (channel_id, user_id, membership_source)
      values (v_channel.id, new.id, 'mandatory')
      on conflict do nothing;
    end loop;

    insert into audit_event (organization_id, actor_id, event_type, action, object_type, object_id)
    values (v_org, new.id, 'auth', 'user_provisioned', 'user_profile', new.id);
  elsif new.email_confirmed_at is not null then
    perform app.accept_invitation(new.id, v_invitation);
  end if;
  -- Otherwise the membership waits for app.handle_user_email_confirmed.

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Keep the invitation secret off the account after sign-up.
--
-- Auth keeps the user it just created in memory and writes its metadata back
-- later in the same sign-up (confirming an address adds `email_verified`),
-- which would restore the `invite_token` handle_new_user removed. Every update
-- drops it again. The session Auth issues in that same sign-up request was
-- built from its in-memory copy and still carries the (by then spent) secret
-- until it is first refreshed, at most an hour.
-- ---------------------------------------------------------------------------
create or replace function app.drop_invite_token()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.raw_user_meta_data := new.raw_user_meta_data - 'invite_token';
  return new;
end;
$$;

revoke all on function app.drop_invite_token() from public, anon, authenticated;

drop trigger if exists trg_auth_user_drop_invite_token on auth.users;
create trigger trg_auth_user_drop_invite_token
  before update on auth.users
  for each row
  when (new.raw_user_meta_data ? 'invite_token')
  execute function app.drop_invite_token();

-- ---------------------------------------------------------------------------
-- The address is confirmed: grant the invitation for it.
--
-- This account already passed the sign-up gate (or predates it), and the
-- address is now proven, so the newest open invitation for the address is
-- granted. That covers a link an administrator re-issued after the person
-- signed up (their old token no longer matches) and an invitation that lapsed
-- between sign-up and confirmation; it must have still been open when the
-- account was created. Someone who already has a membership gets nothing new.
-- An invitation revoked in the meantime grants nothing, and the confirmation
-- itself still succeeds. Any other failure in the grant aborts the
-- confirmation, so it is retried rather than leaving a confirmed account
-- without its seat.
-- ---------------------------------------------------------------------------
create or replace function app.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation uuid;
begin
  if exists (select 1 from organization_membership where user_id = new.id) then
    return new;
  end if;

  select i.id into v_invitation
  from invitation i
  where lower(i.email) = lower(trim(coalesce(new.email, '')))
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > new.created_at
  order by i.created_at desc
  limit 1;

  if v_invitation is not null then
    perform app.accept_invitation(new.id, v_invitation);
  end if;

  return new;
end;
$$;

revoke all on function app.handle_user_email_confirmed() from public, anon, authenticated;

drop trigger if exists trg_on_auth_user_email_confirmed on auth.users;
create trigger trg_on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function app.handle_user_email_confirmed();

-- ---------------------------------------------------------------------------
-- What the sign-up page may ask without signing in.
-- ---------------------------------------------------------------------------

-- The holder of an invitation link may see whom it is for. A token that is
-- unknown, spent, revoked or expired previews nothing. The secret is 256 bits,
-- so this is not an oracle for anything an attacker does not already hold.
create or replace function public.invitation_preview(p_token text)
returns table (email text, organization_name text, intended_role org_role, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.email, o.name, i.intended_role, i.expires_at
  from invitation i
  join organization o on o.id = i.organization_id
  where nullif(trim(coalesce(p_token, '')), '') is not null
    and i.token_hash = encode(extensions.digest(trim(p_token), 'sha256'), 'hex')
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now();
$$;

revoke all on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated;

-- Only whether the very first account (which becomes the owner) can still be
-- created. Says nothing about any address.
create or replace function public.workspace_bootstrap_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from organization);
$$;

revoke all on function public.workspace_bootstrap_open() from public;
grant execute on function public.workspace_bootstrap_open() to anon, authenticated;

-- No more "is this address invited?" for anonymous callers.
revoke all on function public.signup_allowed(text) from public, anon, authenticated;
