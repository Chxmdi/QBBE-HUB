-- Workspace OS property-level privacy for the query engine (M10e, epic
-- #199, stream S2).
--
-- A custom property can be limited to some organization roles
-- (property_definition.visible_to_roles, S1's M2). S1's RLS already removes
-- the stored values of such a property (property_value_read calls
-- app.can_view_property). What that cannot cover is a query that *uses* a
-- hidden property without returning it: filtering, sorting or grouping by it
-- would reveal its values one row at a time.
--
-- This adds the one question every reader of properties asks before it
-- runs: which property keys of this type can the caller not see? The query
-- engine (S4) calls it through withPropertyPrivacy
-- (src/features/sharing/services/property-privacy.ts), which refuses a spec
-- that filters, sorts or groups by a hidden key and drops hidden keys from
-- what it returns. Public pages (V1-18) use it to never publish a private
-- property.
--
-- Same rule as app.can_view_property: visible when unrestricted, or when the
-- caller's active role in the property's organization is one of the listed
-- roles. It fails closed: someone with no active membership in the
-- property's organization is treated as seeing no restricted property.
--
-- property_definition may not exist yet on this branch (S1's M2); the
-- function checks at run time and then has nothing to hide.

create or replace function app.hidden_property_keys(p_type_key text)
returns text[]
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_keys text[];
begin
  if to_regclass('public.property_definition') is null or to_regclass('public.object_type') is null then
    return array[]::text[];
  end if;
  select coalesce(array_agg(distinct d.key order by d.key), array[]::text[])
  into v_keys
  from public.property_definition d
  join public.object_type t on t.id = d.type_id and t.organization_id = d.organization_id
  left join public.organization_membership m
    on m.organization_id = d.organization_id
   and m.user_id = (select auth.uid())
   and m.status = 'active'
  where t.key = p_type_key
    and d.visible_to_roles is not null
    and not coalesce(m.role = any (d.visible_to_roles), false)
    -- Only the caller's organizations: another organization's type with the
    -- same key is none of their business, and hiding its keys would be noise.
    and (m.user_id is not null or not exists (
      select 1 from public.organization_membership mm
      where mm.user_id = (select auth.uid()) and mm.status = 'active'));
  return v_keys;
end;
$$;

create or replace function public.hidden_property_keys(type_key text)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select app.hidden_property_keys(type_key);
$$;

revoke all on function app.hidden_property_keys(text) from public, anon, authenticated;
revoke all on function public.hidden_property_keys(text) from public, anon;
grant execute on function app.hidden_property_keys(text) to service_role;
grant execute on function public.hidden_property_keys(text) to authenticated, service_role;

comment on function public.hidden_property_keys(text) is
  'Workspace OS (M10e): keys of this type''s properties the caller may not see. The query engine refuses to filter, sort or group by them and drops them from results.';
