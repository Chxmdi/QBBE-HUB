import { clsx, type ClassValue } from "clsx";
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

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "EEE, MMM d · h:mm a");
  } catch {
    return "—";
  }
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "h:mm a");
  } catch {
    return "";
  }
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
