-- Core identity policies must be scoped to the row's organization. The legacy
-- global membership predicates were safe only for a single-organization
-- deployment and could expose another organization's directory and teams.
create or replace function app.is_org_member(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from organization_membership m
    where m.organization_id = p_organization
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function app.is_org_admin(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from organization_membership m
    where m.organization_id = p_organization
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function app.can_read_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from team t
    where t.id = p_team and app.is_org_member(t.organization_id)
  );
$$;

create or replace function app.can_manage_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from team t
    where t.id = p_team and app.is_org_admin(t.organization_id)
  );
$$;

create or replace function app.can_read_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from organization_membership self_membership
    join organization_membership peer_membership
      on peer_membership.organization_id = self_membership.organization_id
    where self_membership.user_id = auth.uid()
      and self_membership.status = 'active'
      and peer_membership.user_id = p_user
      and peer_membership.status = 'active'
  );
$$;

revoke all on function app.is_org_member(uuid) from public;
revoke all on function app.is_org_admin(uuid) from public;
revoke all on function app.can_read_team(uuid) from public;
revoke all on function app.can_manage_team(uuid) from public;
revoke all on function app.can_read_profile(uuid) from public;
grant execute on function app.is_org_member(uuid) to authenticated;
grant execute on function app.is_org_admin(uuid) to authenticated;
grant execute on function app.can_read_team(uuid) to authenticated;
grant execute on function app.can_manage_team(uuid) to authenticated;
grant execute on function app.can_read_profile(uuid) to authenticated;

drop policy if exists org_read on organization;
create policy org_read on organization for select to authenticated
  using (app.is_org_member(id));
drop policy if exists org_admin_update on organization;
create policy org_admin_update on organization for update to authenticated
  using (app.is_org_admin(id))
  with check (app.is_org_admin(id));

drop policy if exists profile_read on user_profile;
create policy profile_read on user_profile for select to authenticated
  using (id = auth.uid() or app.can_read_profile(id));

drop policy if exists membership_read on organization_membership;
create policy membership_read on organization_membership for select to authenticated
  using (app.is_org_member(organization_id));
drop policy if exists membership_admin_write on organization_membership;
create policy membership_admin_write on organization_membership for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

drop policy if exists invitation_admin on invitation;
create policy invitation_admin on invitation for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

drop policy if exists team_read on team;
create policy team_read on team for select to authenticated
  using (app.is_org_member(organization_id));
drop policy if exists team_admin_write on team;
create policy team_admin_write on team for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

drop policy if exists team_member_read on team_member;
create policy team_member_read on team_member for select to authenticated
  using (app.can_read_team(team_id));
drop policy if exists team_member_admin_write on team_member;
create policy team_member_admin_write on team_member for all to authenticated
  using (app.can_manage_team(team_id))
  with check (app.can_manage_team(team_id));
