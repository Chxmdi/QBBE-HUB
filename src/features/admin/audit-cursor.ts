/**
 * Keyset paging for the admin audit log. Events are listed newest first by
 * (created_at, id); "Older events" carries the last shown row's time and id,
 * so events sharing one timestamp across a page boundary are neither
 * repeated nor skipped, and no page needs an offset or a count.
 *
 * The cursor comes from the URL and goes into a PostgREST filter string, so
 * both parts are validated strictly: a timestamp in the database's own form
 * and a uuid, nothing else.
 */

export type AuditCursor = { createdAt: string; id: string };

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cursor from the page's search parameters, or null when absent or not well formed. */
export function parseAuditCursor(before: string | undefined, beforeId: string | undefined): AuditCursor | null {
  if (!before || !beforeId || !TIMESTAMP.test(before) || !UUID.test(beforeId)) return null;
  return { createdAt: before, id: beforeId };
}

/** The search parameters that continue after `row`. */
export function auditCursorOf(row: { created_at: string; id: string }): { before: string; beforeId: string } {
  return { before: row.created_at, beforeId: row.id };
}

/** The PostgREST `or` filter for rows older than the cursor. */
export function auditOlderFilter(cursor: AuditCursor): string {
  const at = `"${cursor.createdAt}"`;
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${cursor.id})`;
}

/** Microseconds since the epoch, exactly, for a timestamp the database returned. */
function micros(timestamp: string): bigint {
  const fraction = /\.(\d{1,6})/.exec(timestamp)?.[1] ?? "";
  const seconds = Date.parse(timestamp.replace(/\.\d{1,6}/, "")) / 1000;
  return BigInt(seconds) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
}

/** Whether `row` comes after the cursor in the listing; the same rule as `auditOlderFilter`. */
export function isOlderThan(row: { created_at: string; id: string }, cursor: AuditCursor): boolean {
  const a = micros(row.created_at);
  const b = micros(cursor.createdAt);
  return a < b || (a === b && row.id.toLowerCase() < cursor.id.toLowerCase());
}
