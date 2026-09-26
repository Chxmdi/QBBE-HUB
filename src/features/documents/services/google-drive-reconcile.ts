import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchGoogleDriveSync,
  type GoogleDriveSync,
} from "@/features/inbox/services/gmail-sync";

export interface DriveConnectionRef {
  id: string;
  organization_id: string;
  user_id: string;
}

export interface DriveReconcileResult {
  mode: "incremental" | "full";
  upserted: number;
  removed: number;
  pageToken: string;
}

function driveDocumentRows(
  connection: DriveConnectionRef,
  sync: GoogleDriveSync,
) {
  return sync.rows.map((row) => ({
    organization_id: connection.organization_id,
    title: row.title,
    description: row.description,
    kind: "link",
    url: row.url,
    mime_type: row.mime_type,
    // Imported Drive metadata belongs to the connected account until somebody
    // deliberately attaches a QBBE-owned link to broader product context.
    // "private" falls through can_read_document to owner/creator/admin paths;
    // it never grants organization-wide access just because Google returned it.
    visibility: "private",
    owner_id: connection.user_id,
    created_by: connection.user_id,
    integration_connection_id: connection.id,
    external_id: row.external_id,
    external_updated_at: row.updated_at,
  }));
}

async function upsertDriveRows(
  db: SupabaseClient,
  connection: DriveConnectionRef,
  sync: GoogleDriveSync,
): Promise<number> {
  const rows = driveDocumentRows(connection, sync);
  if (!rows.length) return 0;
  const { error } = await db
    .from("document")
    .upsert(rows, { onConflict: "integration_connection_id,external_id" });
  if (error) throw new Error(`Could not save Google Drive metadata: ${error.message}`);
  return rows.length;
}

async function deleteDriveIds(
  db: SupabaseClient,
  connectionId: string,
  externalIds: string[],
): Promise<number> {
  if (!externalIds.length) return 0;
  const { error } = await db
    .from("document")
    .delete()
    .eq("integration_connection_id", connectionId)
    .in("external_id", externalIds);
  if (error) throw new Error(`Could not remove stale Google Drive metadata: ${error.message}`);
  return externalIds.length;
}

async function saveCursor(
  db: SupabaseClient,
  connectionId: string,
  pageToken: string,
) {
  const { error } = await db
    .from("integration_secret")
    .update({ google_drive_page_token: pageToken })
    .eq("connection_id", connectionId);
  if (error) throw new Error(`Could not save Google Drive page token: ${error.message}`);
}

/**
 * Applies a complete Drive snapshot without deleting the last known good mirror
 * first. Provider reads and row upserts succeed before stale local rows are
 * pruned, so a transient database/provider fault cannot turn the library empty.
 */
async function applyFullSnapshot(
  db: SupabaseClient,
  connection: DriveConnectionRef,
  sync: GoogleDriveSync,
): Promise<DriveReconcileResult> {
  const { data: existing, error: existingError } = await db
    .from("document")
    .select("external_id")
    .eq("integration_connection_id", connection.id);
  if (existingError) {
    throw new Error(`Could not load existing Google Drive metadata: ${existingError.message}`);
  }

  const upserted = await upsertDriveRows(db, connection, sync);
  const currentIds = new Set(sync.rows.map((row) => row.external_id));
  const staleIds = (existing ?? [])
    .map((row) => row.external_id as string | null)
    .filter((id): id is string => !!id && !currentIds.has(id));
  const removed = await deleteDriveIds(db, connection.id, staleIds);
  await saveCursor(db, connection.id, sync.pageToken);
  return { mode: "full", upserted, removed, pageToken: sync.pageToken };
}

/**
 * Reconciles a connected user's Drive metadata. The provider is read-only:
 * QBBE never copies bytes or changes Google permissions.
 */
export async function reconcileGoogleDrive(
  db: SupabaseClient,
  connection: DriveConnectionRef,
  accessToken: string,
  savedPageToken?: string,
): Promise<DriveReconcileResult> {
  if (!savedPageToken) {
    return applyFullSnapshot(
      db,
      connection,
      await fetchGoogleDriveSync(accessToken),
    );
  }

  try {
    const sync = await fetchGoogleDriveSync(accessToken, savedPageToken);
    const upserted = await upsertDriveRows(db, connection, sync);
    const removed = await deleteDriveIds(db, connection.id, sync.removedIds);
    await saveCursor(db, connection.id, sync.pageToken);
    return { mode: "incremental", upserted, removed, pageToken: sync.pageToken };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Google Drive synchronization failed.";
    if (!message.includes("full synchronization is required")) throw cause;
    return applyFullSnapshot(
      db,
      connection,
      await fetchGoogleDriveSync(accessToken),
    );
  }
}
