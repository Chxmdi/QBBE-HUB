-- A verified AAL2 JWT can remain valid briefly after its final factor is
-- removed. Requiring a live verified TOTP row closes that stale-token window
-- for every database policy and privileged RPC that delegates to these
-- helpers. Ordinary staff and service-role maintenance retain their existing
-- behavior.

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
        from auth.mfa_factors f
        where f.user_id = auth.uid()
          and f.factor_type = 'totp'
          and f.status = 'verified'
      )
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
        from auth.mfa_factors f
        where f.user_id = auth.uid()
          and f.factor_type = 'totp'
          and f.status = 'verified'
      )
      and exists (
        select 1
        from organization_membership m
        where m.user_id = auth.uid()
          and m.status = 'active'
          and m.role in ('owner', 'admin')
      )
    );
$$;

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
              and exists (
                select 1
                from auth.mfa_factors f
                where f.user_id = auth.uid()
                  and f.factor_type = 'totp'
                  and f.status = 'verified'
              )
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
              and exists (
                select 1
                from auth.mfa_factors f
                where f.user_id = auth.uid()
                  and f.factor_type = 'totp'
                  and f.status = 'verified'
              )
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
