import { cadenceDays, isProjectStale } from "@/features/projects/stale";
import { createNotifications, type NotificationDraft } from "../notify";
import type { JobContext, JobResult } from "../runner";

/**
 * Asks the owner of a project whose reporting cadence has lapsed to write a
 * status update (P1-UPD-01, P1-UPD-02).
 *
 * Stale means the last status update — or creation, if there has never been
 * one — is older than the cadence. Other activity does not reset it. A
 * project set to "none" is never asked. The dedupe key carries the week, so
 * the owner hears about a stalled project once a week rather than every time
 * the sweep passes.
 */

const ACTIVE_STAGES = ["approved", "planning", "active"];

interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  owner_id: string | null;
  created_at: string;
  reporting_cadence?: string;
  last_status_update_at?: string | null;
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
  const { data: projectRows, error } = await db
    .from("project")
    .select("id, organization_id, name, owner_id, created_at, reporting_cadence, last_status_update_at")
    .in("stage", ACTIVE_STAGES)
    .is("archived_at", null)
    .not("owner_id", "is", null)
    .limit(definition.batch_size);

  if (error) throw new Error(`could not load projects: ${error.message}`);

  const projects = (projectRows ?? []) as unknown as ProjectRow[];
  if (projects.length === 0) {
    return { processed: 0, failed: 0, metadata: { scanned: 0 } };
  }

  const week = isoWeekKey(now);
  const drafts: NotificationDraft[] = projects
    .filter((project) => isProjectStale({ ...project, stage: "active" }, now))
    .map((project) => {
      const days = cadenceDays(project.reporting_cadence) ?? 0;
      const cadence = project.reporting_cadence === "monthly" ? "monthly" : "weekly";
      return {
        user_id: project.owner_id!,
        organization_id: project.organization_id,
        category: "system",
        title: `Status update due: ${project.name}`,
        body: `This project reports ${cadence}. The last status update is older than ${days} days.`,
        source_type: "project",
        source_id: project.id,
        link: `/projects/${project.id}?tab=updates`,
        urgency: "normal" as const,
        dedupe_key: `stale-project:${project.id}:${week}`,
      };
    });

  const created = await createNotifications(db, drafts);

  return {
    processed: created,
    failed: 0,
    metadata: { scanned: projects.length, stale: drafts.length },
  };
}
