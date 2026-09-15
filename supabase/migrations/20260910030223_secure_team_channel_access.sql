-- Team ownership and channel membership provenance.
--
-- `channel_member` remains the fast, preference-bearing effective projection.
-- `channel_access_grant` is authoritative: one person can hold direct,
-- mandatory and team-derived access at the same time without one source
-- overwriting another.

create type public.channel_access_source as enum (
  'direct', 'mandatory', 'team', 'program', 'project', 'event', 'legacy'
);

alter table public.team add column owner_id uuid;
alter table public.team_member add column organization_id uuid;
alter table public.channel add column team_id uuid;

-- Existing teams predate ownership. Prefer the active primary owner, then an
-- administrator, then another active member. Failing the NOT NULL below is
-- intentional if an organization has no active custodian.
update public.team t
set owner_id = (
  select m.user_id
  from public.organization_membership m
  where m.organization_id = t.organization_id and m.status = 'active'
  order by case m.role
    when 'owner' then 0 when 'admin' then 1 when 'staff' then 2 else 3 end,
    m.joined_at, m.user_id
  limit 1
);

update public.team_member tm
set organization_id = t.organization_id
from public.team t
where t.id = tm.team_id;

alter table public.team alter column owner_id set not null;
alter table public.team_member alter column organization_id set not null;

alter table public.team
  add constraint team_owner_membership_fk
  foreign key (organization_id, owner_id)
  references public.organization_membership (organization_id, user_id);

alter table public.team_member
  add constraint team_member_team_org_fk
  foreign key (team_id, organization_id)
  references public.team (id, organization_id)
  on delete cascade;

alter table public.team_member
  add constraint team_member_org_membership_fk
  foreign key (organization_id, user_id)
  references public.organization_membership (organization_id, user_id)
  on delete cascade;

alter table public.channel
  add constraint channel_id_organization_unique unique (id, organization_id),
  add constraint channel_team_unique unique (team_id),
  add constraint channel_team_org_fk
    foreign key (team_id, organization_id)
    references public.team (id, organization_id)
    on delete cascade;

-- Pair legacy private team channels and teams by organization/name and stable
-- creation order. This avoids guessing when duplicate names exist.
with ranked_teams as (
  select id, organization_id, lower(name) as normalized_name,
         row_number() over (
           partition by organization_id, lower(name) order by created_at, id
         ) as ordinal
  from public.team
), ranked_channels as (
  select id, organization_id, lower(name) as normalized_name,
         row_number() over (
           partition by organization_id, lower(name) order by created_at, id
         ) as ordinal
  from public.channel
  where type = 'team' and privacy = 'private' and team_id is null
), matches as (
  select t.id as team_id, c.id as channel_id
  from ranked_teams t
  join ranked_channels c
    on c.organization_id = t.organization_id
   and c.normalized_name = t.normalized_name
   and c.ordinal = t.ordinal
)
update public.channel c
set team_id = m.team_id
from matches m
where c.id = m.channel_id;

-- Team channel slugs carry an ID suffix, making creation deterministic and
-- collision-safe even when teams share a display name.
insert into public.channel (
  organization_id, name, slug, type, privacy, purpose, owner_id, team_id,
  created_by
)
select t.organization_id, t.name,
       'team-' || coalesce(
         nullif(trim(both '-' from regexp_replace(lower(t.name), '[^a-z0-9]+', '-', 'g')), ''),
         'channel'
       ) || '-' || left(t.id::text, 8),
       'team', 'private', coalesce(t.description, 'Private team channel.'),
       t.owner_id, t.id, t.owner_id
from public.team t
where not exists (select 1 from public.channel c where c.team_id = t.id);

-- Normalize linked legacy channels to the invariant enforced for new writes.
update public.channel c
set type = 'team', privacy = 'private', owner_id = t.owner_id
from public.team t
where c.team_id = t.id;

-- Every team owner participates in the team and therefore receives its
-- derived channel access. Existing members remain untouched.
insert into public.team_member (team_id, user_id, organization_id)
select t.id, t.owner_id, t.organization_id from public.team t
on conflict (team_id, user_id) do nothing;

