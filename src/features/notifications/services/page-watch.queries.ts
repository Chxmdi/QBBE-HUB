import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Whether the signed-in person watches a page (their own rows only, by RLS). */
export async function isWatchingPage(pageId: string, userId: string): Promise<boolean> {
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("page_watch")
    .select("page_id")
    .eq("page_id", pageId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && data !== null;
}
