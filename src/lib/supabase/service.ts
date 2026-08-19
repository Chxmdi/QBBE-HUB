import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serviceRoleKey } from "@/lib/env";

/**
 * Privileged Supabase client for background work.
 *
 * Row Level Security is the authorization boundary for anything acting on
 * behalf of a signed-in person (AUTH-003), and this client deliberately
 * bypasses it. It exists for one caller: the job runner, which fans work out
 * across users and so has no single user to act as.
 *
 * Rules for using it:
 *   - only from `/api/jobs/*` handlers and the services they call;
 *   - never from a Server Component, Server Action, or anything reachable by a
 *     request the user controls;
 *   - never construct it in a module that a client component can import.
 */
export function createSupabaseServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-qbbe-actor": "job-runner" } },
    },
  );
}
