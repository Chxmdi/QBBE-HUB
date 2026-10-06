/** Which list a task sits in on the phone, by its due date and today's date (both YYYY-MM-DD). */
export type DueGroup = "overdue" | "today" | "week" | "later" | "none";

export function dueGroup(dueOn: string | null, today: string): DueGroup {
  if (!dueOn) return "none";
  if (dueOn < today) return "overdue";
  if (dueOn === today) return "today";
  const inAWeek = new Date(`${today}T00:00:00Z`);
  inAWeek.setUTCDate(inAWeek.getUTCDate() + 7);
  return dueOn <= inAWeek.toISOString().slice(0, 10) ? "week" : "later";
}

/** Tasks bucketed in display order; "today" joins the next-7-days list. */
export function groupTasks<T extends { dueOn: string | null }>(tasks: T[], today: string) {
  const groups: Record<"overdue" | "week" | "later" | "none", T[]> = { overdue: [], week: [], later: [], none: [] };
  for (const task of tasks) {
    const group = dueGroup(task.dueOn, today);
    groups[group === "today" ? "week" : group].push(task);
  }
  for (const list of Object.values(groups)) list.sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
  return groups;
}