create table public.channel_access_grant (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  channel_id uuid not null references public.channel (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'manager')),
  source public.channel_access_source not null,
  source_team_id uuid references public.team (id) on delete cascade,
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint channel_access_grant_source_shape check (
    (source = 'team' and source_team_id is not null)
    or (source <> 'team' and source_team_id is null)
  ),
  constraint channel_access_grant_channel_org_fk
    foreign key (channel_id, organization_id)
    references public.channel (id, organization_id)
    on delete cascade,
  constraint channel_access_grant_target_membership_fk
    foreign key (organization_id, user_id)
    references public.organization_membership (organization_id, user_id)
    on delete cascade,
  constraint channel_access_grant_team_member_fk
    foreign key (source_team_id, user_id)
    references public.team_member (team_id, user_id)
    on delete cascade,
  constraint channel_access_grant_team_org_fk
    foreign key (source_team_id, organization_id)
    references public.team (id, organization_id)
    on delete cascade,
  unique nulls not distinct (channel_id, user_id, source, source_team_id)
);

create index channel_access_grant_user_channel_idx
  on public.channel_access_grant (user_id, channel_id);
create index channel_access_grant_team_idx
  on public.channel_access_grant (source_team_id)
  where source_team_id is not null;

create table public.program_team_assignment (
  organization_id uuid not null references public.organization (id) on delete cascade,
  program_id uuid not null,
  team_id uuid not null,
  role public.program_access_role not null default 'contributor',
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (program_id, team_id),
  constraint program_team_assignment_program_org_fk
    foreign key (program_id, organization_id)
    references public.program (id, organization_id) on delete cascade,
  constraint program_team_assignment_team_org_fk
    foreign key (team_id, organization_id)
    references public.team (id, organization_id) on delete cascade
);

create table public.project_team_assignment (
  organization_id uuid not null references public.organization (id) on delete cascade,
  project_id uuid not null,
  team_id uuid not null,
  role public.project_access_role not null default 'contributor',
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (project_id, team_id),
  constraint project_team_assignment_project_org_fk
    foreign key (project_id, organization_id)
    references public.project (id, organization_id) on delete cascade,
  constraint project_team_assignment_team_org_fk
    foreign key (team_id, organization_id)
    references public.team (id, organization_id) on delete cascade
);

create index program_team_assignment_team_idx
  on public.program_team_assignment (team_id, program_id);
create index project_team_assignment_team_idx
  on public.project_team_assignment (team_id, project_id);

alter table public.channel_access_grant enable row level security;
alter table public.program_team_assignment enable row level security;
alter table public.project_team_assignment enable row level security;
create policy channel_access_grant_read on public.channel_access_grant
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or app.is_org_admin(organization_id)
    or exists (
      select 1 from public.channel c
      where c.id = channel_id and c.owner_id = (select auth.uid())
        and app.is_org_member(c.organization_id)
    )
  );

create policy program_team_assignment_admin on public.program_team_assignment
  for all to authenticated
  using (public.has_program_capability(program_id, 'manage'))
  with check (public.has_program_capability(program_id, 'manage'));
create policy project_team_assignment_admin on public.project_team_assignment
  for all to authenticated
  using (public.has_project_capability(project_id, 'manage'))
  with check (public.has_project_capability(project_id, 'manage'));

grant select on public.channel_access_grant to authenticated;
grant select, insert, update, delete on public.channel_access_grant to service_role;
revoke insert, update, delete on public.channel_access_grant from authenticated, anon;
grant select, insert, update, delete on public.program_team_assignment to authenticated, service_role;
grant select, insert, update, delete on public.project_team_assignment to authenticated, service_role;
revoke all on public.program_team_assignment from anon;
revoke all on public.project_team_assignment from anon;

-- Turn the legacy single-source projection into provenance rows before its
-- write surface is closed.
insert into public.channel_access_grant (
  organization_id, channel_id, user_id, role, source, source_team_id, created_by,
  created_at
)
select c.organization_id, cm.channel_id, cm.user_id, cm.role,
       case
         when cm.membership_source = 'mandatory' then 'mandatory'::public.channel_access_source
         when cm.membership_source = 'manual' then 'direct'::public.channel_access_source
         when cm.membership_source = 'program' then 'program'::public.channel_access_source
         when cm.membership_source = 'project' then 'project'::public.channel_access_source
         when cm.membership_source = 'event' then 'event'::public.channel_access_source
         when cm.membership_source = 'team'
              and c.team_id is not null
              and exists (
                select 1 from public.team_member tm
                where tm.team_id = c.team_id and tm.user_id = cm.user_id
              ) then 'team'::public.channel_access_source
         else 'legacy'::public.channel_access_source
       end,
       case
         when cm.membership_source = 'team'
              and c.team_id is not null
              and exists (
                select 1 from public.team_member tm
                where tm.team_id = c.team_id and tm.user_id = cm.user_id
              ) then c.team_id
         else null
       end,
       c.owner_id, cm.joined_at
