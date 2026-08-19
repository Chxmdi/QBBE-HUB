-- QBBE Hub — take queue metrics off the public API surface.
--
-- 0008 exposed `job_queue_health_admin` and `job_queue_dead_letters_admin` to
-- signed-in users and had each assert `app.is_admin()` itself. That works, but
-- it puts two SECURITY DEFINER functions on the internet-facing PostgREST
-- surface whose safety depends entirely on a check inside the function body —
-- which is what Supabase's linter flags, and it is right to.
--
-- Queue depth and dead letters are operational metadata with no per-row owner,
-- so RLS is the wrong instrument for them anyway. They now have no PostgREST
-- route at all: `/admin/jobs` reads them through the service role, behind the
-- same `requireAdmin()` gate that guards the page.
--
-- Row data is unchanged — `job_definition` and `job_run` are still read as the
-- signed-in administrator, with RLS deciding.

drop function if exists public.job_queue_health_admin();
drop function if exists public.job_queue_dead_letters_admin(int);

-- Belt and braces: the underlying functions were already service-role only.
revoke all on function public.job_queue_health() from public, anon, authenticated;
revoke all on function public.job_queue_dead_letters(int) from public, anon, authenticated;
