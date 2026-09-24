/** Recorded VMS identity fixture used when the live API is unavailable. */
export interface VmsIdentity {
  vmsId: string;
  displayName: string;
  availability: "available" | "unavailable" | "unknown";
}

export interface VmsAssignment {
  assignmentId: string;
  vmsId: string;
  title: string;
  status: "assigned" | "confirmed" | "completed" | "cancelled" | "unknown";
  startsAt: string | null;
  endsAt: string | null;
  sourceUrl: string | null;
  updatedAt: string | null;
}

export interface VmsSnapshot {
  identities: VmsIdentity[];
  assignments: VmsAssignment[];
  assignmentsProvided: boolean;
  recognized: boolean;
}

function text(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function mapVmsIdentity(raw: Record<string, unknown>): VmsIdentity | null {
  const vmsId = text(raw, "id", "vms_id", "volunteer_id");
  const displayName = text(raw, "display_name", "name", "full_name");
  if (!vmsId || !displayName) return null;
  const availability =
    raw.availability === "available" || raw.availability === "unavailable"
      ? raw.availability
      : "unknown";
  return { vmsId, displayName, availability };
}

/** Accepts common VMS list envelopes while rejecting incomplete identities. */
export function mapVmsIdentities(raw: unknown): VmsIdentity[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { volunteers?: unknown[] }).volunteers)
      ? (raw as { volunteers: unknown[] }).volunteers
      : [];
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const mapped = mapVmsIdentity(row as Record<string, unknown>);
    if (!mapped || seen.has(mapped.vmsId)) return [];
    seen.add(mapped.vmsId);
    return [mapped];
  });
}

function normalizeAssignmentStatus(value: unknown): VmsAssignment["status"] {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (["assigned", "scheduled", "pending"].includes(status)) return "assigned";
  if (["confirmed", "accepted"].includes(status)) return "confirmed";
  if (["completed", "done"].includes(status)) return "completed";
  if (["cancelled", "canceled", "declined"].includes(status)) return "cancelled";
  return "unknown";
}

export function mapVmsAssignment(raw: Record<string, unknown>): VmsAssignment | null {
  const assignmentId = text(raw, "id", "assignment_id");
  const vmsId = text(raw, "volunteer_id", "vms_id");
  const title = text(raw, "title", "name", "role");
  if (!assignmentId || !vmsId || !title) return null;

  const url = text(raw, "url", "web_url", "link");
  return {
    assignmentId,
    vmsId,
    title,
    status: normalizeAssignmentStatus(raw.status),
    startsAt: isoOrNull(raw.starts_at ?? raw.start_at ?? raw.start),
    endsAt: isoOrNull(raw.ends_at ?? raw.end_at ?? raw.end),
    sourceUrl: /^https:\/\//i.test(url) ? url : null,
    updatedAt: isoOrNull(raw.updated_at ?? raw.modified_at),
  };
}

export function mapVmsAssignments(raw: unknown): VmsAssignment[] {
  const rows =
    raw && typeof raw === "object" && Array.isArray((raw as { assignments?: unknown[] }).assignments)
      ? (raw as { assignments: unknown[] }).assignments
      : [];
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const mapped = mapVmsAssignment(row as Record<string, unknown>);
    if (!mapped || seen.has(mapped.assignmentId)) return [];
    seen.add(mapped.assignmentId);
    return [mapped];
  });
}

/**
 * Normalizes the provider boundary while preserving whether assignments were
 * actually supplied. An identity-only provider response must not be mistaken
 * for an empty assignment snapshot and wipe prior external references.
 */
export function mapVmsSnapshot(raw: unknown): VmsSnapshot {
  const arrayEnvelope = Array.isArray(raw);
  const objectEnvelope = Boolean(raw && typeof raw === "object");
  const assignmentsProvided =
    objectEnvelope && Array.isArray((raw as { assignments?: unknown[] }).assignments);
  const identities = mapVmsIdentities(raw);
  const assignments = mapVmsAssignments(raw);
  return {
    identities,
    assignments,
    assignmentsProvided,
    recognized: arrayEnvelope || Boolean(
      objectEnvelope &&
      (Array.isArray((raw as { volunteers?: unknown[] }).volunteers) || assignmentsProvided)
    ),
  };
}

/** Disconnect must never imply Hub tasks were deleted. */
export function vmsDisconnectEffect(): { dropsVmsFields: true; deletesHubTasks: false } {
  return { dropsVmsFields: true, deletesHubTasks: false };
}