from public.channel_member cm
join public.channel c on c.id = cm.channel_id
on conflict do nothing;

-- Ensure all current team members and all organization memberships in
-- mandatory channels have their own independent provenance.
insert into public.channel_access_grant (
  organization_id, channel_id, user_id, role, source, source_team_id, created_by
)
select t.organization_id, c.id, tm.user_id,
       case when tm.user_id = t.owner_id then 'manager' else 'member' end,
       'team', t.id, t.owner_id
from public.team t
join public.team_member tm on tm.team_id = t.id
join public.channel c on c.team_id = t.id
on conflict do nothing;

insert into public.channel_access_grant (
  organization_id, channel_id, user_id, role, source, created_by
)
select c.organization_id, c.id, m.user_id, 'member', 'mandatory', c.owner_id
from public.channel c
join public.organization_membership m
  on m.organization_id = c.organization_id
where c.is_mandatory
on conflict do nothing;

create or replace function app.validate_team_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id
      and m.user_id = new.owner_id and m.status = 'active'
  ) then
    raise exception 'Team owner must be an active member of the team organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.validate_team_member()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select t.organization_id into v_org from public.team t where t.id = new.team_id;
  if v_org is null then
    raise exception 'Team does not exist' using errcode = '23503';
  end if;
  new.organization_id := v_org;
  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_org and m.user_id = new.user_id
      and m.status = 'active'
  ) then
    raise exception 'Team member must be active in the team organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.validate_team_channel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_team public.team;
begin
  if new.team_id is null then
    if new.type = 'team' then
      raise exception 'Team channels must reference their team' using errcode = '23514';
    end if;
    return new;
  end if;
  select * into v_team from public.team where id = new.team_id;
  if not found or v_team.organization_id <> new.organization_id
     or new.type <> 'team' or new.privacy <> 'private'
     or new.owner_id is distinct from v_team.owner_id then
    raise exception 'A team channel must be private, same-organization, and owned by its team owner'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.require_one_team_channel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_team_id uuid;
begin
  if tg_table_name = 'team' then
    v_team_id := case when tg_op = 'DELETE' then old.id else new.id end;
    if exists (select 1 from public.team where id = v_team_id)
       and (select count(*) from public.channel where team_id = v_team_id) <> 1 then
      raise exception 'Each team must have exactly one team channel' using errcode = '23514';
    end if;
  else
    if tg_op <> 'INSERT' and old.team_id is not null
       and exists (select 1 from public.team where id = old.team_id)
       and (select count(*) from public.channel where team_id = old.team_id) <> 1 then
      raise exception 'Each team must have exactly one team channel' using errcode = '23514';
    end if;
    if tg_op <> 'DELETE' and new.team_id is not null
       and exists (select 1 from public.team where id = new.team_id)
       and (select count(*) from public.channel where team_id = new.team_id) <> 1 then
      raise exception 'Each team must have exactly one team channel' using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;

create or replace function app.validate_channel_access_grant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_channel public.channel;
begin
  select * into v_channel from public.channel where id = new.channel_id;
  if not found or v_channel.organization_id <> new.organization_id then
    raise exception 'Channel grant must use the channel organization' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id and m.user_id = new.user_id
      and m.status = 'active'
  ) then
    raise exception 'Channel access target must be an active organization member'
      using errcode = '23514';
  end if;
  if new.source = 'team' and (
    v_channel.team_id is distinct from new.source_team_id
    or not exists (
      select 1 from public.team_member tm
      where tm.team_id = new.source_team_id and tm.user_id = new.user_id
    )
  ) then
    raise exception 'Team channel access must match a current team membership'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_team_owner
before insert or update of owner_id, organization_id on public.team
for each row execute function app.validate_team_owner();
create trigger validate_team_member
before insert or update of team_id, user_id, organization_id on public.team_member
for each row execute function app.validate_team_member();
create trigger validate_team_channel
before insert or update of team_id, type, privacy, organization_id, owner_id on public.channel
for each row execute function app.validate_team_channel();
create trigger validate_channel_access_grant
before insert or update on public.channel_access_grant
for each row execute function app.validate_channel_access_grant();

create constraint trigger team_requires_channel
after insert or update on public.team
deferrable initially deferred
for each row execute function app.require_one_team_channel();
create constraint trigger channel_preserves_team_channel
after insert or update or delete on public.channel
deferrable initially deferred
for each row execute function app.require_one_team_channel();

