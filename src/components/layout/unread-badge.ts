import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The notification bell's count, kept current.
 *
 * The bell took its count once, when the page first loaded: new assignments
 * and mentions did not show until a reload, and after "Mark all read" it stayed
 * at 0 for the rest of the session. It now recounts whenever the person's
 * notifications change (Realtime delivers only their own rows, under
 * row-level security) and whenever the page's count changes.
 */

/** Unread notifications for the signed-in person, or null when the count fails. */
export async function countUnread(db: SupabaseClient): Promise<number | null> {
  const { count, error } = await db
    .from("notification")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return error ? null : (count ?? 0);
}

/** Calls onChange whenever one of the person's notifications is added, read or removed. */
export function watchNotifications(db: SupabaseClient, onChange: () => void): () => void {
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;
  let stopped = false;
  void db.auth.getSession().then(async ({ data }) => {
    await db.realtime.setAuth(data.session?.access_token ?? null);
    if (stopped) return;
    channel = db
      .channel(`notifications:${data.session?.user.id ?? "me"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notification" }, () => onChange())
      .subscribe();
  });
  return () => {
    stopped = true;
    if (channel) void db.removeChannel(channel);
  };
}
