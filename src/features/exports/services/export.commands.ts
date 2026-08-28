"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { requestExportSchema } from "@/features/exports/schemas";

/**
 * Asking for an export.
 *
 * The row is all this does. Building it is the `run-exports` job's work, which
 * is the point: an export of everything cannot finish inside a request, and a
 * spinner that dies at the gateway timeout is worse than no button.
 *
 * Who may ask for what is decided by `export_job_request`, not here — a
 * volunteer's insert simply fails. The rate limit is separate and is about
 * volume: an export is expensive to build and is a copy of sensitive data, so
 * a loop that queues hundreds is worth stopping even when every one of them
 * would be allowed.
 */
export async function requestExport(input: unknown): Promise<ActionResult> {
  const session = await requireSession();

  const limited = await enforceRateLimit("export:request", session.userId);
  if (limited) return limited;

  const parsed = requestExportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { kind, subjectUserId } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase
    .from("export_job")
    .insert({
      organization_id: session.organizationId,
      kind,
      subject_user_id: subjectUserId ?? null,
      requested_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !created) {
    return {
      ok: false,
      error: "You don't have permission to request that export.",
    };
  }

  // An export is a copy of sensitive data leaving the safety of row-level
  // security, so it is an audit event whether or not it is ever downloaded.
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "data_export",
    action: "export_requested",
    object_type: "export_job",
    object_id: created.id,
    metadata: { kind, subject_user_id: subjectUserId ?? null },
  });

  revalidatePath("/admin");
  return { ok: true, id: created.id as string };
}