create or replace function app.guard_team_owner_deactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status <> 'active'
     and exists (
       select 1 from public.team t
       where t.organization_id = old.organization_id and t.owner_id = old.user_id
     ) then
    raise exception 'Transfer team ownership before deactivating this member'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_team_owner_deactivation
before update of status on public.organization_membership
for each row execute function app.guard_team_owner_deactivation();

create or replace function app.guard_team_owner_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and current_user not in ('postgres', 'service_role') then
    raise exception 'Team ownership can only change through the ownership transfer command'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_team_owner_update
before update of owner_id on public.team
for each row execute function app.guard_team_owner_update();

create or replace function app.refresh_channel_member(
  p_channel uuid, p_user uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_source text;
begin
  select case
           when count(*) = 0 then null
           when bool_or(g.role = 'manager') then 'manager'
           else 'member'
         end,
         (array_agg(
           case g.source
             when 'mandatory' then 'mandatory'
             when 'team' then 'team'
             when 'direct' then 'manual'
             else g.source::text
           end
           order by case g.source
             when 'mandatory' then 0 when 'team' then 1 when 'direct' then 2 else 3 end
         ))[1]
  into v_role, v_source
  from public.channel_access_grant g
  where g.channel_id = p_channel and g.user_id = p_user;

  if v_role is null then
    delete from public.channel_member
    where channel_id = p_channel and user_id = p_user;
  else
    insert into public.channel_member (
      channel_id, user_id, role, membership_source
    ) values (p_channel, p_user, v_role, v_source)
    on conflict (channel_id, user_id) do update
      set role = excluded.role, membership_source = excluded.membership_source;
  end if;
end;
$$;

create or replace function app.sync_channel_access_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (old.channel_id, old.user_id) is distinct from
                           (new.channel_id, new.user_id) then
    perform app.refresh_channel_member(old.channel_id, old.user_id);
  end if;
  perform app.refresh_channel_member(
    case when tg_op = 'DELETE' then old.channel_id else new.channel_id end,
    case when tg_op = 'DELETE' then old.user_id else new.user_id end
  );
  return null;
end;
$$;
create trigger sync_channel_access_projection
after insert or update or delete on public.channel_access_grant
for each row execute function app.sync_channel_access_projection();

-- Grants were backfilled before the projection trigger existed. Rebuild every
-- affected pair once so newly generated team/mandatory sources are visible.
do $projection_rebuild$
declare
  v_pair record;
begin
  for v_pair in
    select distinct channel_id, user_id from public.channel_access_grant
  loop
    perform app.refresh_channel_member(v_pair.channel_id, v_pair.user_id);
  end loop;
end;
$projection_rebuild$;

create or replace function app.guard_channel_member_projection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'Channel membership is managed through access grants'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger guard_channel_member_projection_insert_delete
before insert or delete on public.channel_member
for each row execute function app.guard_channel_member_projection();

-- Preserve compatibility with older privileged provisioning functions while
-- making every resulting projection authoritative and source-aware.
create or replace function app.capture_channel_member_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_source public.channel_access_source;
  v_team uuid;
begin
  if exists (
    select 1 from public.channel_access_grant g
    where g.channel_id = new.channel_id and g.user_id = new.user_id
  ) then
    return null;
  end if;
  select c.organization_id, c.team_id into v_org, v_team
  from public.channel c where c.id = new.channel_id;
  v_source := case
    when new.membership_source = 'mandatory' then 'mandatory'::public.channel_access_source
    when new.membership_source = 'manual' then 'direct'::public.channel_access_source
    when new.membership_source = 'program' then 'program'::public.channel_access_source
    when new.membership_source = 'project' then 'project'::public.channel_access_source
    when new.membership_source = 'event' then 'event'::public.channel_access_source
    when new.membership_source = 'team' and v_team is not null then 'team'::public.channel_access_source
    else 'legacy'::public.channel_access_source
  end;
  insert into public.channel_access_grant (
    organization_id, channel_id, user_id, role, source, source_team_id
  ) values (
    v_org, new.channel_id, new.user_id, new.role, v_source,
    case when v_source = 'team' then v_team else null end
  ) on conflict do nothing;
  return null;
end;
$$;
create trigger capture_channel_member_grant
after insert on public.channel_member
for each row execute function app.capture_channel_member_grant();

create or replace function app.sync_program_team_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    delete from public.program_access_grant
    where program_id = old.program_id and source = 'team'
      and source_team_id = old.team_id;
  end if;
  if tg_op <> 'DELETE' then
    insert into public.program_access_grant (
      organization_id, program_id, user_id, role, source, source_team_id,
      created_by
    )
    select new.organization_id, new.program_id, tm.user_id, new.role,
           'team', new.team_id, new.created_by
    from public.team_member tm
    join public.organization_membership m
      on m.organization_id = new.organization_id and m.user_id = tm.user_id
     and m.status = 'active'
    where tm.team_id = new.team_id
    on conflict (program_id, user_id, source, source_team_id)
      do update set role = excluded.role, created_by = excluded.created_by;
  end if;
  return null;
end;
$$;
create trigger sync_program_team_assignment
after insert or update or delete on public.program_team_assignment
for each row execute function app.sync_program_team_assignment();

create or replace function app.sync_project_team_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    delete from public.project_access_grant
    where project_id = old.project_id and source = 'team'
      and source_team_id = old.team_id;
  end if;
  if tg_op <> 'DELETE' then
    insert into public.project_access_grant (
      organization_id, project_id, user_id, role, source, source_team_id,
      created_by
    )
    select new.organization_id, new.project_id, tm.user_id, new.role,
           'team', new.team_id, new.created_by
    from public.team_member tm
    join public.organization_membership m
      on m.organization_id = new.organization_id and m.user_id = tm.user_id
     and m.status = 'active'
    where tm.team_id = new.team_id
    on conflict (project_id, user_id, source, source_team_id, source_program_grant_id)
      do update set role = excluded.role, created_by = excluded.created_by;
  end if;
  return null;
end;
$$;
create trigger sync_project_team_assignment
after insert or update or delete on public.project_team_assignment
for each row execute function app.sync_project_team_assignment();

create or replace function app.audit_team_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_team uuid;
  v_scope uuid;
  v_scope_type text;
begin
  if tg_table_name = 'program_team_assignment' then
    v_scope_type := 'program';
    if tg_op = 'DELETE' then
      v_org := old.organization_id; v_team := old.team_id; v_scope := old.program_id;
    else
      v_org := new.organization_id; v_team := new.team_id; v_scope := new.program_id;
    end if;
  else
    v_scope_type := 'project';
    if tg_op = 'DELETE' then
      v_org := old.organization_id; v_team := old.team_id; v_scope := old.project_id;
    else
      v_org := new.organization_id; v_team := new.team_id; v_scope := new.project_id;
    end if;
  end if;
  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id, metadata
  ) values (
    v_org, auth.uid(), 'access',
    case tg_op when 'INSERT' then 'team_assigned'
               when 'UPDATE' then 'team_assignment_updated' else 'team_unassigned' end,
    v_scope_type, v_scope, jsonb_build_object('team_id', v_team)
  );
  return null;
