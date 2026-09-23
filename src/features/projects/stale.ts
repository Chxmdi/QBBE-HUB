/**
 * Whether an active project has missed its reporting cadence.
 *
 * One rule, used by the stale sweep and the dashboard, so the notification
 * and the flag cannot disagree about what "stale" means. A project with no
 * cadence is never stale. The clock starts at the last status update, or at
 * creation when nobody has written one yet — not at any other edit, which
 * would let a renamed project look freshly reported.
 */

export type ReportingCadence = "none" | "weekly" | "monthly";

const CADENCE_DAYS: Record<Exclude<ReportingCadence, "none">, number> = {
  weekly: 7,
  monthly: 30,
};

const REPORTED_STAGES = ["approved", "planning", "active"];

export function cadenceDays(cadence: string | null | undefined): number | null {
  if (cadence === "weekly" || cadence === "monthly") return CADENCE_DAYS[cadence];
  return null;
}

export function isProjectStale(
  project: {
    reporting_cadence?: string | null;
    last_status_update_at?: string | null;
    created_at?: string | null;
    stage?: string | null;
    archived_at?: string | null;
  },
  now: Date,
): boolean {
  if (project.archived_at) return false;
  if (project.stage && !REPORTED_STAGES.includes(project.stage)) return false;
  const days = cadenceDays(project.reporting_cadence);
  if (days === null) return false;
  const anchor = project.last_status_update_at ?? project.created_at;
  if (!anchor) return true;
  return new Date(anchor).getTime() < now.getTime() - days * 86_400_000;
}

/** Calendar date the next status update is due, or null when there is no cadence. */
export function nextReportingDueOn(
  project: {
    reporting_cadence?: string | null;
    last_status_update_at?: string | null;
    created_at?: string | null;
    archived_at?: string | null;
  },
  now: Date,
): string | null {
  if (project.archived_at) return null;
  const days = cadenceDays(project.reporting_cadence);
  if (days === null) return null;
  const anchor = project.last_status_update_at ?? project.created_at;
  if (!anchor) return now.toISOString().slice(0, 10);
  return new Date(new Date(anchor).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
