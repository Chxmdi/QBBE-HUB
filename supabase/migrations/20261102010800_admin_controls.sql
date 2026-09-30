-- Workspace OS admin controls (V2-9, epic #199, stream S2).
--
-- 1. Sign-in rules per organization role: whether two-step sign-in (MFA) is
--    required, and how long a session may last before signing in again.
--    Owners and admins always need two-step sign-in (as today); the rules
--    can only add to that. public.my_sign_in_status() tells the app whether
--    the current session meets its role's rule; the app sends the person to
--    set up two-step sign-in or to sign in again when it does not.
-- 2. "What can this role see": public.role_visibility_report(role) lists,
--    for someone holding only that organization role (no personal or team
--    grants), what they can do in each space and how many programs,
--    projects and tasks they can open, and which properties are hidden from
--    them. From the same access model as app.can, so it cannot drift.
-- 3. Audit export is a route (/spaces/admin/audit-export) reading audit_event
--    through its own policy (admins only); it records itself in audit_event.
-- Google sign-in is configuration (supabase/config.toml and the hosted
-- project's settings); docs/runbooks/google-sign-in.md has the steps.

create table public.sign_in_rule (
  organization_id uuid not null references public.organization (id) on delete cascade,
  role public.org_role not null,
  require_mfa boolean not null default false,
  -- Null: no limit beyond Supabase's own session settings.
  max_session_hours integer check (max_session_hours is null or max_session_hours between 1 and 720),
  updated_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, role),
  constraint sign_in_rule_admins_need_mfa check (role not in ('owner', 'admin') or require_mfa)
);

comment on table public.sign_in_rule is
  'Workspace OS (V2-9): per-role sign-in rules. Owners and admins always require two-step sign-in.';

create trigger sign_in_rule_set_updated_at
  before update on public.sign_in_rule
  for each row execute function public.set_updated_at();

-- Today's rule, written down, for every organization and every role.
insert into public.sign_in_rule (organization_id, role, require_mfa, updated_by)
select o.id, r.role, r.role in ('owner', 'admin'), null
from public.organization o
cross join unnest(enum_range(null::public.org_role)) as r (role)
on conflict do nothing;

create or replace function app.seed_sign_in_rules()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.sign_in_rule (organization_id, role, require_mfa, updated_by)
  select new.id, r.role, r.role in ('owner', 'admin'), null
  from unnest(enum_range(null::public.org_role)) as r (role)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function app.seed_sign_in_rules() from public, anon, authenticated;

create trigger organization_sign_in_rules
  after insert on public.organization
  for each row execute function app.seed_sign_in_rules();

alter table public.sign_in_rule enable row level security;

-- Members read their organization's rules (the app checks its own); admins change them.
create policy sign_in_rule_read on public.sign_in_rule
  for select to authenticated
  using (app.is_org_member(organization_id));
create policy sign_in_rule_admin_update on public.sign_in_rule
  for update to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

revoke all on public.sign_in_rule from anon, authenticated;
grant select on public.sign_in_rule to authenticated;
grant update (require_mfa, max_session_hours) on public.sign_in_rule to authenticated;
grant all on public.sign_in_rule to service_role;

-- Changing a rule is a security event.
create or replace function app.audit_sign_in_rule()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (new.require_mfa, new.max_session_hours) is distinct from (old.require_mfa, old.max_session_hours) then
    insert into public.audit_event (organization_id, actor_id, event_type, action, object_type, metadata)
    values (new.organization_id, (select auth.uid()), 'security', 'sign_in_rule_changed', 'sign_in_rule',
      jsonb_build_object('role', new.role,
        'require_mfa', jsonb_build_object('before', old.require_mfa, 'after', new.require_mfa),
        'max_session_hours', jsonb_build_object('before', old.max_session_hours, 'after', new.max_session_hours)));
  end if;
  return new;
end;
$$;
revoke all on function app.audit_sign_in_rule() from public, anon, authenticated;

create trigger sign_in_rule_audited
  after update on public.sign_in_rule
  for each row execute function app.audit_sign_in_rule();

-- Whether the current session meets its role's rule. Reads the session's
-- start and the person's factors from auth, which the app cannot read.
create or replace function public.my_sign_in_status()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'role', m.role,
    'require_mfa', coalesce(r.require_mfa, m.role in ('owner', 'admin')),
    'has_verified_factor', exists (
      select 1 from auth.mfa_factors f
      where f.user_id = m.user_id and f.factor_type = 'totp' and f.status = 'verified'),
    'aal', coalesce((select auth.jwt()) ->> 'aal', 'aal1'),
    'mfa_ok', not coalesce(r.require_mfa, m.role in ('owner', 'admin'))
              or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2',
    'max_session_hours', r.max_session_hours,
    'session_started_at', s.created_at,
    'session_ok', r.max_session_hours is null or s.created_at is null
                  or s.created_at > now() - make_interval(hours => r.max_session_hours))
  from public.organization_membership m
  left join public.sign_in_rule r on r.organization_id = m.organization_id and r.role = m.role
  left join auth.sessions s
    on s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid and s.user_id = m.user_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
  order by m.joined_at
  limit 1;