end;
$$;
create trigger audit_program_team_assignment
after insert or update or delete on public.program_team_assignment
for each row execute function app.audit_team_assignment();
create trigger audit_project_team_assignment
after insert or update or delete on public.project_team_assignment
for each row execute function app.audit_team_assignment();

create or replace function app.sync_team_channel_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.team;
  v_channel uuid;
begin
  if tg_op = 'INSERT' then
    select * into v_team from public.team where id = new.team_id;
    select id into v_channel from public.channel where team_id = new.team_id;
    if v_channel is not null then
      insert into public.channel_access_grant (
        organization_id, channel_id, user_id, role, source, source_team_id,
        created_by
      ) values (
        v_team.organization_id, v_channel, new.user_id,
        case when new.user_id = v_team.owner_id then 'manager' else 'member' end,
        'team', new.team_id, auth.uid()
      ) on conflict do nothing;
    end if;
    insert into public.program_access_grant (
      organization_id, program_id, user_id, role, source, source_team_id,
      created_by
    )
    select a.organization_id, a.program_id, new.user_id, a.role, 'team',
           new.team_id, a.created_by
    from public.program_team_assignment a
    where a.team_id = new.team_id
    on conflict (program_id, user_id, source, source_team_id)
      do update set role = excluded.role, created_by = excluded.created_by;

    insert into public.project_access_grant (
      organization_id, project_id, user_id, role, source, source_team_id,
      created_by
    )
    select a.organization_id, a.project_id, new.user_id, a.role, 'team',
           new.team_id, a.created_by
    from public.project_team_assignment a
    where a.team_id = new.team_id
    on conflict (project_id, user_id, source, source_team_id, source_program_grant_id)
      do update set role = excluded.role, created_by = excluded.created_by;
  end if;
  return null;
