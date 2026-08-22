"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { enforceRateLimit } from "@/lib/rate-limit";

const generateSchema = z.object({
  reportType: z.enum(["program_quarterly", "project"]),
  programId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  periodStart: z.string().min(1, "Pick a period start."),
  periodEnd: z.string().min(1, "Pick a period end."),
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
  if (reportType === "program_quarterly" && !programId) {
    return { ok: false, error: "Pick a program for a quarterly report." };
  }
  if (reportType === "project" && !projectId) {
    return { ok: false, error: "Pick a project for a project report." };
  }

  const supabase = await createSupabaseServerClient();
  const periodEndExclusive = new Date(
    new Date(periodEnd).getTime() + 86400_000,
  ).toISOString();

  let title = "";
  const snapshot: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    period_start: periodStart,
    period_end: periodEnd,
  };

  if (reportType === "program_quarterly") {
    const [{ data: program }, { data: projects }, { data: tasks }, { data: meetings }, { data: decisions }, { data: events }, { data: updates }] =
      await Promise.all([
        supabase
          .from("program")
          .select("name, description, lead:lead_id(full_name)")
          .eq("id", programId!)
          .maybeSingle(),
        supabase
          .from("project")
          .select("id, name, stage, health, outcome, target_date")
          .eq("program_id", programId!)
          .is("archived_at", null),
        supabase
          .from("task")
          .select("id, title, status, completed_at, due_at")
          .eq("program_id", programId!)
          .is("archived_at", null),
        supabase
          .from("meeting")
          .select("id, title, starts_at, status")
          .eq("program_id", programId!)
          .gte("starts_at", periodStart)
          .lt("starts_at", periodEndExclusive),
        supabase
          .from("decision")
          .select("id, title, decided_at")
          .gte("decided_at", periodStart)
          .lt("decided_at", periodEndExclusive),
        supabase
          .from("event")
          .select("id, name, starts_at, status")
          .eq("program_id", programId!)
          .gte("starts_at", periodStart)
          .lt("starts_at", periodEndExclusive),
        supabase
          .from("project_status_update")
          .select("id, health, progress_summary, created_at, project_id")
          .gte("created_at", periodStart)
          .lt("created_at", periodEndExclusive)
          .limit(50),
      ]);

    if (!program) return { ok: false, error: "Program not found." };
    title = `${program.name} — Quarterly report (${periodStart} → ${periodEnd})`;

    const completedInPeriod = (tasks ?? []).filter(
      (t) =>
        t.completed_at &&
        t.completed_at >= periodStart &&
        t.completed_at < periodEndExclusive,
    );
    const projectIds = new Set((projects ?? []).map((p) => p.id));
    Object.assign(snapshot, {
      program: {
        name: program.name,
        description: program.description,
        lead: (program.lead as unknown as { full_name: string } | null)?.full_name ?? null,
      },
      metrics: {
        projects_total: (projects ?? []).length,
        projects_active: (projects ?? []).filter((p) => p.stage === "active").length,
        tasks_total: (tasks ?? []).length,
        tasks_completed_in_period: completedInPeriod.length,
        meetings_held: (meetings ?? []).length,
        events_in_period: (events ?? []).length,
      },
      projects: projects ?? [],
      delivered_work: completedInPeriod.map((t) => ({
        title: t.title,
        completed_at: t.completed_at,
      })),
      meetings: meetings ?? [],
      decisions: (decisions ?? []).slice(0, 30),
      events: events ?? [],
      status_updates: (updates ?? []).filter((u) => projectIds.has(u.project_id)),
    });
  } else {
    const [{ data: project }, { data: tasks }, { data: milestones }, { data: updates }, { data: decisions }] =
      await Promise.all([
        supabase
          .from("project")
          .select(
            "name, outcome, stage, health, health_reason, start_date, target_date, owner:owner_id(full_name)",
          )
          .eq("id", projectId!)
          .maybeSingle(),
        supabase
          .from("task")
          .select("id, title, status, completed_at, due_at, blocked_reason")
          .eq("project_id", projectId!)
          .is("archived_at", null),
        supabase
          .from("milestone")
          .select("id, name, due_date, completed_at")
          .eq("project_id", projectId!),
        supabase
          .from("project_status_update")
          .select("id, health, progress_summary, next_steps, blockers, created_at")
          .eq("project_id", projectId!)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("decision")
          .select("id, title, decided_at")
          .eq("project_id", projectId!)
          .limit(30),
      ]);

    if (!project) return { ok: false, error: "Project not found." };
    title = `${project.name} — Project report (${periodStart} → ${periodEnd})`;

    Object.assign(snapshot, {
      project: {
        name: project.name,
        outcome: project.outcome,
        stage: project.stage,
        health: project.health,
        health_reason: project.health_reason,
        owner: (project.owner as unknown as { full_name: string } | null)?.full_name ?? null,
        start_date: project.start_date,
        target_date: project.target_date,
      },
      metrics: {
        tasks_total: (tasks ?? []).length,
        tasks_completed: (tasks ?? []).filter((t) => t.status === "completed").length,
        tasks_blocked: (tasks ?? []).filter((t) => t.status === "blocked").length,
        milestones_total: (milestones ?? []).length,
        milestones_completed: (milestones ?? []).filter((m) => m.completed_at).length,
      },
      milestones: milestones ?? [],
      blockers: (tasks ?? [])
        .filter((t) => t.status === "blocked")
        .map((t) => ({ title: t.title, reason: t.blocked_reason })),
      status_updates: updates ?? [],
      decisions: decisions ?? [],
      tasks: tasks ?? [],
    });
  }

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

export async function approveReport(reportId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("report_instance")
    .update({
      status: "approved",
      approved_by: session.userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", reportId);
  if (error) return { ok: false, error: "Could not approve the report." };

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "reporting",
    action: "report_approved",
    object_type: "report_instance",
    object_id: reportId,
  });

  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
  return { ok: true };
}
