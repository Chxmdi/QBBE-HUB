-- QBBE Hub — narrow two SECURITY DEFINER functions to the callers that need them.
--
-- Both arrived with the production-hardening work and both were reachable more
-- widely than intended, because PostgreSQL grants EXECUTE to PUBLIC by default
-- and Supabase's `anon` and `authenticated` roles inherit that.
--
--   clear_org_vms_ids — an administrative action. It checks app.is_admin()
--   internally, so `anon` could not have done damage, but an unauthenticated
--   role should not be able to reach an admin entry point at all.
--
--   signup_allowed — deliberately callable without signing in: the sign-up
--   screen has to ask whether registration is open before an account exists.
--   A signed-in user has no reason to call it, so `authenticated` loses it.
--   Keeping `anon` is the intended design, not an oversight.

revoke all on function public.clear_org_vms_ids() from public, anon;
grant execute on function public.clear_org_vms_ids() to authenticated;

revoke all on function public.signup_allowed(text) from public, authenticated;
grant execute on function public.signup_allowed(text) to anon;
