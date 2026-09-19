import { addCalendarDays } from "@/lib/time";

export type TemplateItem = {
  kind: "milestone" | "task";
  name: string;
  description: string | null;
  day_offset: number | null;
  sort_key: number;
};

export type PlannedItem = {
  kind: "milestone" | "task";
  name: string;
  description: string | null;
  /** A calendar date (YYYY-MM-DD), or null when the template set no offset. */
  dueDate: string | null;
  sortKey: number;
};

/**
 * Turn a project template's items into dated work, relative to the day the
 * template is expanded.
 *
 * A template cannot store a real date — it is reused, so a stored date would
 * be the date of whoever used it first. It stores a day offset, and the offset
 * becomes a date here.
 *
 * `startDate` is a bare calendar date and stays one. `milestone.due_date` and
 * `task.due_at` are `date` columns, so putting an instant through `new Date()`
 * would read it as UTC midnight and land the work a day early for anyone west
 * of Greenwich. addCalendarDays does the arithmetic on the date string itself.
 */
export function planTemplateItems(
  items: TemplateItem[],
  startDate: string,
): PlannedItem[] {
  return [...items]
    .sort((a, b) => a.sort_key - b.sort_key || a.name.localeCompare(b.name))
    .map((item) => ({
      kind: item.kind,
      name: item.name,
      description: item.description,
      dueDate:
        item.day_offset === null ? null : addCalendarDays(startDate, item.day_offset),
      sortKey: item.sort_key,
    }));
}
