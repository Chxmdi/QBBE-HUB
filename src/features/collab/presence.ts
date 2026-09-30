/**
 * Presence rules shared by the server and the browser (V1-17).
 */

/** How often an open page says "still here". */
export const HEARTBEAT_MS = 10_000;
/** Matches object_presence_read: older rows count as gone. */
export const PRESENCE_TTL_MS = 60_000;
/** Cursor moves are sent at most this often. */
export const CURSOR_THROTTLE_MS = 1_000;

export interface PresenceCursor {
  blockId: string;
  offset: number;
  length?: number;
}

export interface PresenceEntry {
  userId: string;
  name: string;
  editing: boolean;
  cursor: PresenceCursor | null;
  updatedAt: string;
}

/** Initials for an avatar: first letters of the first and last words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * Who to show: fresh rows only, the reader first, then editors, then by
 * name, so the list does not jump around as heartbeats arrive.
 */
export function orderPresence(entries: PresenceEntry[], me: string, now: Date = new Date()): PresenceEntry[] {
  return entries
    .filter((entry) => now.getTime() - new Date(entry.updatedAt).getTime() < PRESENCE_TTL_MS)
    .sort((a, b) => {
      if (a.userId === me) return -1;
      if (b.userId === me) return 1;
      if (a.editing !== b.editing) return a.editing ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function isCursor(value: unknown): value is PresenceCursor {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Record<string, unknown>;
  return (
    typeof cursor.blockId === "string" &&
    cursor.blockId.length <= 200 &&
    Number.isInteger(cursor.offset) &&
    (cursor.offset as number) >= 0 &&
    (cursor.length === undefined || (Number.isInteger(cursor.length) && (cursor.length as number) >= 0))
  );
}

/** A throttle that always delivers the last value. */
export function createThrottle<T>(
  send: (value: T) => void,
  ms: number,
  timers: { now: () => number; set: (fn: () => void, ms: number) => unknown } = {
    now: () => Date.now(),
    set: (fn, wait) => setTimeout(fn, wait),
  },
) {
  let last = -Infinity;
  let pending: { value: T } | null = null;
  let scheduled = false;
  return (value: T) => {
    const now = timers.now();
    if (now - last >= ms && !scheduled) {
      last = now;
      send(value);
      return;
    }
    pending = { value };
    if (scheduled) return;
    scheduled = true;
    timers.set(() => {
      scheduled = false;
      last = timers.now();
      if (pending) send(pending.value);
      pending = null;
    }, Math.max(0, ms - (now - last)));
  };
}
