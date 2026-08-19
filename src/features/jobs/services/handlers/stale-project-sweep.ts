import { createNotifications, type NotificationDraft } from "../notify";
import type { JobContext, JobResult } from "../runner";

/**
 * Weekly sweep for active projects nobody has touched (P0-DASH-03).
 *
 * "Touched" means an activity event — a task moved, a status changed, a note
 * added. A project with an owner and no activity in a fortnight is either
 * finished and unclosed, or quietly stalled; both are worth one message to the
 * person accountable for it.
 *
 * The dedupe key carries the week, so the owner hears about a stalled project
 * once a week rather than every time the sweep passes.
 */

const STALE_DAYS = 14;
const ACTIVE_STAGES = ["approved", "planning", "active"];

interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  owner_id: string | null;
  updated_at: string;
}

/** ISO week key, e.g. 2026-W34 — stable across a Monday-to-Sunday run window. */
export function isoWeekKey(at: Date): string {
  const date = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
  // Thursday of the current week determines the ISO year.
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function staleProjectSweep({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const cutoff = new Date(now.getTime() - STALE_DAYS * 86_400_000).toISOString();

  const { data: projectRows, error } = await db
    .from("project")
    .select("id, organization_id, name, owner_id, updated_at")
    .in("stage", ACTIVE_STAGES)
    .is("archived_at", null)
    .not("owner_id", "is", null)
    .limit(definition.batch_size);

  if (error) throw new Error(`could not load projects: ${error.message}`);

  const projects = (projectRows ?? []) as unknown as ProjectRow[];
  if (projects.length === 0) {
    return { processed: 0, failed: 0, metadata: { scanned: 0 } };
  }

  // One query for recent activity across the whole candidate set.
  const { data: activityRows } = await db
    .from("activity_event")
    .select("project_id")
    .gte("created_at", cutoff)
    .in(
      "project_id",
      projects.map((project) => project.id),
    );

  const recentlyActive = new Set(
    ((activityRows ?? []) as { project_id: string | null }[])
      .map((row) => row.project_id)
      .filter((id): id is string => Boolean(id)),
  );

  const week = isoWeekKey(now);
  const drafts: NotificationDraft[] = projects
    .filter(
      (project) => !recentlyActive.has(project.id) && project.updated_at < cutoff,
    )
    .map((project) => ({
      user_id: project.owner_id!,
      organization_id: project.organization_id,
      category: "system",
      title: `No activity in ${STALE_DAYS} days: ${project.name}`,
      body: "Update the health note, move it forward, or close it out.",
      source_type: "project",
      source_id: project.id,
      link: `/projects/${project.id}`,
      urgency: "normal" as const,
      dedupe_key: `stale-project:${project.id}:${week}`,
    }));

  const created = await createNotifications(db, drafts);

  return {
    processed: created,
    failed: 0,
    metadata: { scanned: projects.length, stale: drafts.length },
  };
}
