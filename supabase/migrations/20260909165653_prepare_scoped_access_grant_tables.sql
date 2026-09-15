-- Preparation-only scoped access model. These tables and helpers can be
-- populated and verified before the legacy broad RLS policies are replaced.
-- One row represents one source of access, so revoking an inherited or team
-- source cannot remove an independently granted source for the same person.

create type public.program_access_role as enum (
  'lead', 'manager', 'contributor', 'reviewer', 'follower', 'read_only'
);

create type public.project_access_role as enum (
  'project_manager', 'contributor', 'reviewer', 'approver', 'follower', 'read_only'
);

create type public.scoped_grant_source as enum (
  'direct', 'legacy_membership', 'program_inherited', 'team',
  'record_owner', 'record_lead'
);

-- Composite keys let foreign keys enforce organization consistency even if a
-- parent record is later edited. The existing UUID primary keys remain the
-- canonical identifiers.
alter table public.program
  add constraint program_id_organization_unique unique (id, organization_id);
alter table public.project
  add constraint project_id_organization_unique unique (id, organization_id);
alter table public.team
  add constraint team_id_organization_unique unique (id, organization_id);

create table public.scoped_access_backfill_issue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  scope_type text not null check (scope_type in ('program', 'project')),
  scope_id uuid not null,
  user_id uuid references public.user_profile (id) on delete cascade,
  legacy_role text,
  reason text not null,
  detected_at timestamptz not null default now(),
  unique (scope_type, scope_id, user_id, reason)
);

