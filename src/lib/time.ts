/**
 * Wall-clock time in a named zone, converted honestly.
 *
 * A `datetime-local` input yields a string with no offset — "2026-09-03T14:00"
 * — and `new Date()` resolves that in whatever zone the *runtime* happens to
 * be in. In production that is UTC. So a person in Montreal typing 14:00
 * produced an instant four hours earlier than they meant, and the wrong
 * instant is what went to Google Calendar and what bucketed the day on the
 * calendar grid.
 *
 * It looked correct in the Hub because display had the same defect in the
 * opposite direction: rendered in the server's zone, the stored instant read
 * back as 14:00. The two errors cancelled for anyone who never left the page.
 * That is why this needs fixing on both sides at once — correcting input alone
 * would make every existing meeting appear to jump.
 *
 * No dependency is added. `Intl` already knows every zone's offset including
 * its DST history, which is the only hard part.
 */

/**
 * The organization's zone, matching `organization.timezone`'s column default.
 * Callers that have the real row should pass it; this is the fallback so a
 * missing value degrades to the workspace default rather than to the server's
 * zone, which is the bug this module exists to remove.
 */
export const DEFAULT_TIME_ZONE = "America/Toronto";

/** Milliseconds that `timeZone` is ahead of UTC at a given instant. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const at: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") at[part.type] = Number(part.value);
  }

  // Some locales render midnight as hour 24; Date.UTC would roll that into the
  // next day and put the offset out by a day.
  const asUtc = Date.UTC(
    at.year,
    at.month - 1,
    at.day,
    at.hour % 24,
    at.minute,
    at.second,
  );
  return asUtc - instant.getTime();
}

/**
 * Reads a `datetime-local` value as wall-clock time in `timeZone`.
 *
 * Returns null for anything unparseable so callers can report a bad input
 * rather than store an Invalid Date.
 */
export function wallTimeToInstant(
  wall: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(wall.trim())) return null;
  const naive = Date.parse(`${wall.trim()}Z`);
  if (Number.isNaN(naive)) return null;

  // Guess using the offset at the naive instant, then correct once. The second
  // pass matters within a DST transition, where the offset an hour before the
  // answer differs from the offset at the answer itself.
  const firstGuess = new Date(naive - offsetAt(new Date(naive), timeZone));
  const corrected = new Date(naive - offsetAt(firstGuess, timeZone));
  return Number.isNaN(corrected.getTime()) ? null : corrected;
}

/** The `datetime-local` value that shows `iso` as wall time in `timeZone`. */
export function instantToWallTime(
  iso: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  const shifted = new Date(instant.getTime() + offsetAt(instant, timeZone));
  return shifted.toISOString().slice(0, 16);
}

/** Formats an instant for display in a named zone. */
export function formatInZone(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!iso) return "—";
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, ...options }).format(instant);
  } catch {
    return "—";
  }
}

/**
 * The calendar date (YYYY-MM-DD) a value falls on in `timeZone`.
 *
 * A bare `YYYY-MM-DD` is returned unchanged, and that distinction matters:
 * `task.due_at` is a `date` column, so "2026-09-05" already *is* a calendar
 * date with no zone attached. Passing it through `new Date()` would read it as
 * UTC midnight, which in Toronto is the evening of the 4th — moving every task
 * due date a day earlier. Only genuine instants (`timestamptz` values such as
 * `meeting.starts_at`) need converting.
 */
export function calendarDateInZone(
  iso: string | Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): string | null {
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) {
    return iso.trim();
  }
  const instant = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(instant.getTime())) return null;
  try {
    // en-CA formats as YYYY-MM-DD, which sorts and subtracts cleanly.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return null;
  }
}

export interface ZonedDueInfo {
  /** Whole calendar days from today to the due date, negative when overdue. */
  days: number;
  /** True when the date falls later in the current Monday-start week. */
  withinThisWeek: boolean;
}

/**
 * Due-date arithmetic done in one zone, wherever it runs.
 *
 * "Overdue" is a question about calendar days, not elapsed hours, so it has to
 * be answered in a specific zone or the answer changes with the answerer. This
 * previously ran twice against two different clocks — the grouping in a server
 * component against the host's UTC, the row label in a client component
 * against the browser's — so a Montreal user after 19:00 saw a task filed under
 * "Overdue" whose own label read "Due today". Both now ask this.
 */
export function zonedDueInfo(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
  now: Date = new Date(),
): ZonedDueInfo | null {
  if (!iso) return null;
  const due = calendarDateInZone(iso, timeZone);
  const today = calendarDateInZone(now, timeZone);
  if (!due || !today) return null;

  const days = Math.round(
    (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );

  // Monday-start week, matching the previous `isThisWeek({ weekStartsOn: 1 })`.
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(now);
  const mondayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekdayName);
  const daysLeftInWeek = mondayIndex < 0 ? 6 : 6 - mondayIndex;

  return { days, withinThisWeek: days > 0 && days <= daysLeftInWeek };
}
