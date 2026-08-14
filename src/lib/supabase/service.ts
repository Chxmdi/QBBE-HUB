import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for scheduled jobs only. Never import this from a
 * user-facing server action or RSC — RLS is the authorization boundary for
 * those paths (AUTH-003). Jobs authenticate with CRON_JOB_SECRET instead.
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Service-role Supabase client is not configured.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
