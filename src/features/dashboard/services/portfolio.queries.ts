import {
  addCalendarDays,
  calendarDateInZone,
  DEFAULT_TIME_ZONE,
} from "@/lib/time";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  applyPortfolioFilters,
  dashboardLens,
  markStale,
  portfolioCounts,
  rollupWorkloadByTeam,
  summarizeWorkload,
  type DashboardLens,
  type PortfolioFilters,
  type PortfolioSource,
  type WorkloadPerson,
  type WorkloadTeam,
} from "@/features/dashboard/portfolio";
import { nextReportingDueOn } from "@/features/projects/stale";
import type { OrgRole, ProjectHealth, ProjectStage } from "@/types/entities";

export interface PortfolioResult {
  rows: PortfolioSource[];
  counts: ReturnType<typeof portfolioCounts>;
  refreshedAt: string;
  lens: DashboardLens;
}

interface ProjectRecord {
  id: string;
  name: string;
  program_id: string | null;
  owner_id: string | null;
  health: ProjectHealth;
  stage: ProjectStage;
  priority: string;
  target_date: string | null;
  last_status_update_at: string | null;
  created_at: string;
  reporting_cadence: string | null;
  archived_at: string | null;
  funding_source_id: string | null;
  program: { id: string; name: string; lead_id: string | null } | null;
  owner: { id: string; full_name: string } | null;
}

export async function getPortfolio(input: {
  userId: string;
  role: OrgRole;
  filters: PortfolioFilters;
  timeZone?: string;
  now?: Date;
}): Promise<PortfolioResult> {
  const now = input.now ?? new Date();
  const lens = dashboardLens(input.role);
  const supabase = await createSupabaseServerClient();
  const refreshedAt = now.toISOString();

  // No lens short-circuit: row-level security already limits every reader,
  // volunteers included, to the projects they were granted.
  let query = supabase
    .from("project")
    .select(
      "id, name, program_id, owner_id, health, stage, priority, target_date, last_status_update_at, created_at, reporting_cadence, archived_at, funding_source_id, " +
        "program:program_id(id, name, lead_id), owner:owner_id(id, full_name)",
    )
    .order("name")
    .limit(200);
  query =
    input.filters.status === "archived" || input.filters.stage === "archived"
      ? query.not("archived_at", "is", null)
      : query.is("archived_at", null);

  const { data } = await query;
  const projects = (data ?? []) as unknown as ProjectRecord[];
  const projectIds = projects.map((project) => project.id);

  const [tasksRes, milestonesRes, issuesRes, updatesRes, grantsRes] =
    await Promise.all([
      projectIds.length === 0
        ? Promise.resolve({ data: [] })
        : supabase
            .from("task")
            .select("id, project_id, status, title, assignee_id")
            .in("project_id", projectIds)
            .is("archived_at", null),
      projectIds.length === 0
        ? Promise.resolve({ data: [] })
        : supabase
            .from("milestone")
            .select("id, project_id, name, due_date, completed_at, status")
            .in("project_id", projectIds)
            .order("due_date", { ascending: true, nullsFirst: false }),
      projectIds.length === 0
        ? Promise.resolve({ data: [] })
        : supabase
            .from("issue")
            .select("project_id, title, severity")
            .in("project_id", projectIds)
            .in("status", ["open", "investigating"]),
      projectIds.length === 0
        ? Promise.resolve({ data: [] })
        : supabase
            .from("project_status_update")
            .select("project_id, blockers, created_at")
            .in("project_id", projectIds)
            .order("created_at", { ascending: false }),
      input.filters.member
        ? supabase
            .from("project_access_grant")
            .select("project_id")
            .eq("user_id", input.filters.member)
        : Promise.resolve({ data: [] }),
    ]);

  const tasks = (tasksRes.data ?? []) as {
    project_id: string;
    status: string;
    title: string;
    assignee_id: string | null;
  }[];
  const milestones = (milestonesRes.data ?? []) as {
    project_id: string;
    name: string;
    due_date: string | null;
    completed_at: string | null;
    status: string;
  }[];
  const issues = (issuesRes.data ?? []) as {
    project_id: string;
    title: string;
    severity: string;
  }[];
  const updates = (updatesRes.data ?? []) as {
    project_id: string;
    blockers: string | null;
    created_at: string;
  }[];

  const memberIds = new Set<string>(
    ((grantsRes.data ?? []) as { project_id: string }[]).map(
      (grant) => grant.project_id,
    ),
  );
  if (input.filters.member) {
    for (const task of tasks) {
      if (task.assignee_id === input.filters.member)
        memberIds.add(task.project_id);
    }
  }

  const sources: PortfolioSource[] = projects.map((project) => {
    const projectTasks = tasks.filter((task) => task.project_id === project.id);
    const completed = projectTasks.filter(
      (task) => task.status === "completed",
    ).length;
    const next = milestones.find(
      (milestone) =>
        milestone.project_id === project.id &&
        !milestone.completed_at &&
        milestone.status !== "completed",
    );
    const latestBlocker = updates.find(
      (update) => update.project_id === project.id && update.blockers,
    );
    const openIssue = issues.find((issue) => issue.project_id === project.id);
    const blockedTask = projectTasks.find((task) => task.status === "blocked");
    return {
      id: project.id,
      name: project.name,
      programId: project.program_id,
      programName: project.program?.name ?? null,
      ownerId: project.owner_id,
      ownerName: project.owner?.full_name ?? null,
      health: project.health,
      stage: project.stage,
      priority: project.priority,
      targetDate: project.target_date,
      progressPercent:
        projectTasks.length === 0
          ? 0
          : Math.round((completed / projectTasks.length) * 100),
      nextMilestone: next?.name ?? null,
      nextMilestoneDue: next?.due_date ?? null,
      mainBlocker:
        latestBlocker?.blockers ??
        openIssue?.title ??
        blockedTask?.title ??
        null,
      lastUpdateAt: project.last_status_update_at,
      createdAt: project.created_at,
      reportingCadence: project.reporting_cadence,
      archivedAt: project.archived_at,
      fundingSourceId: project.funding_source_id,
      stale: markStale(
        {
          reporting_cadence: project.reporting_cadence,
          last_status_update_at: project.last_status_update_at,
          created_at: project.created_at,
          stage: project.stage,
          archived_at: project.archived_at,
        },
        now,
      ),
    };
  });

  const { data: ownGrants } = await supabase
    .from("project_access_grant")
    .select("project_id")
    .eq("user_id", input.userId);
  const managedIds = new Set(
    ((ownGrants ?? []) as { project_id: string }[]).map(
      (grant) => grant.project_id,
    ),
  );
  const assignedIds = new Set(
    tasks
      .filter((task) => task.assignee_id === input.userId)
      .map((task) => task.project_id),
  );
  const visible =
    lens === "leadership"
      ? sources
      : sources.filter(
          (row) =>
            row.ownerId === input.userId ||
            managedIds.has(row.id) ||
            assignedIds.has(row.id) ||
            projects.find((project) => project.id === row.id)?.program
              ?.lead_id === input.userId,
        );

  const rows = applyPortfolioFilters(visible, input.filters, memberIds);
  return { rows, counts: portfolioCounts(visible), refreshedAt, lens };
}

