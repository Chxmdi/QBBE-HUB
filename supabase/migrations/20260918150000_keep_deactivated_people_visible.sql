-- Deactivation must end access without erasing the person from the record.
--
-- app.can_read_profile required the subject's membership to be active, so the
-- moment somebody was deactivated their profile became unreadable to everyone,
-- including the administrator who had just deactivated them. Two consequences,
-- both of which the administration page shows plainly:
--
--   1. The member row disappears from the Members list entirely, because that
--      list drops rows whose profile join came back empty. The Reactivate
--      button lives in that row, so a deactivation could not be undone through
--      the product at all.
--   2. Anywhere a name is read through user_profile — task history, authorship,
--      the record of who decided what — the person stops being named, which is
--      the opposite of preserving attribution.
--
-- The reader still has to be an active member of a shared organization. That is
-- the check that matters: it decides who may look. Whether the person being
-- looked at is still active decides nothing about that, and a profile that was
-- visible to every colleague yesterday is not made private by their account
-- being closed today. Removing someone's data, as opposed to their access, is
-- erasure, and that is a separate deliberate act (docs/runbooks/privacy.md).

create or replace function app.can_read_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null and exists (
    select 1
    from organization_membership self_membership
    join organization_membership peer_membership
      on peer_membership.organization_id = self_membership.organization_id
    where self_membership.user_id = auth.uid()
      and self_membership.status = 'active'
      and peer_membership.user_id = p_user
  );
$$;