$$;
revoke all on function public.my_sign_in_status() from public, anon;
grant execute on function public.my_sign_in_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What can this role see
-- ---------------------------------------------------------------------------

-- Bits organization-role grants give a role on a node (no person or team
-- grants): the same inheritance rule as app.access_compute.
create or replace function app.role_grant_bits(p_node uuid, p_role public.org_role)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce(bit_or(r.caps), 0)::integer
  from app.access_node o
  cross join lateral unnest(o.ancestors) with ordinality as a (id, depth)
  join public.access_grant g
    on g.object_id = a.id and g.organization_id = o.organization_id
   and g.principal_kind = 'org_role' and g.org_role = p_role
   and (a.depth = 1 or g.reach = 'subtree'
        or (g.reach = 'self_and_child_tasks' and a.depth = 2 and o.kind = 'task'))
  join public.access_role r on r.id = g.role_id
  where o.id = p_node;
$$;
revoke all on function app.role_grant_bits(uuid, public.org_role) from public, anon, authenticated;

create or replace function public.role_visibility_report(role public.org_role)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_role public.org_role := role_visibility_report.role;
  v_spaces jsonb;
  v_counts jsonb;
  v_hidden jsonb := '[]'::jsonb;
begin
  select m.organization_id into v_org
  from public.organization_membership m
  where m.user_id = (select auth.uid()) and m.status = 'active'
  order by m.joined_at limit 1;
  if v_org is null or not app.is_org_admin(v_org) then
    raise exception 'Only an owner or administrator with two-step sign-in can see this report.' using errcode = '42501';
  end if;

  -- Someone with only this role, signed in with two-step sign-in (the most
  -- they could have). Private spaces are left out: they are their owner's.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'kind', s.kind, 'name_en', s.name_en, 'name_fr', s.name_fr,
           'capabilities', to_jsonb(app.bits_to_caps(app.access_finish_bits(
             v_role, true, n.in_private, n.archived, app.role_grant_bits(s.id, v_role)))))
           order by case s.kind when 'workspace' then 0 when 'program' then 1 else 2 end, s.name_en), '[]'::jsonb)
  into v_spaces
  from public.space s join app.access_node n on n.id = s.id
  where s.organization_id = v_org and s.kind <> 'private';

  select jsonb_build_object(
    'programs', jsonb_build_object('visible', count(*) filter (where n.kind = 'space' and n.space_kind = 'program' and vis),
                                   'total', count(*) filter (where n.kind = 'space' and n.space_kind = 'program')),
    'projects', jsonb_build_object('visible', count(*) filter (where n.kind = 'project' and vis),
                                   'total', count(*) filter (where n.kind = 'project')),
    'tasks', jsonb_build_object('visible', count(*) filter (where n.kind = 'task' and vis),
                                'total', count(*) filter (where n.kind = 'task')),
    'pages', jsonb_build_object('visible', count(*) filter (where n.kind = 'object' and vis),
                                'total', count(*) filter (where n.kind = 'object')))
  into v_counts
  from (
    select n.*, app.access_finish_bits(v_role, true, n.in_private, n.archived, app.role_grant_bits(n.id, v_role)) & 1 <> 0 as vis
    from app.access_node n where n.organization_id = v_org and not n.in_private
  ) n;

  if to_regclass('public.property_definition') is not null then
    execute $sql$
      select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'name_en', d.name_en, 'name_fr', d.name_fr)
                                order by d.key), '[]'::jsonb)
      from public.property_definition d
      where d.organization_id = $1 and d.visible_to_roles is not null and not ($2 = any (d.visible_to_roles))
        and d.archived_at is null
    $sql$ into v_hidden using v_org, v_role;
  end if;

  return jsonb_build_object('role', v_role, 'spaces', v_spaces, 'counts', v_counts, 'hidden_properties', v_hidden);
end;
$$;
revoke all on function public.role_visibility_report(public.org_role) from public, anon;
grant execute on function public.role_visibility_report(public.org_role) to authenticated, service_role;
