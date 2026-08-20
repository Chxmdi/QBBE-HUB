import { createNotifications, type NotificationDraft } from "../notify";
import type { JobContext, JobResult } from "../runner";

/**
 * Tells assignees about work that is due, or overdue.
 *
 * Covers assigned tasks and open CRM follow-ups: both are dated commitments a
 * person owns, and both go quiet in exactly the same way.
 *
 * One reminder per record per state per day. The state is part of the dedupe key,
 * so a task that slips from "due today" to "overdue" produces a second, honest
 * reminder rather than going quiet — but an overdue task does not re-nudge
 * every day forever either: the key includes the date, so the reminder repeats
 * daily while the work stays overdue, which is the intended pressure.
 */

const OPEN_STATUSES = ["not_started", "ready", "in_progress", "waiting", "blocked", "in_review"];

interface FollowUpRow {
  id: string;
  organization_id: string;
  title: string;
  due_at: string;
  owner_id: string;
}

interface TaskRow {
  id: string;
  organization_id: string;
  title: string;
  due_at: string;
  assignee_id: string;
  priority: string;
}

/** Calendar date in the organization's zone, which is what "due today" means. */
function dateInZone(timezone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function dueDateReminders({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const { data: organizations } = await db
    .from("organization")
    .select("id, timezone");

  const zones = new Map(
    ((organizations ?? []) as { id: string; timezone: string | null }[]).map((row) => [
      row.id,
      row.timezone || "America/Toronto",
    ]),
  );

  // One window covers every zone: nothing due more than a day either side of
  // "now" can be today, tomorrow, or newly overdue anywhere.
  const horizon = addDays(now.toISOString().slice(0, 10), 2);

  const { data: taskRows, error } = await db
    .from("task")
    .select("id, organization_id, title, due_at, assignee_id, priority")
    .in("status", OPEN_STATUSES)
    .not("assignee_id", "is", null)
    .not("due_at", "is", null)
    .is("archived_at", null)
    .lte("due_at", horizon)
    .order("due_at", { ascending: true })
    .limit(definition.batch_size);

  if (error) throw new Error(`could not load due tasks: ${error.message}`);

  const drafts: NotificationDraft[] = [];

  for (const task of (taskRows ?? []) as unknown as TaskRow[]) {
    const zone = zones.get(task.organization_id) ?? "America/Toronto";
    const today = dateInZone(zone, now);
    const due = task.due_at.slice(0, 10);

    let state: "overdue" | "today" | "tomorrow" | null = null;
    if (due < today) state = "overdue";
    else if (due === today) state = "today";
    else if (due === addDays(today, 1)) state = "tomorrow";
    if (!state) continue;

    const label =
      state === "overdue"
        ? "Overdue"
        : state === "today"
          ? "Due today"
          : "Due tomorrow";

    drafts.push({
      user_id: task.assignee_id,
      organization_id: task.organization_id,
      category: "due_date",
      title: `${label}: ${task.title}`,
      body:
        state === "overdue"
          ? `This was due ${due}. Update the due date or move it forward.`
          : `Due ${due}.`,
      source_type: "task",
      source_id: task.id,
      link: `/my-work?task=${task.id}`,
      urgency:
        state === "overdue" || task.priority === "critical" ? "high" : "normal",
      dedupe_key: `due:${task.id}:${state}:${today}`,
    });
  }

  // Open CRM follow-ups are the same promise in a different table.
  const { data: followUpRows, error: followUpError } = await db
    .from("crm_follow_up")
    .select("id, organization_id, title, due_at, owner_id")
    .eq("status", "open")
    .not("owner_id", "is", null)
    .not("due_at", "is", null)
    .lte("due_at", horizon)
    .order("due_at", { ascending: true })
    .limit(definition.batch_size);

  if (followUpError) {
    throw new Error(`could not load follow-ups: ${followUpError.message}`);
  }

  for (const followUp of (followUpRows ?? []) as unknown as FollowUpRow[]) {
    const zone = zones.get(followUp.organization_id) ?? "America/Toronto";
    const today = dateInZone(zone, now);
    const due = followUp.due_at.slice(0, 10);

    let state: "overdue" | "today" | "tomorrow" | null = null;
    if (due < today) state = "overdue";
    else if (due === today) state = "today";
    else if (due === addDays(today, 1)) state = "tomorrow";
    if (!state) continue;

    drafts.push({
      user_id: followUp.owner_id,
      organization_id: followUp.organization_id,
      category: "due_date",
      title: `${state === "overdue" ? "Overdue follow-up" : "Follow-up due"}: ${followUp.title}`,
      body: `Due ${due}.`,
      source_type: "crm_follow_up",
      source_id: followUp.id,
      link: "/crm",
      urgency: state === "overdue" ? "high" : "normal",
      dedupe_key: `follow-up:${followUp.id}:${state}:${today}`,
    });
  }

  const created = await createNotifications(db, drafts);

  return {
    processed: created,
    failed: 0,
    metadata: {
      tasksScanned: (taskRows ?? []).length,
      followUpsScanned: (followUpRows ?? []).length,
      candidates: drafts.length,
    },
  };
}