create table public.program_access_grant (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  program_id uuid not null references public.program (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  role public.program_access_role not null,
  source public.scoped_grant_source not null,
  source_team_id uuid references public.team (id) on delete cascade,
  legacy_role text,
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint program_access_grant_source_shape check (
    (source = 'team' and source_team_id is not null and legacy_role is null)
    or
    (source = 'legacy_membership' and source_team_id is null and legacy_role is not null)
    or
    (source in ('direct', 'record_lead') and source_team_id is null and legacy_role is null)
  ),
  constraint program_access_grant_team_member_fk
    foreign key (source_team_id, user_id)
    references public.team_member (team_id, user_id)
    on delete cascade,
  constraint program_access_grant_program_org_fk
    foreign key (program_id, organization_id)
    references public.program (id, organization_id)
    on delete cascade,
  constraint program_access_grant_target_membership_fk
    foreign key (organization_id, user_id)
    references public.organization_membership (organization_id, user_id)
    on delete cascade,
  constraint program_access_grant_team_org_fk
    foreign key (source_team_id, organization_id)
    references public.team (id, organization_id)
    on delete cascade,
  unique nulls not distinct (program_id, user_id, source, source_team_id)
);

create table public.project_access_grant (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  project_id uuid not null references public.project (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  role public.project_access_role not null,
  source public.scoped_grant_source not null,
  source_team_id uuid references public.team (id) on delete cascade,
  source_program_grant_id uuid references public.program_access_grant (id) on delete cascade,
  legacy_role text,
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint project_access_grant_source_shape check (
    (source = 'team' and source_team_id is not null
      and source_program_grant_id is null and legacy_role is null)
    or
    (source = 'program_inherited' and source_team_id is null
      and source_program_grant_id is not null and legacy_role is null)
    or
    (source = 'legacy_membership' and source_team_id is null
      and source_program_grant_id is null and legacy_role is not null)
    or
    (source in ('direct', 'record_owner') and source_team_id is null
      and source_program_grant_id is null and legacy_role is null)
  ),
  constraint project_access_grant_team_member_fk
    foreign key (source_team_id, user_id)
    references public.team_member (team_id, user_id)
    on delete cascade,
  constraint project_access_grant_project_org_fk
    foreign key (project_id, organization_id)
    references public.project (id, organization_id)
    on delete cascade,
  constraint project_access_grant_target_membership_fk
    foreign key (organization_id, user_id)
    references public.organization_membership (organization_id, user_id)
    on delete cascade,
  constraint project_access_grant_team_org_fk
    foreign key (source_team_id, organization_id)
    references public.team (id, organization_id)
    on delete cascade,
  unique nulls not distinct (
    project_id, user_id, source, source_team_id, source_program_grant_id
  )
);

create index program_access_grant_user_scope_idx
  on public.program_access_grant (user_id, program_id, role);
create index program_access_grant_team_idx
  on public.program_access_grant (source_team_id)
  where source_team_id is not null;
create index project_access_grant_user_scope_idx
  on public.project_access_grant (user_id, project_id, role);
create index project_access_grant_program_source_idx
  on public.project_access_grant (source_program_grant_id)
  where source_program_grant_id is not null;
create index project_access_grant_team_idx
  on public.project_access_grant (source_team_id)
  where source_team_id is not null;

alter table public.scoped_access_backfill_issue enable row level security;
alter table public.program_access_grant enable row level security;
alter table public.project_access_grant enable row level security;

create policy scoped_access_backfill_issue_admin_read
  on public.scoped_access_backfill_issue for select to authenticated
  using (app.is_org_admin(organization_id));

create policy program_access_grant_admin_read
  on public.program_access_grant for select to authenticated
  using (app.is_org_admin(organization_id));
create policy program_access_grant_admin_insert
  on public.program_access_grant for insert to authenticated
  with check (app.is_org_admin(organization_id));
create policy program_access_grant_admin_delete
  on public.program_access_grant for delete to authenticated
  using (
    app.is_org_admin(organization_id)
    and source in ('direct', 'team')
  );

create policy project_access_grant_admin_read
  on public.project_access_grant for select to authenticated
  using (app.is_org_admin(organization_id));
create policy project_access_grant_admin_insert
  on public.project_access_grant for insert to authenticated
  with check (app.is_org_admin(organization_id));
create policy project_access_grant_admin_delete
  on public.project_access_grant for delete to authenticated
  using (
    app.is_org_admin(organization_id)
    and source in ('direct', 'team')
  );

revoke all on table public.scoped_access_backfill_issue from anon, authenticated;
revoke all on table public.program_access_grant from anon, authenticated;
revoke all on table public.project_access_grant from anon, authenticated;
grant select on table public.scoped_access_backfill_issue to authenticated;
grant select, insert, delete on table public.program_access_grant to authenticated;
grant select, insert, delete on table public.project_access_grant to authenticated;
grant all on table public.scoped_access_backfill_issue to service_role;
grant all on table public.program_access_grant to service_role;
grant all on table public.project_access_grant to service_role;

create or replace function app.map_legacy_program_role(p_role text)
returns public.program_access_role
language sql immutable
set search_path = ''
as $$
  select case lower(coalesce(trim(p_role), ''))
    when 'lead' then 'lead'::public.program_access_role
    when 'manager' then 'manager'::public.program_access_role
    when 'contributor' then 'contributor'::public.program_access_role
    when 'member' then 'contributor'::public.program_access_role
    when 'reviewer' then 'reviewer'::public.program_access_role
    when 'follower' then 'follower'::public.program_access_role
    when 'read_only' then 'read_only'::public.program_access_role
    when 'readonly' then 'read_only'::public.program_access_role
    when 'guest' then 'read_only'::public.program_access_role
    else 'read_only'::public.program_access_role
  end;
$$;

create or replace function app.map_legacy_project_role(p_role text)
returns public.project_access_role
language sql immutable
set search_path = ''
as $$
  select case lower(coalesce(trim(p_role), ''))
    when 'project_manager' then 'project_manager'::public.project_access_role
    when 'manager' then 'project_manager'::public.project_access_role
    when 'owner' then 'project_manager'::public.project_access_role
    when 'contributor' then 'contributor'::public.project_access_role
    when 'member' then 'contributor'::public.project_access_role
    when 'reviewer' then 'reviewer'::public.project_access_role
    when 'approver' then 'approver'::public.project_access_role
    when 'follower' then 'follower'::public.project_access_role
    when 'read_only' then 'read_only'::public.project_access_role
    when 'readonly' then 'read_only'::public.project_access_role
    when 'guest' then 'read_only'::public.project_access_role
    else 'read_only'::public.project_access_role
  end;
$$;

create or replace function app.project_role_for_program_role(
  p_role public.program_access_role
)
returns public.project_access_role
language sql immutable
set search_path = ''
as $$
  select case p_role
    when 'lead' then 'project_manager'::public.project_access_role
    when 'manager' then 'project_manager'::public.project_access_role
    when 'contributor' then 'contributor'::public.project_access_role
    when 'reviewer' then 'reviewer'::public.project_access_role
    when 'follower' then 'follower'::public.project_access_role
    when 'read_only' then 'read_only'::public.project_access_role
  end;
$$;

create or replace function app.program_role_has_capability(
  p_role public.program_access_role,
  p_capability text
)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case lower(coalesce(p_capability, ''))
    when 'read' then true
    when 'manage' then p_role in ('lead', 'manager')
    when 'collaborate' then p_role in ('lead', 'manager', 'contributor')
    when 'review' then p_role in ('lead', 'manager', 'reviewer')
    when 'approve' then p_role in ('lead', 'manager')
    when 'follow' then true
    else false
  end;
$$;

create or replace function app.project_role_has_capability(
  p_role public.project_access_role,
  p_capability text
)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case lower(coalesce(p_capability, ''))
    when 'read' then true
    when 'manage' then p_role = 'project_manager'
    when 'collaborate' then p_role in ('project_manager', 'contributor')
    when 'review' then p_role in ('project_manager', 'reviewer', 'approver')
    when 'approve' then p_role in ('project_manager', 'approver')
    when 'follow' then true
    else false
  end;
$$;

create or replace function app.validate_program_access_grant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_program public.program;
begin
  select * into v_program from public.program where id = new.program_id;
  if not found or v_program.organization_id <> new.organization_id then
    raise exception 'Program access grant must use the program organization'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id
      and m.user_id = new.user_id and m.status = 'active'
  ) then
    raise exception 'Program access target must be an active organization member'
      using errcode = '23514';
  end if;

  if current_user = 'authenticated'
    and new.source not in ('direct', 'team') then
    raise exception 'Generated grant sources cannot be written directly'
      using errcode = '42501';
  end if;

  if current_user = 'authenticated'
    and new.created_by is distinct from auth.uid() then
    raise exception 'Program access grant creator must be the authenticated administrator'
      using errcode = '42501';
  end if;

  if new.source = 'team' and not exists (
    select 1 from public.team t
    join public.team_member tm on tm.team_id = t.id and tm.user_id = new.user_id
    where t.id = new.source_team_id
      and t.organization_id = new.organization_id
  ) then
    raise exception 'Team access source must be a same-organization team membership'
      using errcode = '23514';
  end if;

  if new.source = 'record_lead'
    and (v_program.lead_id is distinct from new.user_id or new.role <> 'lead') then
    raise exception 'Record-lead grants must match the current program lead'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function app.validate_project_access_grant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_project public.project;
  v_source public.program_access_grant;
begin
  select * into v_project from public.project where id = new.project_id;
  if not found or v_project.organization_id <> new.organization_id then
    raise exception 'Project access grant must use the project organization'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id
      and m.user_id = new.user_id and m.status = 'active'
  ) then
    raise exception 'Project access target must be an active organization member'
      using errcode = '23514';
  end if;

  if current_user = 'authenticated'
    and new.source not in ('direct', 'team') then
    raise exception 'Generated grant sources cannot be written directly'
      using errcode = '42501';
  end if;

  if current_user = 'authenticated'
    and new.created_by is distinct from auth.uid() then
    raise exception 'Project access grant creator must be the authenticated administrator'
      using errcode = '42501';
  end if;

  if new.source = 'team' and not exists (
    select 1 from public.team t
    join public.team_member tm on tm.team_id = t.id and tm.user_id = new.user_id
    where t.id = new.source_team_id
      and t.organization_id = new.organization_id
  ) then
    raise exception 'Team access source must be a same-organization team membership'
      using errcode = '23514';
  end if;

  if new.source = 'program_inherited' then
    select * into v_source
    from public.program_access_grant
    where id = new.source_program_grant_id;
    if not found
      or v_project.program_id is null
      or v_source.program_id <> v_project.program_id
      or v_source.organization_id <> new.organization_id
      or v_source.user_id <> new.user_id
      or new.role <> app.project_role_for_program_role(v_source.role) then
      raise exception 'Inherited project grant must match its program grant and role'
        using errcode = '23514';
    end if;
  end if;

  if new.source = 'record_owner'
    and (v_project.owner_id is distinct from new.user_id or new.role <> 'project_manager') then
    raise exception 'Record-owner grants must match the current project owner'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger validate_program_access_grant
