"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { enforceRateLimit } from "@/lib/rate-limit";
import { buildReportSnapshot } from "@/features/reports/services/report.snapshot";

const generateSchema = z.object({
  reportType: z.enum(["program_quarterly", "project"]),
  programId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  periodStart: requiredText("Pick a period start."),
  periodEnd: requiredText("Pick a period end."),
});

/**
 * Report generation from a versioned snapshot of live data (RPT-001):
 * the snapshot is captured at generation time so approved reports remain
 * reproducible even when live records change later.
 */
export async function generateReport(input: unknown): Promise<ActionResult> {
  const session = await requireSession();

  const limited = await enforceRateLimit("report:generate", session.userId);
  if (limited) return limited;
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { reportType, programId, projectId, periodStart, periodEnd } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const built = await buildReportSnapshot(supabase, {
    reportType,
    programId,
    projectId,
    periodStart,
    periodEnd,
  });
  if (!built.ok) return { ok: false, error: built.error };
  const { title, snapshot } = built;

  const { data: report, error } = await supabase
    .from("report_instance")
    .insert({
      organization_id: session.organizationId,
      report_type: reportType,
      title,
      program_id: programId ?? null,
      project_id: projectId ?? null,
      period_start: periodStart,
      period_end: periodEnd,
      snapshot,
      generated_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !report) return { ok: false, error: "Could not save the report." };

  // Version 1. The report row keeps a copy of the latest snapshot, but the
  // version is the record that cannot be rewritten.
  const { error: versionError } = await supabase.rpc("record_report_version", {
    p_report_id: report.id,
    p_snapshot: snapshot,
    p_note: "First generation.",
  });
  if (versionError) {
    return { ok: false, error: "The report was saved but its version was not recorded." };
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "reporting",
    action: "report_generated",
    object_type: "report_instance",
    object_id: report.id,
    metadata: { report_type: reportType },
  });

  revalidatePath("/reports");
  return { ok: true, id: report.id as string };
}

/**
 * Recomputes a report and appends a new version.
 *
 * The report keeps its identity — same title, same period, same place in the
 * list — and gains a second set of numbers. Approval is cleared by the
 * database as it does so, because a report whose figures have moved is not
 * still the report somebody signed.
 */
export async function regenerateReport(reportId: string): Promise<ActionResult> {
  const session = await requireSession();

  const limited = await enforceRateLimit("report:generate", session.userId);
  if (limited) return limited;
  if (!session.isStaff) return { ok: false, error: "Staff access required." };

  const supabase = await createSupabaseServerClient();
  const { data: report } = await supabase
    .from("report_instance")
    .select("id, report_type, program_id, project_id, period_start, period_end")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) return { ok: false, error: "That report is not available to you." };
  if (!report.period_start || !report.period_end) {
    return { ok: false, error: "That report has no period, so it cannot be rebuilt." };
  }

  const built = await buildReportSnapshot(supabase, {
    reportType: report.report_type as "program_quarterly" | "project",
    programId: report.program_id,
    projectId: report.project_id,
    periodStart: report.period_start as string,
    periodEnd: report.period_end as string,
  });
  if (!built.ok) return { ok: false, error: built.error };

  const { data: versionId, error } = await supabase.rpc("record_report_version", {
    p_report_id: reportId,
    p_snapshot: built.snapshot,
    p_note: "Regenerated from live data.",
  });

  if (error || !versionId) {
    return { ok: false, error: "Could not record a new version of this report." };
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "reporting",
    action: "report_regenerated",
    object_type: "report_instance",
    object_id: reportId,
  });

  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
  return { ok: true, id: versionId as string };
}

/**
 * Signing off, or refusing, one version of a report.
 *
 * The decision is recorded against a version rather than the report, so the
 * approval says what was approved. `decide_report_version` writes the approval
 * and moves the report together, and refuses a version that has already been
 * superseded.
 */
async function decideLatestVersion(
  reportId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
  if (decision === "rejected" && !note?.trim()) {
    return { ok: false, error: "Say why you are sending it back." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: latest } = await supabase
    .from("report_version")
    .select("id")
    .eq("report_id", reportId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) {
    return { ok: false, error: "That report has no version to decide on." };
  }

  const { error } = await supabase.rpc("decide_report_version", {
    p_version_id: latest.id,
    p_decision: decision,
    p_note: note?.trim() || null,
  });

  if (error) {
    // The likeliest cause is a second decision on the same version, which the
    // unique index refuses — and which means somebody already answered.
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "This version has already been decided. Regenerate it to decide again."
          : "Could not record that decision.",
    };
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "reporting",
    action: decision === "approved" ? "report_approved" : "report_rejected",
    object_type: "report_version",
    object_id: latest.id,
  });

  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
  return { ok: true, id: latest.id as string };
}

export async function approveReport(reportId: string): Promise<ActionResult> {
  return decideLatestVersion(reportId, "approved");
}

export async function rejectReport(
  reportId: string,
  note: string,
): Promise<ActionResult> {
  return decideLatestVersion(reportId, "rejected", note);
}
