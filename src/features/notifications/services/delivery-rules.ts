/**
 * Who gets email, and when.
 *
 * Pure functions with no I/O, so the rules that decide whether a person is
 * interrupted at 2am are unit-testable and reviewable on their own. The worker
 * calls `decideDelivery` once per queued notification and does exactly what it
 * says.
 *
 * The one rule that overrides everything (NTF-003): security notices and
 * required announcements always deliver. Preferences and quiet hours shape
 * routine mail; they never silence something a person is obliged to see.
 */

export type NotificationUrgency = "low" | "normal" | "high" | "critical";

export interface NotificationForDelivery {
  category: string;
  urgency: NotificationUrgency;
}

export interface DeliveryPreferences {
  email_critical: boolean;
  email_digest: boolean;
  email_assignments: boolean;
  email_mentions: boolean;
  email_announcements: boolean;
  email_due_dates: boolean;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  digest_hour: number;
  timezone: string;
}

export type DeliveryDecision =
  | { action: "send" }
  | { action: "defer"; delaySeconds: number; reason: string }
  | { action: "suppress"; reason: string };

/** Defaults for a person who has never opened the preferences screen. */
export const DEFAULT_PREFERENCES: DeliveryPreferences = {
  email_critical: true,
  email_digest: false,
  email_assignments: true,
  email_mentions: true,
  email_announcements: true,
  email_due_dates: true,
  quiet_hours_start: null,
  quiet_hours_end: null,
  digest_hour: 8,
  timezone: "America/Toronto",
};

/**
 * Categories nobody may opt out of. `security` covers account and access
 * notices; a required announcement is published with `high` or `critical`
 * urgency precisely so it lands here.
 */
export function isMandatory(notification: NotificationForDelivery): boolean {
  if (notification.category === "security") return true;
  if (
    notification.category === "announcement" &&
    (notification.urgency === "critical" || notification.urgency === "high")
  ) {
    return true;
  }
  return false;
}

/** The preference switch that governs a category, if any governs it. */
function switchFor(
  category: string,
): keyof Pick<
  DeliveryPreferences,
  "email_assignments" | "email_mentions" | "email_announcements" | "email_due_dates"
> | null {
  switch (category) {
    case "assignment":
      return "email_assignments";
    case "mention":
    case "reply":
      return "email_mentions";
    case "announcement":
      return "email_announcements";
    case "due_date":
      return "email_due_dates";
    default:
      // approval, system, and anything added later: no dedicated switch, so
      // it is eligible and falls through to the urgency and quiet-hour rules.
      return null;
  }
}

/**
 * Local wall-clock hour and minute for an instant in a named IANA zone.
 * Minutes matter because several zones sit at :30 or :45 offsets, where using
 * the UTC minute would misplace the end of a quiet window by up to 45 minutes.
 */
export function wallClockIn(
  timezone: string,
  at: Date,
): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(at);
    const read = (type: "hour" | "minute") =>
      Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
    // "24" appears for midnight in some ICU versions.
    return { hour: read("hour") % 24, minute: read("minute") };
  } catch {
    // An unknown zone must not stop mail; fall back to UTC.
    return { hour: at.getUTCHours(), minute: at.getUTCMinutes() };
  }
}

/** Local wall-clock hour for an instant in a named IANA zone. */
export function hourIn(timezone: string, at: Date): number {
  return wallClockIn(timezone, at).hour;
}

/**
 * True when `at` falls inside the quiet window. Windows may wrap midnight
 * (22 → 7); a window whose ends are equal covers no time at all rather than
 * the whole day, because a full-day mute is what `email_*` switches are for.
 */
export function inQuietWindow(
  prefs: Pick<DeliveryPreferences, "quiet_hours_start" | "quiet_hours_end" | "timezone">,
  at: Date,
): boolean {
  const { quiet_hours_start: start, quiet_hours_end: end } = prefs;
  if (start === null || end === null || start === end) return false;
  const hour = hourIn(prefs.timezone, at);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Seconds until the quiet window ends, rounded up to the next whole hour. */
export function secondsUntilQuietEnds(
  prefs: Pick<DeliveryPreferences, "quiet_hours_start" | "quiet_hours_end" | "timezone">,
  at: Date,
): number {
  if (!inQuietWindow(prefs, at)) return 0;
  const end = prefs.quiet_hours_end!;
  const { hour, minute } = wallClockIn(prefs.timezone, at);
  const hoursAway = (end - hour + 24) % 24 || 24;
  // Land a minute inside the open window, so a rounding difference between the
  // queue clock and the formatter cannot re-defer the same message forever.
  return Math.max(60, hoursAway * 3600 - minute * 60 + 60);
}

/**
 * The delivery decision for one notification.
 *
 * `deferred` marks a message that has already been held once. A second pass
 * still inside the window extends the hold; it never converts to a drop, which
 * is what makes "defer, don't drop" true across worker restarts.
 */
export function decideDelivery(
  notification: NotificationForDelivery,
  prefs: DeliveryPreferences,
  now: Date,
  recipientEmail: string | null,
): DeliveryDecision {
  if (!recipientEmail || !recipientEmail.includes("@")) {
    return { action: "suppress", reason: "no-email-address" };
  }

  if (isMandatory(notification)) return { action: "send" };

  const key = switchFor(notification.category);
  if (key && !prefs[key]) {
    return { action: "suppress", reason: `preference:${key}` };
  }

  if (notification.urgency === "low" && prefs.email_digest) {
    return { action: "suppress", reason: "low-urgency-digest-only" };
  }

  const urgent = notification.urgency === "critical" || notification.urgency === "high";
  if (urgent && prefs.email_critical) {
    // Explicitly opted in to being reached for urgent work, quiet hours or not.
    return { action: "send" };
  }

  if (inQuietWindow(prefs, now)) {
    return {
      action: "defer",
      delaySeconds: secondsUntilQuietEnds(prefs, now),
      reason: "quiet-hours",
    };
  }

  return { action: "send" };
}

/** True when this tick is the recipient's chosen digest hour. */
export function isDigestHour(prefs: DeliveryPreferences, now: Date): boolean {
  return prefs.email_digest && hourIn(prefs.timezone, now) === prefs.digest_hour;
}

/** Fills gaps in a partial preference row read from the database. */
export function withPreferenceDefaults(
  row: Partial<DeliveryPreferences> | null | undefined,
): DeliveryPreferences {
  return { ...DEFAULT_PREFERENCES, ...(row ?? {}) };
}
