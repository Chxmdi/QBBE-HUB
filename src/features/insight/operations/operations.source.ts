import type { createSupabasePageClient } from "@/lib/supabase/page";
import { addCalendarDays } from "@/lib/time";
import { todayIn } from "../metrics";
import { OPS_WEEKS, type GoalMetric, type Measurement, type OpsTask } from "./operations";

/**
 * Reads what operations analytics needs through the viewer's own client:
 * tasks (open, or touched in the window), the names of the people and
 * projects they point at, and live outcome metrics with their measurements.
 * RLS decides what is counted.
 */

type Client = Pick<Awaited<ReturnType<typeof createSupabasePageClient>>, "from">;

export const OPS_LIMIT = 5000;

export interface OperationsLoad {
  tasks: OpsTask[];
  people: Map<string, string>;
  projects: Map<string, string>;
  truncated: boolean;
}

export async function loadOperations(client: Client, now: Date, timeZone?: string): Promise<OperationsLoad> {
  const since = addCalendarDays(todayIn(now, timeZone), -7 * (OPS_WEEKS + 1))!;
  const tasks = await client
    .from("task")
    .select("assignee_id, project_id, status, priority, created_at, due_at, completed_at")
    .is("archived_at", null)
    .or(`completed_at.is.null,completed_at.gte.${since}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(OPS_LIMIT);
  if (tasks.error) throw new Error(tasks.error.message);
  const rows = tasks.data ?? [];
  const personIds = [...new Set(rows.map((row) => row.assignee_id).filter((id): id is string => !!id))];
  const projectIds = [...new Set(rows.map((row) => row.project_id).filter((id): id is string => !!id))];
  const [people, projects] = await Promise.all([
    personIds.length ? client.from("user_profile").select("id, full_name").in("id", personIds) : Promise.resolve({ data: [], error: null }),
    projectIds.length ? client.from("project").select("id, name").in("id", projectIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (people.error) throw new Error(people.error.message);
  if (projects.error) throw new Error(projects.error.message);
  return {
    tasks: rows.map((row) => ({
      assigneeId: row.assignee_id,
      projectId: row.project_id,
      status: row.status,
      priority: row.priority,
      createdAt: row.created_at,
      dueAt: row.due_at,
      completedAt: row.completed_at,
    })),
    people: new Map((people.data ?? []).map((row) => [row.id, row.full_name ?? ""])),
    projects: new Map((projects.data ?? []).map((row) => [row.id, row.name])),
    truncated: rows.length >= OPS_LIMIT,
  };
}

export interface GoalsLoad {
  metrics: GoalMetric[];
  measurements: Measurement[];
}

export async function loadGoals(client: Client): Promise<GoalsLoad> {
  const metrics = await client
    .from("outcome_metric")
    .select("id, name, unit, direction, baseline, baseline_on, target, target_on")
    .is("retired_at", null)
    .order("name")
    .limit(200);
  if (metrics.error) throw new Error(metrics.error.message);
  const ids = (metrics.data ?? []).map((row) => row.id);
  const measurements = ids.length
    ? await client.from("outcome_measurement").select("metric_id, measured_on, value").in("metric_id", ids).order("measured_on").limit(OPS_LIMIT)
    : { data: [], error: null };
  if (measurements.error) throw new Error(measurements.error.message);
  return {
    metrics: (metrics.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      direction: row.direction,
      baseline: row.baseline === null ? null : Number(row.baseline),
      baselineOn: row.baseline_on,
      target: row.target === null ? null : Number(row.target),
      targetOn: row.target_on,
    })),
    measurements: (measurements.data ?? []).map((row) => ({
      metricId: row.metric_id,
      measuredOn: row.measured_on,
      value: Number(row.value),
    })),
  };
}