end;
$$;
create trigger sync_team_channel_access
after insert on public.team_member
for each row execute function app.sync_team_channel_access();

create or replace function app.sync_new_team_channel_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.team_id is not null then
    insert into public.channel_access_grant (
      organization_id, channel_id, user_id, role, source, source_team_id,
      created_by
    )
    select new.organization_id, new.id, tm.user_id,
           case when tm.user_id = t.owner_id then 'manager' else 'member' end,
           'team', t.id, auth.uid()
    from public.team t
    join public.team_member tm on tm.team_id = t.id
    where t.id = new.team_id
    on conflict do nothing;
  end if;
  if new.is_mandatory then
    insert into public.channel_access_grant (
      organization_id, channel_id, user_id, role, source, created_by
    )
    select new.organization_id, new.id, m.user_id, 'member', 'mandatory', auth.uid()
    from public.organization_membership m
    where m.organization_id = new.organization_id
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger sync_new_team_channel_access
after insert on public.channel
for each row execute function app.sync_new_team_channel_access();

create or replace function app.sync_new_member_mandatory_channels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then return null; end if;
  insert into public.channel_access_grant (
    organization_id, channel_id, user_id, role, source, created_by
  )
  select new.organization_id, c.id, new.user_id, 'member', 'mandatory', auth.uid()
  from public.channel c
  where c.organization_id = new.organization_id and c.is_mandatory
  on conflict do nothing;

  -- A team assignment may have been added while this retained team member was
  -- inactive. Materialize any missing scoped grants when access is restored.
  insert into public.program_access_grant (
    organization_id, program_id, user_id, role, source, source_team_id,
    created_by
  )
  select a.organization_id, a.program_id, new.user_id, a.role, 'team',
         tm.team_id, a.created_by
  from public.team_member tm
  join public.program_team_assignment a on a.team_id = tm.team_id
  where tm.organization_id = new.organization_id and tm.user_id = new.user_id
  on conflict (program_id, user_id, source, source_team_id)
    do update set role = excluded.role, created_by = excluded.created_by;

  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, source_team_id,
    created_by
  )
  select a.organization_id, a.project_id, new.user_id, a.role, 'team',
         tm.team_id, a.created_by
  from public.team_member tm
  join public.project_team_assignment a on a.team_id = tm.team_id
  where tm.organization_id = new.organization_id and tm.user_id = new.user_id
  on conflict (project_id, user_id, source, source_team_id, source_program_grant_id)
    do update set role = excluded.role, created_by = excluded.created_by;
  return null;
end;
$$;
create trigger sync_new_member_mandatory_channels
after insert or update of status on public.organization_membership
for each row execute function app.sync_new_member_mandatory_channels();

create or replace function app.sync_team_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    insert into public.team_member (team_id, user_id, organization_id)
    values (new.id, new.owner_id, new.organization_id)
    on conflict (team_id, user_id) do nothing;
    update public.channel set owner_id = new.owner_id where team_id = new.id;
    update public.channel_access_grant
      set role = case when user_id = new.owner_id then 'manager' else 'member' end
    where source = 'team' and source_team_id = new.id
      and user_id in (old.owner_id, new.owner_id);
  end if;
  return null;
end;
$$;
create trigger sync_team_owner_change
after update of owner_id on public.team
for each row execute function app.sync_team_owner_change();

create or replace function app.audit_team_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_name text;
begin
  if tg_op = 'DELETE' then
    v_org := old.organization_id; v_id := old.id; v_name := old.name;
  else
    v_org := new.organization_id; v_id := new.id; v_name := new.name;
  end if;
  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id, metadata
  ) values (
    v_org, auth.uid(), 'access',
    case tg_op when 'INSERT' then 'team_created'
               when 'UPDATE' then 'team_updated' else 'team_deleted' end,
    'team', v_id, jsonb_build_object('name', v_name)
  );
  return null;
end;
$$;
create trigger audit_team_change
after insert or update or delete on public.team
for each row execute function app.audit_team_change();

create or replace function app.audit_team_member_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_team uuid;
  v_user uuid;
begin
  if tg_op = 'DELETE' then
    v_org := old.organization_id; v_team := old.team_id; v_user := old.user_id;
  else
    v_org := new.organization_id; v_team := new.team_id; v_user := new.user_id;
  end if;
  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id, metadata
  ) values (
    v_org, auth.uid(), 'access',
    case tg_op when 'INSERT' then 'team_member_added' else 'team_member_removed' end,
    'team', v_team, jsonb_build_object('user_id', v_user)
  );
  return null;
