"use server";

import { revalidatePath } from "next/cache";
import { authorizeAdminAction } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { logActionFailure } from "@/lib/server-log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Admin > Jobs: what an administrator can do with a blocked upload.
 *
 * The database decides (release_quarantined_file / purge_quarantined_file):
 * an owner or administrator with the second factor, of the file's own
 * organization; a release only for a heuristic verdict (a password-protected
 * file), never a virus; both audited. Storage objects cannot be deleted from
 * SQL, so after the database has recorded a deletion the bytes are removed
 * here with the service role, at the path the database returned.
 */

export type QuarantineKind = "document" | "receipt" | "form_file" | "signing_document";
type Result = { ok: true } | { ok: false; error: string };

const KINDS = new Set<string>(["document", "receipt", "form_file", "signing_document"]);

export async function releaseQuarantinedFile(input: { kind: string; id: string; reason: string }): Promise<Result> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const t = await getT();
  if (!KINDS.has(input.kind)) return { ok: false, error: t("jobs.quarantine.failed") };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("release_quarantined_file", {
    p_kind: input.kind,
    p_id: input.id,
    p_reason: input.reason,
  });
  if (error) {
    logActionFailure("quarantine.release", error, { kind: input.kind });
    return { ok: false, error: t(error.code === "22023" ? "jobs.quarantine.notReleasable" : "jobs.quarantine.failed") };
  }
  revalidatePath("/admin/jobs");
  return { ok: true };
}

export async function deleteQuarantinedFile(input: { kind: string; id: string }): Promise<Result> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const t = await getT();
  if (!KINDS.has(input.kind)) return { ok: false, error: t("jobs.quarantine.failed") };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("purge_quarantined_file", { p_kind: input.kind, p_id: input.id });
  const target = (data as { bucket: string; storage_path: string }[] | null)?.[0];
  if (error || !target) {
    logActionFailure("quarantine.purge", error, { kind: input.kind });
    return { ok: false, error: t("jobs.quarantine.failed") };
  }

  const { error: removeError } = await createSupabaseServiceClient()
    .storage.from(target.bucket)
    .remove([target.storage_path]);
  if (removeError) {
    logActionFailure("quarantine.purge_bytes", removeError, { kind: input.kind });
    return { ok: false, error: t("jobs.quarantine.bytesNotRemoved") };
  }
  revalidatePath("/admin/jobs");
  return { ok: true };
}
