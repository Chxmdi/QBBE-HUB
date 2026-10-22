import { daysInMonth } from "@/features/tasks/recurrence";

/**
 * The start of occurrence `index` (0-based) of a repeating meeting, in
 * wall-clock terms (the caller turns it into an instant in the workspace's
 * zone). Monthly occurrences are counted from the first one and keep its day
 * of month, landing on the last day of a shorter month: a meeting on 31
 * January is on 28 February and 31 March, not 3 March twice.
 */
export function occurrenceStart(
  first: Date,
  repeat: "weekly" | "fortnightly" | "monthly",
  index: number,
): Date {
  const next = new Date(first.getTime());
  if (repeat === "monthly") {
    const day = first.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(first.getUTCMonth() + index);
    next.setUTCDate(Math.min(day, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())));
  } else {
    next.setUTCDate(next.getUTCDate() + index * (repeat === "weekly" ? 7 : 14));
  }
  return next;
}