end;
$$;
create trigger audit_team_member_change
after insert or delete on public.team_member
for each row execute function app.audit_team_member_change();

create or replace function app.audit_direct_channel_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.channel_access_source;
  v_org uuid;
  v_channel uuid;
  v_user uuid;
begin
  if tg_op = 'DELETE' then
    v_source := old.source; v_org := old.organization_id;
    v_channel := old.channel_id; v_user := old.user_id;
  else
    v_source := new.source; v_org := new.organization_id;
    v_channel := new.channel_id; v_user := new.user_id;
  end if;
  if v_source = 'direct' then
    insert into public.audit_event (
      organization_id, actor_id, event_type, action, object_type, object_id,
      metadata
    ) values (
      v_org, auth.uid(), 'access',
      case tg_op when 'INSERT' then 'channel_access_granted' else 'channel_access_revoked' end,
      'channel', v_channel,
      jsonb_build_object('user_id', v_user, 'source', 'direct')
    );
  end if;
  return null;
end;
$$;
create trigger audit_direct_channel_access
after insert or delete on public.channel_access_grant
for each row execute function app.audit_direct_channel_access();

-- Direct projection insertion/deletion is no longer an authenticated API.
drop policy if exists channel_member_join on public.channel_member;
drop policy if exists channel_member_leave on public.channel_member;
revoke insert, delete on public.channel_member from authenticated, anon;

create or replace function public.create_team_with_channel(
  p_name text, p_description text default null, p_owner_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_team uuid := gen_random_uuid();
  v_owner uuid := coalesce(p_owner_id, v_actor);
  v_name text := btrim(p_name);
  v_slug text;
begin
  select m.organization_id into v_org
  from public.organization_membership m
  where m.user_id = v_actor and m.status = 'active'
    and app.is_org_admin(m.organization_id)
  limit 1;
  if v_org is null then raise exception 'Admin access required' using errcode = '42501'; end if;
  if v_name = '' or length(v_name) > 120 or coalesce(length(p_description), 0) > 500 then
    raise exception 'Invalid team details' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_org and m.user_id = v_owner and m.status = 'active'
  ) then
    raise exception 'Team owner must be an active organization member' using errcode = '23514';
  end if;
  v_slug := 'team-' || coalesce(
    nullif(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), ''),
    'channel'
  ) || '-' || left(v_team::text, 8);
  insert into public.team (id, organization_id, name, description, owner_id)
  values (v_team, v_org, v_name, nullif(btrim(p_description), ''), v_owner);
  insert into public.team_member (team_id, user_id, organization_id)
  values (v_team, v_owner, v_org) on conflict do nothing;
  insert into public.channel (
    organization_id, name, slug, type, privacy, purpose, owner_id, team_id,
    created_by
  ) values (
    v_org, v_name, v_slug, 'team', 'private',
    coalesce(nullif(btrim(p_description), ''), 'Private team channel.'),
    v_owner, v_team, v_actor
  );
  return v_team;
end;
$$;