export async function getWorkload(
  timeZone: string = DEFAULT_TIME_ZONE,
): Promise<{
  people: WorkloadPerson[];
  teams: WorkloadTeam[];
}> {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const today =
    calendarDateInZone(now, timeZone) ?? now.toISOString().slice(0, 10);
  const weekOut = addCalendarDays(today, 7) ?? today;
  const [{ data }, { data: teams }, { data: members }] = await Promise.all([
    supabase
      .from("task")
      .select(
        "assignee_id, due_at, estimate_hours, assignee:assignee_id(full_name)",
      )
      .in("status", [
        "not_started",
        "ready",
        "in_progress",
        "waiting",
        "blocked",
        "in_review",
      ])
      .is("archived_at", null)
      .limit(1000),
    supabase.from("team").select("id, name").order("name"),
    supabase.from("team_member").select("team_id, user_id"),
  ]);
  const tasks = (data ?? []) as unknown as {
    assignee_id: string | null;
    due_at: string | null;
    estimate_hours: number | null;
    assignee: { full_name: string } | null;
  }[];
  const people = summarizeWorkload(
    tasks.map((task) => ({
      assigneeId: task.assignee_id,
      assigneeName: task.assignee?.full_name ?? null,
      dueAt: task.due_at,
      estimateHours: task.estimate_hours,
    })),
    today,
    weekOut,
  );
  const teamNames = new Map(
    (teams ?? []).map((team) => [team.id as string, team.name as string]),
  );
  return {
    people,
    teams: rollupWorkloadByTeam(
      people,
      ((members ?? []) as { team_id: string; user_id: string }[]).map(
        (member) => ({
          teamId: member.team_id,
          teamName: teamNames.get(member.team_id) ?? "Team",
          userId: member.user_id,
        }),
      ),
    ),
  };
}

