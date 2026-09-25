-- Member and profile reads answered once per query (#115).
--
-- The perf workflow's query statistics (2026-09-25, after the dashboard fix)
-- put the member list with profiles at the top of database time: about
-- 210 ms a call, on almost every page (assignee pickers, the people list).
-- Each row paid for per-row security definer calls:
--   organization_membership: membership_read -> app.is_org_member(org), and
--     membership_admin_write, a FOR ALL policy, so also app.is_org_admin(org)
--     on every read (permissive policies are OR'd and each is evaluated);
--   user_profile: profile_read -> app.can_read_profile(id), a self-join of
--     organization_membership per profile.
--
-- Who can read what does not change. The same rules are restated against
-- arrays computed once per statement, as task_read was (20260924200000).
-- supabase/tests/member-profile-read-equivalence.sql compares both tables'
-- visible rows with the original functions for every member and a stranger.

-- Everyone who shares an organization with the reader, where the reader is
-- an active member: exactly app.can_read_profile's rule (the peer's own
-- status does not matter, so deactivated people stay visible).
create or replace function app.readable_profile_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct peer.user_id), '{}')
  from public.organization_membership self_membership
  join public.organization_membership peer
    on peer.organization_id = self_membership.organization_id
  where self_membership.user_id = (select auth.uid())
    and self_membership.status = 'active';
$$;

revoke all on function app.readable_profile_ids() from public, anon;
grant execute on function app.readable_profile_ids() to authenticated, service_role;

-- membership_read: app.is_org_member(organization_id) is "the reader is an
-- active member of that organization", which is what
-- app.task_read_member_organizations() lists.
drop policy if exists membership_read on public.organization_membership;
create policy membership_read on public.organization_membership for select to authenticated
  using (organization_id = any ((select app.task_read_member_organizations())::uuid[]));

-- membership_admin_write was FOR ALL, so it also ran on every read. An
-- administrator is by definition an active member (app.is_org_admin requires
-- an active owner/admin membership), so its read branch never admitted a row
-- membership_read did not; the write branches are kept as they were.
drop policy if exists membership_admin_write on public.organization_membership;
create policy membership_admin_insert on public.organization_membership for insert to authenticated
  with check (app.is_org_admin(organization_id));
create policy membership_admin_update on public.organization_membership for update to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));
create policy membership_admin_delete on public.organization_membership for delete to authenticated
  using (app.is_org_admin(organization_id));

drop policy if exists profile_read on public.user_profile;
create policy profile_read on public.user_profile for select to authenticated
  using (
    id = (select auth.uid())
    or id = any ((select app.readable_profile_ids())::uuid[])
  );