create or replace function public.add_team_member(
  p_team_id uuid, p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_inserted integer;
begin
  select t.organization_id into v_org from public.team t where t.id = p_team_id;
  if v_org is null or not app.is_org_admin(v_org) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  insert into public.team_member (team_id, user_id, organization_id)
  values (p_team_id, p_user_id, v_org)
  on conflict (team_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

create or replace function public.remove_team_member(
  p_team_id uuid, p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.team;
  v_deleted integer;
begin
  select * into v_team from public.team where id = p_team_id;
  if not found or not app.is_org_admin(v_team.organization_id) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_user_id = v_team.owner_id then
    raise exception 'Transfer team ownership before removing its owner' using errcode = '23514';
  end if;
  delete from public.team_member where team_id = p_team_id and user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

create or replace function public.transfer_team_ownership(
  p_team_id uuid, p_target_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_team public.team;
begin
  select * into v_team
  from public.team
  where id = p_team_id
  for update;

  if not found or not app.is_org_admin(v_team.organization_id) then
    raise exception 'Administrator access with a second factor is required'
      using errcode = '42501';
  end if;
  if p_target_user_id = v_team.owner_id then
    return false;
  end if;
  if not exists (
    select 1
    from public.organization_membership m
    where m.organization_id = v_team.organization_id
      and m.user_id = p_target_user_id
      and m.status = 'active'
  ) then
    raise exception 'Team owner must be an active organization member'
      using errcode = '23514';
  end if;

  update public.team
  set owner_id = p_target_user_id
  where id = p_team_id;

  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id,
    metadata
  ) values (
    v_team.organization_id, v_actor, 'access', 'team_ownership_transferred',
    'team', p_team_id,
    jsonb_build_object(
      'from_user_id', v_team.owner_id,
      'to_user_id', p_target_user_id
    )
  );
  return true;
end;
$$;

create or replace function public.join_channel(p_channel_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel public.channel;
  v_inserted integer;
begin
  select * into v_channel from public.channel where id = p_channel_id;
  if not found or v_channel.privacy <> 'public' or v_channel.archived_at is not null
     or not app.is_org_member(v_channel.organization_id) then
    raise exception 'Channel is not available to join' using errcode = '42501';
  end if;
  insert into public.channel_access_grant (
    organization_id, channel_id, user_id, role, source, created_by
  ) values (
    v_channel.organization_id, p_channel_id, auth.uid(), 'member', 'direct', auth.uid()
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

create or replace function public.add_channel_member(
  p_channel_id uuid, p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel public.channel;
  v_inserted integer;
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
  insert into public.channel_access_grant (
    organization_id, channel_id, user_id, role, source, created_by
  ) values (
    v_channel.organization_id, p_channel_id, p_user_id,
    case when p_user_id = v_channel.owner_id then 'manager' else 'member' end,
    'direct', auth.uid()
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

create or replace function public.leave_channel(p_channel_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_deleted integer;
begin
  if not exists (
    select 1 from public.channel_access_grant g
    join public.channel c on c.id = g.channel_id
    where g.channel_id = p_channel_id and g.user_id = v_user
      and g.source = 'direct' and app.is_org_member(c.organization_id)
  ) then
    raise exception 'This channel access is managed by an assignment or team'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.channel_access_grant g
    where g.channel_id = p_channel_id and g.user_id = v_user
      and g.source <> 'direct'
  ) then
    raise exception 'This channel access is managed by an assignment or team'
      using errcode = '42501';
  end if;
  delete from public.channel_access_grant
  where channel_id = p_channel_id and user_id = v_user and source = 'direct';
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function app.validate_team_owner() from public, anon, authenticated;
revoke all on function app.validate_team_member() from public, anon, authenticated;
revoke all on function app.validate_team_channel() from public, anon, authenticated;
revoke all on function app.require_one_team_channel() from public, anon, authenticated;
revoke all on function app.validate_channel_access_grant() from public, anon, authenticated;
revoke all on function app.guard_team_owner_deactivation() from public, anon, authenticated;
revoke all on function app.guard_team_owner_update() from public, anon, authenticated;
revoke all on function app.refresh_channel_member(uuid, uuid) from public, anon, authenticated;
revoke all on function app.sync_channel_access_projection() from public, anon, authenticated;
revoke all on function app.guard_channel_member_projection() from public, anon, authenticated;
revoke all on function app.capture_channel_member_grant() from public, anon, authenticated;
revoke all on function app.sync_team_channel_access() from public, anon, authenticated;
revoke all on function app.sync_new_team_channel_access() from public, anon, authenticated;
revoke all on function app.sync_new_member_mandatory_channels() from public, anon, authenticated;
revoke all on function app.sync_team_owner_change() from public, anon, authenticated;
revoke all on function app.audit_team_change() from public, anon, authenticated;
revoke all on function app.audit_team_member_change() from public, anon, authenticated;
revoke all on function app.audit_direct_channel_access() from public, anon, authenticated;

revoke all on function public.create_team_with_channel(text, text, uuid) from public, anon;
revoke all on function public.add_team_member(uuid, uuid) from public, anon;
revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
revoke all on function public.transfer_team_ownership(uuid, uuid) from public, anon;
revoke all on function public.join_channel(uuid) from public, anon;
revoke all on function public.add_channel_member(uuid, uuid) from public, anon;
revoke all on function public.leave_channel(uuid) from public, anon;
grant execute on function public.create_team_with_channel(text, text, uuid) to authenticated, service_role;
grant execute on function public.add_team_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.transfer_team_ownership(uuid, uuid) to authenticated, service_role;
grant execute on function public.join_channel(uuid) to authenticated, service_role;
grant execute on function public.add_channel_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.leave_channel(uuid) to authenticated, service_role;
