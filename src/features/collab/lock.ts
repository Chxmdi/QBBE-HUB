import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Db = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "rpc">;

/**
 * Whether an object is locked (V1-17). Content writes in the Workspace OS
 * paths ask this first; an error reading it counts as locked, the safe side.
 */
export async function isObjectLocked(db: Db, objectId: string): Promise<boolean> {
  const { data, error } = await db.rpc("is_object_locked", { p_object: objectId });
  if (error) return true;
  return data === true;
}
