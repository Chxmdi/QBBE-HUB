-- QBBE Hub — tell "deactivated" apart from "the database never saw you" (#79).
--
-- `getSessionContext` reads the caller's membership and, finding nothing,
-- returns null; `requireSession` turns that null into a redirect to
-- /account-inactive, which tells the person an administrator deactivated their
-- membership.
--
-- That conclusion does not follow from the evidence. `membership_read` is
-- `app.is_org_member(organization_id)`, whose first condition is
-- `auth.uid() is not null`. A request that reaches PostgREST without a usable
-- token therefore reads zero membership rows — not because the membership is
-- inactive, but because the policy could not identify anybody. The row is
-- there and active; the reader was nobody. Both cases arrive at the
-- application as an empty result with no error, and the application picks the
-- wrong one of the two explanations.
--
-- Observed during #79 verification on 2026-09-21: `access-impact.spec.ts:5`
-- was served "This account is inactive" for qa-owner, whose membership was
-- `active` in the database before, during and after the run.
--
-- This function is the missing third answer. It asks the database who it
-- thinks is calling, under exactly the identity the failed read used, so the
-- application can distinguish:
--
--   uid is not null, no membership  -> genuinely not an active member
--   uid is null                     -> the session did not reach the database
--
-- SECURITY INVOKER on purpose. A definer function would run as the owner and
-- report the owner's identity, which is the opposite of the question. It
-- discloses nothing the caller does not already have: its own user id, which
-- the caller's own JWT already carries.
create or replace function public.current_actor_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid();
$$;

comment on function public.current_actor_id() is
  'The caller''s identity as row-level security sees it. Used to tell an inactive membership apart from a request that carried no usable session (#79).';

revoke all on function public.current_actor_id() from public, anon;
grant execute on function public.current_actor_id() to authenticated;
