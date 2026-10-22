import type { SupabaseClient } from "@supabase/supabase-js";
import { getT } from "@/lib/i18n/server";
import { logActionFailure } from "@/lib/server-log";

export type AuditRow = {
  organization_id: string | null;
  actor_id: string | null;
  event_type: string;
  action: string;
  object_type?: string | null;
  object_id?: string | null;
  metadata?: Record<string, unknown>;
  actor_type?: string;
  result?: string;
};

/**
 * Writes one audit row and says whether it was stored.
 *
 * An export of personal or financial data is only allowed if the record of
 * who took it is stored too; an unchecked insert used to hand the file over
 * even when the audit write failed, leaving no trace of the export.
 */
export async function recordAudit(client: SupabaseClient, row: AuditRow): Promise<boolean> {
  const { error } = await client.from("audit_event").insert(row);
  if (error) {
    logActionFailure(`audit.${row.action}`, error, { event_type: row.event_type });
    return false;
  }
  return true;
}

/**
 * The refusal an export route returns when its audit row could not be
 * written: no file (503, try again), and a message that says why in the person's language.
 */
export async function auditUnavailableResponse(): Promise<Response> {
  const t = await getT();
  return new Response(t("errors.auditUnavailable"), {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
