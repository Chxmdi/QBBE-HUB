-- ---------------------------------------------------------------------------
-- Event assignments: a real role, and somebody who belongs here (#32, P0-EVT-02).
--
-- Two gaps, both measured against the database on 2026-09-23 rather than read
-- out of the code.
--
-- 1. `event_assignment.role` was plain `text not null`. The seven roles existed
--    in a SQL comment, a TypeScript const and a Zod enum — none of which
--    PostgREST consults. Inserting `'not-a-real-role-at-all'` was accepted.
--    The same shape as the #35 allowlist finding: the form knew the rule and
--    the database did not.
--
-- 2. `event_assignment_staff_write` checks `app.can_manage_event(event_id)`,
--    which asks whether **the caller** may manage the event. Nothing asked
--    anything about `user_id`, the person being assigned. A user whose only
--    membership was in a different organization was assigned to this
--    organization's event, confirmed by probe. `user_id` references
--    `user_profile`, which only requires that the person exists somewhere.
--
-- The role is a check constraint because the set is fixed and known.
--
-- The assignee is a trigger rather than a policy, for the same reason
-- `app.reject_unapproved_document_link` is: a policy binds to `authenticated`
-- and is bypassed by `service_role`, while the question "is this person even in
-- this organization" should have one answer regardless of who is asking.
--
-- Membership must be `active`. A deactivated member cannot be newly assigned —
-- but the trigger fires on insert and update only, so assignments already
-- recorded survive somebody later being deactivated, which is the same
-- principle as P0-AUTH-04: deactivation removes access without erasing the
-- record of what a person was given.
-- ---------------------------------------------------------------------------

alter table public.event_assignment
  add constraint event_assignment_role_known
  check (role in (
    'logistics', 'communications', 'volunteers', 'venue',
    'content', 'registration', 'follow_up'
  ));

comment on constraint event_assignment_role_known on public.event_assignment is
  'The seven areas an event is divided into (P0-EVT-02). Kept in step with the Zod enum in src/features/events/services/event.commands.ts and EVENT_ROLES in the event detail page.';

create or replace function app.reject_foreign_event_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select e.organization_id into v_org
    from public.event e
   where e.id = new.event_id;

  if v_org is null then
    raise exception 'Event % does not exist.', new.event_id
      using errcode = 'foreign_key_violation';
  end if;

  if not exists (
    select 1
      from public.organization_membership m
     where m.organization_id = v_org
       and m.user_id = new.user_id
       and m.status = 'active'
  ) then
    raise exception 'A person can only be assigned to an event in an organization they are an active member of.'
      using errcode = 'insufficient_privilege',
            hint = 'Invite them to this organization first, or reactivate their membership.';
  end if;

  return new;
end;
$$;

revoke all on function app.reject_foreign_event_assignee() from public, anon;

drop trigger if exists event_assignment_assignee_belongs on public.event_assignment;
create trigger event_assignment_assignee_belongs
  before insert or update of event_id, user_id on public.event_assignment
  for each row execute function app.reject_foreign_event_assignee();
