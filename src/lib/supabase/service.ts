import type { Database } from "@/types/database";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serviceRoleKey } from "@/lib/env";

/**
 * Privileged Supabase client (bypasses row-level security).
 *
 * Row Level Security is the authorization boundary for anything acting on
 * behalf of a signed-in person (AUTH-003), and this client deliberately
 * bypasses it. Every file that may use it is listed in
 * docs/adr/ADR-004-service-role-uses.md with its reason and the check that
 * stands in for RLS there (the job runner, signed webhooks, the private API,
 * a person's own integration tokens, and a few admin operations);
 * tests/unit/service-role-allowlist.test.ts fails on any other import.
 *
 * Rules for using it:
 *   - add a row to ADR-004 first, naming the check that replaces RLS;
 *   - pin every query to the caller's own user or organization, or to a
 *     signature-verified sender;
 *   - never construct it in a module that a client component can import.
 */
export function createSupabaseServiceClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-qbbe-actor": "job-runner" } },
    },
  );
}
