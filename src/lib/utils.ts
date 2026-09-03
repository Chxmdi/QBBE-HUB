import { clsx, type ClassValue } from "clsx";
import { DEFAULT_TIME_ZONE, formatInZone } from "@/lib/time";
import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isThisWeek,
  isToday,
  isTomorrow,
  parseISO,
} from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function relativeTime(iso: string): string {
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

/**
 * These render in the organization's zone, not the runtime's.
 *
 * They used to call date-fns `format` with no zone, which resolves in whatever
 * zone the process is in — UTC on the server. That was invisible only because
 * the scheduling path had the mirror-image defect and the two cancelled out.
 * With input now read as wall time in the organization's zone, display has to
 * move with it or every existing meeting would appear to jump by the server's
 * offset.
 *
 * The zone is a parameter so a caller holding the real `organization.timezone`
 * can pass it; the default matches that column's own default, which is a
 * better fallback than the server's zone under any circumstances.
 */
export function formatDate(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return formatInZone(iso, timeZone, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  if (!iso) return "—";
  const day = formatInZone(iso, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (day === "—") return "—";
  const time = formatInZone(iso, timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${day} · ${time}`;
}

export function formatTime(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  if (!iso) return "";
  const shown = formatInZone(iso, timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return shown === "—" ? "" : shown;
}

/** Human due-date label with overdue awareness. */
export function dueLabel(iso: string | null | undefined): {
  label: string;
  tone: "danger" | "warning" | "muted";
} {
  if (!iso) return { label: "No due date", tone: "muted" };
  const date = parseISO(iso);
  const days = differenceInCalendarDays(date, new Date());
  if (days < 0)
    return {
      label: `Overdue ${Math.abs(days)}d`,
      tone: "danger",
    };
  if (isToday(date)) return { label: "Due today", tone: "warning" };
  if (isTomorrow(date)) return { label: "Due tomorrow", tone: "warning" };
  if (isThisWeek(date, { weekStartsOn: 1 }))
    return { label: format(date, "EEEE"), tone: "muted" };
  return { label: format(date, "MMM d"), tone: "muted" };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Groups My Work items by urgency buckets (P0-TSK-04). */
export function myWorkBucket(
  dueAt: string | null,
): "overdue" | "today" | "this_week" | "later" {
  if (!dueAt) return "later";
  const date = parseISO(dueAt);
  const days = differenceInCalendarDays(date, new Date());
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (isThisWeek(date, { weekStartsOn: 1 })) return "this_week";
  return "later";
}
