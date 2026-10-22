import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The integration connections, minus those whose owner is no longer an
 * active member of the connection's organization (connections with no owner
 * are left for the caller to handle). Deactivation disconnects a member's
 * connections (a database trigger); this keeps a sync job from using one
 * that slipped through, for example while a deactivation is in flight.
 */
export async function withActiveOwners<T extends { organization_id: string; user_id: string | null }>(
  db: SupabaseClient,
  connections: T[],
): Promise<T[]> {
  const owned = connections.filter((connection) => connection.user_id);
  if (!owned.length) return connections;
  const { data, error } = await db
    .from("organization_membership")
    .select("organization_id, user_id")
    .eq("status", "active")
    .in("user_id", [...new Set(owned.map((connection) => connection.user_id as string))]);
  if (error) throw new Error(`could not check connection owners: ${error.message}`);
  const active = new Set(
    ((data ?? []) as { organization_id: string; user_id: string }[]).map((row) => `${row.organization_id}:${row.user_id}`),
  );
  return connections.filter(
    (connection) => !connection.user_id || active.has(`${connection.organization_id}:${connection.user_id}`),
  );
}
