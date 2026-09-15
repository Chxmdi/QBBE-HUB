-- Owner and administrator privileges require a second factor. An AAL1 admin
-- session retains ordinary read access so it can reach the TOTP challenge,
-- while admin and staff-level write helpers require AAL2 for that account.
-- Ordinary staff keep their existing write access. Missing `aal` claims are
-- treated as AAL1.
--
-- service_role remains explicitly accepted for server-owned maintenance. It
-- already bypasses RLS, but the explicit branch preserves internal callers
-- that invoke these helpers directly.

create or replace function app.is_org_admin(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt()->>'role', '') = 'service_role'
    or (
      coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      and auth.uid() is not null
      and exists (
        select 1
        from organization_membership m
        where m.organization_id = p_organization
          and m.user_id = auth.uid()
          and m.status = 'active'
          and m.role in ('owner', 'admin')
      )
    );
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt()->>'role', '') = 'service_role'
    or (
      coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      and auth.uid() is not null
      and exists (
        select 1
        from organization_membership m
        where m.user_id = auth.uid()
          and m.status = 'active'
          and m.role in ('owner', 'admin')
      )
    );
$$;

-- An administrator at AAL1 may retain enough read access to reach the MFA
-- flow, but cannot fall through the ordinary staff branch to mutate records.
create or replace function app.is_org_staff(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt()->>'role', '') = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1
        from organization_membership m
        where m.organization_id = p_organization
          and m.user_id = auth.uid()
          and m.status = 'active'
          and (
            m.role = 'staff'
            or (
              m.role in ('owner', 'admin')
              and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
            )
          )
      )
    );
$$;

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt()->>'role', '') = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1
        from organization_membership m
        where m.user_id = auth.uid()
          and m.status = 'active'
          and (
            m.role = 'staff'
            or (
              m.role in ('owner', 'admin')
              and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
            )
          )
      )
    );
$$;

revoke all on function app.is_org_admin(uuid) from public, anon;
revoke all on function app.is_admin() from public, anon;
revoke all on function app.is_org_staff(uuid) from public, anon;
revoke all on function app.is_staff() from public, anon;
grant execute on function app.is_org_admin(uuid) to authenticated, service_role;
grant execute on function app.is_admin() to authenticated, service_role;
grant execute on function app.is_org_staff(uuid) to authenticated, service_role;
grant execute on function app.is_staff() to authenticated, service_role;
