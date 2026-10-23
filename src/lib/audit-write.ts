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
 * Records one of the signed-in person's own actions in the audit trail, and
 * says whether it was stored.
 *
 * Members cannot write audit rows themselves: the database's
 * record_audit_event takes the actor from the session and the time from the
 * clock, checks the organization against the person's membership and accepts
 * only the kinds of event the app records. `actor_id` and `actor_type` are
 * therefore not sent; server code writing a system entry uses
 * recordServerAudit.
 *
 * An export of personal or financial data is only allowed if the record of
 * who took it is stored too; an unchecked insert used to hand the file over
 * even when the audit write failed, leaving no trace of the export.
 */
export async function recordAudit(client: SupabaseClient, row: AuditRow): Promise<boolean> {
  return (await recordAuditId(client, row)) !== null;
}

/** recordAudit, giving back the stored entry's id (null if it was not stored). */
export async function recordAuditId(client: SupabaseClient, row: AuditRow): Promise<string | null> {
  const { data, error } = await client.rpc("record_audit_event", {
    p_organization_id: row.organization_id,
    p_event_type: row.event_type,
    p_action: row.action,
    p_object_type: row.object_type ?? null,
    p_object_id: row.object_id ?? null,
    p_metadata: row.metadata ?? {},
  });
  if (error || !data) {
    logActionFailure(`audit.${row.action}`, error ?? new Error("no entry id returned"), { event_type: row.event_type });
    return null;
  }
  return data as string;
}

/**
 * Writes one audit row with the service client (server code only: system
 * entries and entries written for a person by a server-side step), and says
 * whether it was stored.
 */
export async function recordServerAudit(service: SupabaseClient, row: AuditRow): Promise<boolean> {
  const { error } = await service.from("audit_event").insert(row);
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
