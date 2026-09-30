import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Schedule } from "./whatif";

/**
 * Reads the schedule a what-if plan works over, through the viewer's own
 * client. Only what the viewer can read is loaded, so only that can appear
 * in a plan or be moved by it; the page says so.
 */

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

export const SCHEDULE_LIMIT = 5000;

export interface MilestoneOption {
  id: string;
  name: string;
  projectName: string;
  due: string;
}

export interface ScheduleLoad {
  schedule: Schedule;
  options: MilestoneOption[];
  truncated: boolean;
}

export async function loadSchedule(client: Client): Promise<ScheduleLoad> {
  const [milestones, tasks, projects, goals, milestoneDeps, taskDeps] = await Promise.all([
    client.from("milestone").select("id, name, project_id, due_date").limit(SCHEDULE_LIMIT),
    client
      .from("task")
      .select("id, title, project_id, milestone_id, start_at, due_at, status")
      .is("archived_at", null)
      .not("due_at", "is", null)
      .limit(SCHEDULE_LIMIT),
    client.from("project").select("id, name, program_id, target_date").is("archived_at", null).limit(SCHEDULE_LIMIT),
    client.from("outcome_metric").select("id, name, program_id, target_on").is("retired_at", null).limit(SCHEDULE_LIMIT),
    client.from("milestone_dependency").select("blocking_milestone_id, blocked_milestone_id").limit(SCHEDULE_LIMIT),
    client.from("task_dependency").select("blocking_task_id, blocked_task_id").limit(SCHEDULE_LIMIT),
  ]);
  for (const result of [milestones, tasks, projects, goals, milestoneDeps, taskDeps]) {
    if (result.error) throw new Error(result.error.message);
  }
  const projectRows = projects.data ?? [];
  const projectName = new Map(projectRows.map((project) => [project.id, project.name]));
  const schedule: Schedule = {
    milestones: (milestones.data ?? []).map((m) => ({ id: m.id, name: m.name, projectId: m.project_id, due: m.due_date })),
    tasks: (tasks.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      projectId: t.project_id,
      milestoneId: t.milestone_id,
      start: t.start_at,
      due: t.due_at,
      closed: t.status === "completed" || t.status === "cancelled",
    })),
    projects: projectRows.map((p) => ({ id: p.id, name: p.name, programId: p.program_id, targetDate: p.target_date })),
    goals: (goals.data ?? []).map((g) => ({ id: g.id, name: g.name, programId: g.program_id, targetOn: g.target_on })),
    milestoneDeps: (milestoneDeps.data ?? []).map((d) => ({ blocking: d.blocking_milestone_id, blocked: d.blocked_milestone_id })),
    taskDeps: (taskDeps.data ?? []).map((d) => ({ blocking: d.blocking_task_id, blocked: d.blocked_task_id })),
  };
  const options = schedule.milestones
    .filter((m) => m.due && projectName.has(m.projectId))
    .map((m) => ({ id: m.id, name: m.name, projectName: projectName.get(m.projectId)!, due: m.due! }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
  const truncated = [milestones, tasks, projects, goals, milestoneDeps, taskDeps].some(
    (result) => (result.data?.length ?? 0) >= SCHEDULE_LIMIT,
  );
  return { schedule, options, truncated };
}
