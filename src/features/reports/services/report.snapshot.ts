import { readAll } from "@/lib/supabase/read-all";
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
    const results = await Promise.all([
        supabase
          .from("program")
          .select("name, description, lead:lead_id(full_name)")
          .eq("id", programId!)
          .maybeSingle(),
        readAll(supabase
          .from("project")
          .select("id, name, stage, health, outcome, target_date")
          .eq("program_id", programId!)
          .is("archived_at", null)),
        readAll(supabase
          .from("task")
          .select("id, title, status, completed_at, due_at")
          .eq("program_id", programId!)
          .is("archived_at", null)),
        readAll(supabase
          .from("meeting")
          .select("id, title, starts_at, status")
          .eq("program_id", programId!)
          .gte("starts_at", periodStart)
          .lt("starts_at", periodEndExclusive)),
        readAll(supabase
          .from("decision")
          .select("id, title, decided_at, project:project_id!inner(program_id)")
          .eq("project.program_id", programId!)
          .gte("decided_at", periodStart)
          .lt("decided_at", periodEndExclusive)),
        readAll(supabase
          .from("event")
          .select("id, name, starts_at, status")
          .eq("program_id", programId!)
          .gte("starts_at", periodStart)
          .lt("starts_at", periodEndExclusive)),
        readAll(supabase
          .from("project_status_update")
          .select("id, health, progress_summary, created_at, project_id, project:project_id!inner(program_id)")
          .eq("project.program_id", programId!)
          .gte("created_at", periodStart)
          .lt("created_at", periodEndExclusive)),
      ]);
    if (results.some(result => result.error)) {
      return { ok: false, error: "Could not read all report data. Please retry." };
    }
    const [{ data: program }, { data: projects }, { data: tasks }, { data: meetings }, { data: decisions }, { data: events }, { data: updates }] = results;

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
      decisions: decisions ?? [],
      events: events ?? [],
      status_updates: (updates ?? []).filter((u) => projectIds.has(u.project_id)),
    });

    const extras = await Promise.all([
      readAll(supabase
        .from("outcome_metric")
        .select("id, name, unit, target, measurements:outcome_measurement(value, measured_on)")
        .eq("program_id", programId!)
        .is("retired_at", null)),
      projectIds.size === 0
        ? Promise.resolve({ data: [], error: null })
        : readAll(supabase
            .from("risk")
            .select("id, title, status, project_id")
            .in("project_id", [...projectIds])
            .in("status", ["open", "mitigating"])),
      readAll(supabase
        .from("program_access_grant")
        .select("user_id, role, member:user_id(full_name)")
        .eq("program_id", programId!)),
      projectIds.size === 0
        ? Promise.resolve({ data: [], error: null })
        : readAll(supabase
            .from("milestone")
            .select("id, name, due_date, project_id, completed_at")
            .in("project_id", [...projectIds])
            .is("completed_at", null)
            .gte("due_date", periodStart)),
    ]);
    if (extras.some((result) => result.error)) {
      return { ok: false, error: "Could not read all report data. Please retry." };
    }
    const [{ data: outcomes }, { data: risks }, { data: people }, { data: upcomingMilestones }] = extras;
    Object.assign(snapshot, {
      outcomes: (outcomes ?? []).map((metric) => {
        const latest = [...((metric.measurements as { value: string; measured_on: string }[] | null) ?? [])]
          .sort((a, b) => b.measured_on.localeCompare(a.measured_on))[0];
        return {
          name: metric.name,
          unit: metric.unit,
          target: metric.target,
          latest: latest?.value ?? null,
        };
      }),
      risks: risks ?? [],
      people: (people ?? []).map((person) => ({
        name: (person.member as { full_name?: string } | null)?.full_name ?? "Unknown",
        role: person.role,
      })),
      upcoming: {
        milestones: upcomingMilestones ?? [],
        events: (events ?? []).filter((event) => (event.starts_at as string) >= periodStart),
        meetings: (meetings ?? []).filter((meeting) => (meeting.starts_at as string) >= periodStart),
      },
    });
  } else {
    const results = await Promise.all([
        supabase
          .from("project")
          .select(
            "name, outcome, stage, health, health_reason, start_date, target_date, owner:owner_id(full_name)",
          )
          .eq("id", projectId!)
          .maybeSingle(),
        readAll(supabase
          .from("task")
          .select("id, title, status, completed_at, due_at, blocked_reason")
          .eq("project_id", projectId!)
          .is("archived_at", null)),
        readAll(supabase
          .from("milestone")
          .select("id, name, due_date, completed_at")
          .eq("project_id", projectId!)),
        readAll(supabase
          .from("project_status_update")
          .select("id, health, progress_summary, next_steps, blockers, created_at")
          .eq("project_id", projectId!)
          .order("created_at", { ascending: false })),
        readAll(supabase
          .from("decision")
          .select("id, title, decided_at")
          .eq("project_id", projectId!)),
      ]);
    if (results.some(result => result.error)) {
      return { ok: false, error: "Could not read all report data. Please retry." };
    }
    const [{ data: project }, { data: tasks }, { data: milestones }, { data: updates }, { data: decisions }] = results;

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

    const extras = await Promise.all([
      readAll(supabase
        .from("activity_event")
        .select("id, summary, created_at")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })),
    ]);
    if (extras.some((result) => result.error)) {
      return { ok: false, error: "Could not read all report data. Please retry." };
    }
    const [{ data: activity }] = extras;
    const latestUpdate = (updates ?? [])[0] as { next_steps?: string | null } | undefined;
    const completed = (tasks ?? []).filter((task) => task.status === "completed").length;
    Object.assign(snapshot, {
      progress: {
        completed,
        total: (tasks ?? []).length,
        percent: (tasks ?? []).length === 0 ? 0 : Math.round((completed / (tasks ?? []).length) * 100),
      },
      next_steps: latestUpdate?.next_steps ?? null,
      activity: activity ?? [],
    });
  }


  return { ok: true, title, snapshot };
}
