"use server";

import { revalidatePath } from "next/cache";
import { authorizeAdminAction } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { logActionFailure } from "@/lib/server-log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type RequeueResult = { ok: true; count: number } | { ok: false; error: string };

/**
 * Puts the organization's email that failed in the last seven days back in
 * the queue, for after a provider outage outlasted the automatic retries.
 * The database function checks the administrator again, picks only failed
 * email (never bounced or suppressed), and records it in the audit log.
 */
export async function requeueFailedEmails(): Promise<RequeueResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("requeue_failed_email_deliveries", {
    p_organization: authorization.session.organizationId,
  });
  if (error) {
    logActionFailure("jobs.requeue_failed_emails", error);
    return { ok: false, error: (await getT())("jobs.requeue.failed") };
  }
  revalidatePath("/admin/jobs");
  return { ok: true, count: typeof data === "number" ? data : 0 };
}