before insert or update on public.program_access_grant
for each row execute function app.validate_program_access_grant();

create trigger validate_project_access_grant
before insert or update on public.project_access_grant
for each row execute function app.validate_project_access_grant();

create or replace function app.sync_project_inherited_access_from_program_grant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    delete from public.project_access_grant
    where source = 'program_inherited' and source_program_grant_id = old.id;
  end if;

  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source,
    source_program_grant_id, created_by
  )
  select p.organization_id, p.id, new.user_id,
    app.project_role_for_program_role(new.role),
    'program_inherited', new.id, new.created_by
  from public.project p
  where p.program_id = new.program_id
    and p.organization_id = new.organization_id;

  return new;
end;
$$;

create trigger sync_project_inherited_access_from_program_grant
after insert or update on public.program_access_grant
for each row execute function app.sync_project_inherited_access_from_program_grant();

create or replace function app.sync_project_program_access_grants()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.project_access_grant
  where project_id = new.id and source = 'program_inherited';

  if new.program_id is not null then
    insert into public.project_access_grant (
      organization_id, project_id, user_id, role, source,
      source_program_grant_id, created_by
    )
    select new.organization_id, new.id, g.user_id,
      app.project_role_for_program_role(g.role),
      'program_inherited', g.id, g.created_by
    from public.program_access_grant g
    where g.program_id = new.program_id
      and g.organization_id = new.organization_id;
  end if;

  return new;
