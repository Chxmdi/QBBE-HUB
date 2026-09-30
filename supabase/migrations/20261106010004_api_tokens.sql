-- Workspace OS S6 Flow, V2-8: a private, versioned API (/api/v1) with access
-- tokens (epic #199).
--
--   api_token        a token belongs to one person and one organization, has
--                    scopes and an expiry (at most a year), and can be revoked.
--                    Only its SHA-256 hash is stored; the token itself is shown
--                    once, when it is made. Its owner reads their own tokens;
--                    owners and admins read (and revoke) all of theirs.
--   api_request_log  one row per call, made or refused: the audit trail. The
--                    token's owner reads their own; owners and admins read all.
--                    Written by the API route (service role) only.
--   app.api_list_objects
--                    objects the token's person may view, answered by the one
--                    access check (app.can_as), newest first. Service role only.
--
-- A call runs as the token's person at the first sign-in level (aal1): a token
-- is not a two-step sign-in, so what needs one is refused, as it would be for
-- that person without it.

create table public.api_token (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text not null check (char_length(token_prefix) between 8 and 16),
  scopes text[] not null check (
    cardinality(scopes) >= 1
    and scopes <@ array['objects:read', 'actions:run']::text[]
  ),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '366 days')
);

comment on table public.api_token is
  'Private API tokens (V2-8). One person, one organization, scopes and an expiry. Only the SHA-256 hash is kept.';

create index idx_api_token_user on public.api_token (user_id, created_at desc);
create index idx_api_token_org on public.api_token (organization_id, created_at desc);

alter table public.api_token enable row level security;

create policy api_token_owner_read on public.api_token
  for select to authenticated
  using (user_id = (select auth.uid()) and app.is_org_member(organization_id));
create policy api_token_admin_read on public.api_token
  for select to authenticated
  using (app.is_org_admin(organization_id));
-- A person makes tokens for themselves only, in an organization they belong
-- to, never already revoked or used.
create policy api_token_owner_insert on public.api_token
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app.is_org_member(organization_id)
    and revoked_at is null
    and revoked_by is null
    and last_used_at is null
  );
-- No update or delete policy: revoking goes through revoke_api_token.

create or replace function public.revoke_api_token(p_token uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_token public.api_token;
begin
  if v_uid is null then
    raise exception 'Sign in to revoke a token' using errcode = '42501';
  end if;
  select * into v_token from public.api_token where id = p_token for update;
  if not found or not (
    (v_token.user_id = v_uid and app.is_org_member(v_token.organization_id))
    or app.is_org_admin(v_token.organization_id)
  ) then
    raise exception 'This token is not yours to revoke' using errcode = '42501';
  end if;
  update public.api_token
  set revoked_at = coalesce(revoked_at, now()),
      revoked_by = coalesce(revoked_by, v_uid)
  where id = p_token;
end;
$$;

revoke all on function public.revoke_api_token(uuid) from public, anon;
grant execute on function public.revoke_api_token(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- api_request_log
-- ---------------------------------------------------------------------------

create table public.api_request_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organization (id) on delete cascade,
  token_id uuid references public.api_token (id) on delete set null,
  user_id uuid references public.user_profile (id) on delete set null,
  method text not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD')),
  path text not null check (char_length(path) <= 300),
  status int not null check (status between 100 and 599),
  error_code text check (error_code is null or char_length(error_code) <= 64),
  duration_ms int check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);

comment on table public.api_request_log is
  'Every private API call, allowed or refused (V2-8). Written by the API route only.';

create index idx_api_request_log_org on public.api_request_log (organization_id, created_at desc);
create index idx_api_request_log_token on public.api_request_log (token_id, created_at desc);

alter table public.api_request_log enable row level security;

create policy api_request_log_owner_read on public.api_request_log
  for select to authenticated
  using (user_id = (select auth.uid()) and app.is_org_member(organization_id));
create policy api_request_log_admin_read on public.api_request_log
  for select to authenticated
  using (app.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- app.api_list_objects
-- ---------------------------------------------------------------------------

create or replace function app.api_list_objects(
  p_user uuid,
  p_organization uuid,
  p_type text default null,
  p_limit int default 50,
  p_after_updated timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  type text,
  title text,
  owner_id uuid,
  parent_object_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language sql volatile security definer
set search_path = ''
as $$
  select o.id, t.key, o.title, o.owner_id, o.parent_object_id, o.created_at, o.updated_at, o.archived_at
  from public.object o
  join public.object_type t on t.id = o.type_id
  where o.organization_id = p_organization
    and o.deleted_at is null
    and (p_type is null or t.key = p_type)
    and (
      p_after_updated is null
      or o.updated_at < p_after_updated
      or (o.updated_at = p_after_updated and o.id > p_after_id)
    )
    and app.can_as(p_user, o.id, 'view')
  order by o.updated_at desc, o.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.api_list_objects(
  p_user uuid,
  p_organization uuid,
  p_type text default null,
  p_limit int default 50,
  p_after_updated timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  type text,
  title text,
  owner_id uuid,
  parent_object_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language sql volatile security definer
set search_path = ''
as $$
  select * from app.api_list_objects(p_user, p_organization, p_type, p_limit, p_after_updated, p_after_id);
$$;

revoke all on function app.api_list_objects(uuid, uuid, text, int, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.api_list_objects(uuid, uuid, text, int, timestamptz, uuid) from public, anon, authenticated;
grant execute on function app.api_list_objects(uuid, uuid, text, int, timestamptz, uuid) to service_role;
grant execute on function public.api_list_objects(uuid, uuid, text, int, timestamptz, uuid) to service_role;
