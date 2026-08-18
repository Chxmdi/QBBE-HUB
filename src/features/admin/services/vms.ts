/** Recorded VMS identity fixture used when the live API is unavailable. */
export interface VmsIdentity {
  vmsId: string;
  displayName: string;
  availability: "available" | "unavailable" | "unknown";
}

export function mapVmsIdentity(raw: Record<string, unknown>): VmsIdentity | null {
  const vmsId = typeof raw.id === "string" ? raw.id : typeof raw.vms_id === "string" ? raw.vms_id : "";
  const displayName =
    typeof raw.display_name === "string"
      ? raw.display_name
      : typeof raw.name === "string"
        ? raw.name
        : "";
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
    seen.add(mapped.vmsId); return [mapped];
  });
}

/** Disconnect must never imply Hub tasks were deleted. */
export function vmsDisconnectEffect(): { dropsVmsFields: true; deletesHubTasks: false } {
  return { dropsVmsFields: true, deletesHubTasks: false };
}
