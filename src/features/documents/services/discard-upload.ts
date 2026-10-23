"use server";

import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logEvent } from "@/lib/server-log";

/**
 * Deletes an upload whose save failed or whose capture was dismissed
 * (SEC-016). Bytes nobody has registered are not readable through the
 * storage API, not even by their uploader (the scan has not seen them), and
 * a storage delete only reaches what its caller can read. So the database
 * is asked, as the signed-in person, whether the file is their own and
 * registered nowhere; only then does the server remove it.
 *
 * Never fails the caller's flow: whatever is left, the cleanup job deletes
 * a day later.
 */
export async function discardOwnUpload(path: string): Promise<void> {
  await requireSession();
  if (typeof path !== "string" || !path || path.length > 500) return;
  const supabase = await createSupabaseServerClient();
  const { data: allowed, error } = await supabase.rpc("document_upload_discardable", { p_name: path });
  if (error || allowed !== true) return;
  const { error: removeError } = await createSupabaseServiceClient().storage.from("documents").remove([path]);
  if (removeError) logEvent("storage.discard_upload_failed", { error: removeError.message }, "warn");
}
