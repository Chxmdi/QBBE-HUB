import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ObjectLockView {
  lockedByName: string | null;
  lockedAt: string;
  reason: string | null;
}

/** The object's lock, or null when it is not locked (or the reader cannot see it). */
export async function getObjectLock(objectId: string): Promise<ObjectLockView | null> {
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("object_lock")
    .select("locked_at, reason, user_profile:locked_by(full_name)")
    .eq("object_id", objectId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    locked_at: string;
    reason: string | null;
    user_profile: { full_name: string } | null;
  };
  return { lockedByName: row.user_profile?.full_name ?? null, lockedAt: row.locked_at, reason: row.reason };
}