end;
$$;

create trigger sync_project_program_access_grants
after insert or update of program_id, organization_id on public.project
for each row execute function app.sync_project_program_access_grants();

create or replace function app.sync_program_lead_access_grant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.program_access_grant
  where program_id = new.id and source = 'record_lead';

  if new.lead_id is not null and exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id
      and m.user_id = new.lead_id and m.status = 'active'
  ) then
    insert into public.program_access_grant (
      organization_id, program_id, user_id, role, source, created_by
    ) values (
      new.organization_id, new.id, new.lead_id, 'lead', 'record_lead', new.created_by
    );
  elsif new.lead_id is not null then
    insert into public.scoped_access_backfill_issue (
      organization_id, scope_type, scope_id, user_id, reason
    ) values (
      new.organization_id, 'program', new.id, new.lead_id,
      'record lead is not an active member of the program organization'
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger sync_program_lead_access_grant
after insert or update of lead_id, organization_id on public.program
for each row execute function app.sync_program_lead_access_grant();

create or replace function app.sync_project_owner_access_grant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.project_access_grant
  where project_id = new.id and source = 'record_owner';

  if new.owner_id is not null and exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id
      and m.user_id = new.owner_id and m.status = 'active'
  ) then
    insert into public.project_access_grant (
      organization_id, project_id, user_id, role, source, created_by
    ) values (
      new.organization_id, new.id, new.owner_id,
      'project_manager', 'record_owner', new.created_by
    );
  elsif new.owner_id is not null then
    insert into public.scoped_access_backfill_issue (
      organization_id, scope_type, scope_id, user_id, reason
    ) values (
      new.organization_id, 'project', new.id, new.owner_id,
      'record owner is not an active member of the project organization'
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger sync_project_owner_access_grant
after insert or update of owner_id, organization_id on public.project
for each row execute function app.sync_project_owner_access_grant();

-- Preserve legacy membership rows unchanged while creating a typed,
-- source-specific access projection. Unknown legacy labels are deliberately
-- non-escalating and are recorded for administrator review.
insert into public.scoped_access_backfill_issue (
  organization_id, scope_type, scope_id, user_id, legacy_role, reason
)
select p.organization_id, 'program', pm.program_id, pm.user_id, pm.role,
  case
    when om.user_id is null then 'legacy membership target is not an active member of the program organization'
    else 'unrecognized legacy role mapped to read_only'
  end
from public.program_membership pm
join public.program p on p.id = pm.program_id
left join public.organization_membership om
  on om.organization_id = p.organization_id
 and om.user_id = pm.user_id and om.status = 'active'
where om.user_id is null
   or lower(coalesce(trim(pm.role), '')) not in (
     'lead', 'manager', 'contributor', 'member', 'reviewer', 'follower',
     'read_only', 'readonly', 'guest'
   )
on conflict do nothing;

insert into public.program_access_grant (
  organization_id, program_id, user_id, role, source, legacy_role
)
select p.organization_id, pm.program_id, pm.user_id,
  app.map_legacy_program_role(pm.role), 'legacy_membership', pm.role
from public.program_membership pm
join public.program p on p.id = pm.program_id
join public.organization_membership om
  on om.organization_id = p.organization_id
 and om.user_id = pm.user_id and om.status = 'active'
on conflict do nothing;

insert into public.scoped_access_backfill_issue (
  organization_id, scope_type, scope_id, user_id, legacy_role, reason
)
select p.organization_id, 'project', pm.project_id, pm.user_id, pm.role,
  case
    when om.user_id is null then 'legacy membership target is not an active member of the project organization'
    else 'unrecognized legacy role mapped to read_only'
  end
from public.project_membership pm
join public.project p on p.id = pm.project_id
left join public.organization_membership om
  on om.organization_id = p.organization_id
 and om.user_id = pm.user_id and om.status = 'active'
where om.user_id is null
   or lower(coalesce(trim(pm.role), '')) not in (
     'project_manager', 'manager', 'owner', 'contributor', 'member',
     'reviewer', 'approver', 'follower', 'read_only', 'readonly', 'guest'
   )
on conflict do nothing;

insert into public.project_access_grant (
  organization_id, project_id, user_id, role, source, legacy_role
)
select p.organization_id, pm.project_id, pm.user_id,
  app.map_legacy_project_role(pm.role), 'legacy_membership', pm.role
from public.project_membership pm
join public.project p on p.id = pm.project_id
join public.organization_membership om
  on om.organization_id = p.organization_id
 and om.user_id = pm.user_id and om.status = 'active'
on conflict do nothing;

-- Existing owner and lead columns are independent access sources.
insert into public.program_access_grant (
  organization_id, program_id, user_id, role, source, created_by
)
select p.organization_id, p.id, p.lead_id, 'lead', 'record_lead', p.created_by
from public.program p
join public.organization_membership om
  on om.organization_id = p.organization_id
 and om.user_id = p.lead_id and om.status = 'active'
where p.lead_id is not null
on conflict do nothing;

insert into public.project_access_grant (
  organization_id, project_id, user_id, role, source, created_by
)
select p.organization_id, p.id, p.owner_id,
  'project_manager', 'record_owner', p.created_by
from public.project p
join public.organization_membership om
  on om.organization_id = p.organization_id
 and om.user_id = p.owner_id and om.status = 'active'
where p.owner_id is not null
on conflict do nothing;

create or replace function app.has_program_capability(
  p_program uuid,
  p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.program p
    join public.organization_membership m
      on m.organization_id = p.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where p.id = p_program
      and lower(coalesce(p_capability, '')) in (
        'read', 'manage', 'collaborate', 'review', 'approve', 'follow'
      )
      and not (
        m.role in ('owner', 'admin')
        and lower(p_capability) <> 'read'
        and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2'
      )
      and not (
        m.role = 'leadership_viewer'
        and lower(p_capability) <> 'read'
      )
      and (
        (
          m.role in ('owner', 'admin')
          and (
            lower(p_capability) = 'read'
            or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
          )
        )
        or (m.role = 'leadership_viewer' and lower(p_capability) = 'read')
        or p.lead_id = (select auth.uid())
           and app.program_role_has_capability('lead', p_capability)
        or exists (
          select 1 from public.program_access_grant g
          where g.program_id = p.id
            and g.organization_id = p.organization_id
            and g.user_id = (select auth.uid())
            and app.program_role_has_capability(g.role, p_capability)
        )
      )
  );
$$;

create or replace function app.has_project_capability(
  p_project uuid,
  p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.project p
    join public.organization_membership m
      on m.organization_id = p.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where p.id = p_project
      and lower(coalesce(p_capability, '')) in (
        'read', 'manage', 'collaborate', 'review', 'approve', 'follow'
      )
      and not (
        m.role in ('owner', 'admin')
        and lower(p_capability) <> 'read'
        and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2'
      )
      and not (
        m.role = 'leadership_viewer'
        and lower(p_capability) <> 'read'
      )
      and (
        (
          m.role in ('owner', 'admin')
          and (
            lower(p_capability) = 'read'
            or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
          )
        )
        or (m.role = 'leadership_viewer' and lower(p_capability) = 'read')
        or p.owner_id = (select auth.uid())
           and app.project_role_has_capability('project_manager', p_capability)
        or exists (
          select 1 from public.project_access_grant g
          where g.project_id = p.id
            and g.organization_id = p.organization_id
            and g.user_id = (select auth.uid())
            and app.project_role_has_capability(g.role, p_capability)
        )
        or exists (
          select 1 from public.program_access_grant g
          where p.program_id is not null
            and g.program_id = p.program_id
            and g.organization_id = p.organization_id
            and g.user_id = (select auth.uid())
            and app.project_role_has_capability(
              app.project_role_for_program_role(g.role), p_capability
            )
        )
      )
  );
$$;

-- Supabase RPC exposes the public schema. These invoker wrappers provide the
-- callable surface while the privileged table reads stay inside the locked
-- app-schema predicates above.
create or replace function public.has_program_capability(
  p_program uuid,
  p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.has_program_capability(p_program, p_capability);
$$;

create or replace function public.has_project_capability(
  p_project uuid,
  p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.has_project_capability(p_project, p_capability);
$$;

revoke all on function app.map_legacy_program_role(text) from public;
revoke all on function app.map_legacy_project_role(text) from public;
revoke all on function app.project_role_for_program_role(public.program_access_role) from public;
revoke all on function app.program_role_has_capability(public.program_access_role, text) from public;
revoke all on function app.project_role_has_capability(public.project_access_role, text) from public;
revoke all on function app.validate_program_access_grant() from public;
revoke all on function app.validate_project_access_grant() from public;
revoke all on function app.sync_project_inherited_access_from_program_grant() from public;
revoke all on function app.sync_project_program_access_grants() from public;
revoke all on function app.sync_program_lead_access_grant() from public;
revoke all on function app.sync_project_owner_access_grant() from public;
revoke all on function app.has_program_capability(uuid, text) from public, anon, authenticated;
revoke all on function app.has_project_capability(uuid, text) from public, anon, authenticated;
revoke all on function public.has_program_capability(uuid, text) from public;
revoke all on function public.has_project_capability(uuid, text) from public;

grant execute on function app.has_program_capability(uuid, text)
  to service_role;
grant execute on function app.has_project_capability(uuid, text)
  to service_role;
grant execute on function public.has_program_capability(uuid, text)
  to authenticated, service_role;
grant execute on function public.has_project_capability(uuid, text)
  to authenticated, service_role;

comment on table public.program_access_grant is
  'Preparation-stage per-source program access grants; legacy RLS does not consume these yet.';
comment on table public.project_access_grant is
  'Preparation-stage per-source project access grants; legacy RLS does not consume these yet.';
comment on function app.has_program_capability(uuid, text) is
  'Preparation-stage capability predicate. Supported: read, manage, collaborate, review, approve, follow.';
comment on function app.has_project_capability(uuid, text) is
  'Preparation-stage capability predicate. Supported: read, manage, collaborate, review, approve, follow.';
comment on function public.has_program_capability(uuid, text) is
  'Least-privilege RPC wrapper for app.has_program_capability.';
comment on function public.has_project_capability(uuid, text) is
  'Least-privilege RPC wrapper for app.has_project_capability.';
