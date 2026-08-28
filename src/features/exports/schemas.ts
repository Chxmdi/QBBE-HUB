import { z } from "zod";

/**
 * Requesting a data export.
 *
 * The kinds are split by who may ask for them, which is a permission decision
 * expressed twice: here for a readable message, and in `export_job_request`
 * for the boundary that actually holds.
 */

export const EXPORT_KINDS = [
  "organization_data",
  "person_data",
  "crm_contacts",
  "task_history",
  "report_bundle",
] as const;

export const EXPORT_STATUSES = [
  "queued",
  "running",
  "ready",
  "failed",
  "expired",
] as const;

export type ExportKind = (typeof EXPORT_KINDS)[number];
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** Kinds a staff member may request without being an administrator. */
export const STAFF_EXPORT_KINDS: ExportKind[] = [
  "crm_contacts",
  "task_history",
  "report_bundle",
];

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  organization_data: "Everything we hold",
  person_data: "Everything about one person",
  crm_contacts: "Relationships and contacts",
  task_history: "Task history",
  report_bundle: "Reports and approvals",
};

export const EXPORT_KIND_DESCRIPTIONS: Record<ExportKind, string> = {
  organization_data:
    "People, programs, projects, tasks, meetings, decisions, risks, issues and funding. For an audit or a move away.",
  person_data:
    "A subject access request: the profile, memberships, assigned tasks, messages written, notifications and email records for one person.",
  crm_contacts: "Funders, partners, contacts and the interaction history.",
  task_history: "Every task, with its dates, status and assignment.",
  report_bundle: "Reports with every version and the decisions taken on them.",
};

export const EXPORT_STATUS_LABELS: Record<ExportStatus, string> = {
  queued: "Queued",
  running: "Building",
  ready: "Ready",
  failed: "Failed",
  expired: "Expired",
};

export function isDownloadable(row: {
  status: ExportStatus;
  expires_at: string;
}, now: Date): boolean {
  // Expiry is enforced by a job, so between the moment a file lapses and the
  // moment the sweep runs, a row can be `ready` and past its date. The
  // download path checks the clock rather than trusting the status.
  return row.status === "ready" && new Date(row.expires_at).getTime() > now.getTime();
}

export function hoursUntilExpiry(expiresAt: string, now: Date): number {
  return Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 3_600_000),
  );
}

export const requestExportSchema = z
  .object({
    kind: z.enum(EXPORT_KINDS),
    subjectUserId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) => value.kind !== "person_data" || Boolean(value.subjectUserId),
    {
      message: "Choose the person this export is about.",
      path: ["subjectUserId"],
    },
  );