export interface OutcomeRollup {
  id: string;
  name: string;
  programName: string;
  unit: string;
  target: string | null;
  latest: string | null;
}

export async function getOutcomeRollup(): Promise<OutcomeRollup[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("outcome_metric")
    .select(
      "id, name, unit, target, program:program_id(name), measurements:outcome_measurement(value, measured_on)",
    )
    .is("retired_at", null)
    .limit(12);
  return (
    (data ?? []) as unknown as {
      id: string;
      name: string;
      unit: string;
      target: string | null;
      program: { name: string } | null;
      measurements: { value: string; measured_on: string }[];
    }[]
  ).map((metric) => {
    const latest = [...(metric.measurements ?? [])].sort((a, b) =>
      b.measured_on.localeCompare(a.measured_on),
    )[0];
    return {
      id: metric.id,
      name: metric.name,
      programName: metric.program?.name ?? "Program",
      unit: metric.unit,
      target: metric.target,
      latest: latest?.value ?? null,
    };
  });
}

export interface CommitmentItem {
  id: string;
  kind: string;
  title: string;
  when: string;
  href: string;
}

export async function getCommitments(
  timeZone: string = DEFAULT_TIME_ZONE,
): Promise<CommitmentItem[]> {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const today =
    calendarDateInZone(now, timeZone) ?? now.toISOString().slice(0, 10);
  const plus30 = addCalendarDays(today, 30) ?? today;
  const [milestones, followUps, projects] = await Promise.all([
    supabase
      .from("milestone")
      .select("id, name, due_date, project_id, completed_at")
      .gte("due_date", today)
      .lte("due_date", plus30)
      .is("completed_at", null)
      .order("due_date")
      .limit(8),
    supabase
      .from("crm_follow_up")
      .select("id, title, due_at, crm_organization_id")
      .eq("status", "open")
      .order("due_at")
      .limit(8),
    supabase
      .from("project")
      .select(
        "id, name, reporting_cadence, last_status_update_at, created_at, stage, archived_at",
      )
      .in("reporting_cadence", ["weekly", "monthly"])
      .is("archived_at", null)
      .limit(20),
  ]);

  const items: CommitmentItem[] = [];
  for (const milestone of milestones.data ?? []) {
    items.push({
      id: milestone.id as string,
      kind: "Upcoming milestone",
      title: milestone.name as string,
      when: milestone.due_date as string,
      href: `/projects/${milestone.project_id}`,
    });
  }
  for (const followUp of followUps.data ?? []) {
    items.push({
      id: followUp.id as string,
      kind: "Relationship follow-up",
      title: followUp.title as string,
      when: followUp.due_at as string,
      href: `/crm/${followUp.crm_organization_id}`,
    });
  }
  for (const project of (projects.data ?? []) as {
    id: string;
    name: string;
    reporting_cadence: string;
    last_status_update_at: string | null;
    created_at: string;
    stage: string;
    archived_at: string | null;
  }[]) {
    const due = nextReportingDueOn(project, now);
    if (!due) continue;
    const stale = markStale(project, now);
    if (!stale && (due < today || due > plus30)) continue;
    items.push({
      id: `report-${project.id}`,
      kind: "Reporting date",
      title: project.name,
      when: due,
      href: `/projects/${project.id}?tab=updates`,
    });
  }
  return items;
}

export async function listPortfolioViews(): Promise<
  {
    id: string;
    name: string;
    query: Record<string, string>;
    shared: boolean;
    ownerId: string;
  }[]
> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("saved_view")
    .select("id, name, query, shared, user_id")
    .eq("path", "/projects")
    .order("name");
  return (
    (data ?? []) as {
      id: string;
      name: string;
      query: Record<string, string> | null;
      shared: boolean;
      user_id: string;
    }[]
  ).map((view) => ({
    id: view.id,
    name: view.name,
    query: view.query ?? {},
    shared: view.shared,
    ownerId: view.user_id,
  }));
}
