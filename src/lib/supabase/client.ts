"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Browser Supabase client (anon key; RLS enforced server-side). */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Hands the signed-in session to the Realtime socket before anything joins it.
 *
 * The browser client reads its session from cookies asynchronously, and a
 * channel that joins before that has finished joins with no access token at
 * all. Realtime then treats the socket as anonymous, row-level security drops
 * every change it would have delivered, and the page silently stops being
 * live: the join still reports "Subscribed to PostgreSQL" (#113). Await this,
 * then subscribe.
 */
export async function authorizeRealtime(client: SupabaseClient): Promise<void> {
  const { data } = await client.auth.getSession();
  await client.realtime.setAuth(data.session?.access_token ?? null);
}
