import type { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Building a report's snapshot.
 *
 * Extracted from the generate command so that regenerating an existing report
 * runs exactly the same code. Two copies of this arithmetic would be two
 * copies that drift, and a report whose second version was computed
 * differently from its first is worse than no second version at all.
 *
 * Every query runs as the signed-in person, so a snapshot can only ever
 * contain what its author was allowed to see.
 */

export type ReportType = "program_quarterly" | "project";

export interface SnapshotRequest {
  reportType: ReportType;
  programId?: string | null;
  projectId?: string | null;
  periodStart: string;
  periodEnd: string;
}

export type SnapshotResult =
  | { ok: true; title: string; snapshot: Record<string, unknown> }
  | { ok: false; error: string };

export async function buildReportSnapshot(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  request: SnapshotRequest,
): Promise<SnapshotResult> {
  const { reportType, programId, projectId, periodStart, periodEnd } = request;

  if (reportType === "program_quarterly" && !programId) {
    return { ok: false, error: "Pick a program for a quarterly report." };
  }
  if (reportType === "project" && !projectId) {
    return { ok: false, error: "Pick a project for a project report." };
  }

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


  return { ok: true, title, snapshot };
}
