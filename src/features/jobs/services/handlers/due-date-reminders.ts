import { createNotifications, type NotificationDraft } from "../notify";
import type { JobContext, JobResult } from "../runner";

/**
 * Tells assignees about work that is due, or overdue.
 *
 * Covers assigned tasks and open CRM follow-ups: both are dated commitments a
 * person owns, and both go quiet in exactly the same way.
 *
 * Read in two windows — work due soon, and work already overdue — each with its
 * own budget. One window ordered by due date would let a backlog of stale
 * overdue tasks consume the whole batch and silence every "due today" reminder,
 * in every organization at once, with nothing on the run to say so.
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

  // Two windows, not one, and the reason is the whole point of this section.
  //
  // A single query bounded only above (`due_at <= horizon`) and ordered by due
  // date puts every overdue task ahead of everything due today. Once an
  // organization accumulates more open overdue work than one batch, the batch
  // is consumed entirely by the oldest of it and no "due today" reminder is
  // ever sent again — to anyone, in any organization, because the batch is
  // global. Nothing surfaces: the run succeeds, the counts look plausible, and
  // the reminders people rely on quietly stop.
  //
  // So the soon-due window gets its own budget that a backlog cannot reach
  // into. A day either side of "now" covers today and tomorrow in every zone.
  const nowDate = now.toISOString().slice(0, 10);
  const soonFloor = addDays(nowDate, -1);
  const horizon = addDays(nowDate, 2);

  const [
    { data: soonTaskRows, error },
    { data: overdueTaskRows, error: overdueError },
  ] = await Promise.all([
    db
      .from("task")
      .select("id, organization_id, title, due_at, assignee_id, priority")
      .in("status", OPEN_STATUSES)
      .not("assignee_id", "is", null)
      .not("due_at", "is", null)
      .is("archived_at", null)
      .gte("due_at", soonFloor)
      .lte("due_at", horizon)
      .order("due_at", { ascending: true })
      .limit(definition.batch_size),
    // Most recently overdue first. If this window is capped, the work dropped
    // should be the months-old kind nobody is going to action today, not the
    // task that slipped yesterday.
    db
      .from("task")
      .select("id, organization_id, title, due_at, assignee_id, priority")
      .in("status", OPEN_STATUSES)
      .not("assignee_id", "is", null)
      .not("due_at", "is", null)
      .is("archived_at", null)
      .lt("due_at", soonFloor)
      .order("due_at", { ascending: false })
      .limit(definition.batch_size),
  ]);

  if (error) throw new Error(`could not load due tasks: ${error.message}`);
  if (overdueError) {
    throw new Error(`could not load overdue tasks: ${overdueError.message}`);
  }

  const taskRows = [...(soonTaskRows ?? []), ...(overdueTaskRows ?? [])];
  const overdueTruncated = (overdueTaskRows ?? []).length >= definition.batch_size;
  const soonTruncated = (soonTaskRows ?? []).length >= definition.batch_size;

  const drafts: NotificationDraft[] = [];

  for (const task of taskRows as unknown as TaskRow[]) {
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
  const [
    { data: soonFollowUps, error: followUpError },
    { data: overdueFollowUps, error: overdueFollowUpError },
  ] = await Promise.all([
    db
      .from("crm_follow_up")
      .select("id, organization_id, title, due_at, owner_id")
      .eq("status", "open")
      .not("owner_id", "is", null)
      .not("due_at", "is", null)
      .gte("due_at", soonFloor)
      .lte("due_at", horizon)
      .order("due_at", { ascending: true })
      .limit(definition.batch_size),
    db
      .from("crm_follow_up")
      .select("id, organization_id, title, due_at, owner_id")
      .eq("status", "open")
      .not("owner_id", "is", null)
      .not("due_at", "is", null)
      .lt("due_at", soonFloor)
      .order("due_at", { ascending: false })
      .limit(definition.batch_size),
  ]);

  if (followUpError) {
    throw new Error(`could not load follow-ups: ${followUpError.message}`);
  }
  if (overdueFollowUpError) {
    throw new Error(
      `could not load overdue follow-ups: ${overdueFollowUpError.message}`,
    );
  }

  const followUpRows = [...(soonFollowUps ?? []), ...(overdueFollowUps ?? [])];
  const overdueFollowUpsTruncated =
    (overdueFollowUps ?? []).length >= definition.batch_size;
  const soonFollowUpsTruncated =
    (soonFollowUps ?? []).length >= definition.batch_size;

  for (const followUp of followUpRows as unknown as FollowUpRow[]) {
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
      tasksScanned: taskRows.length,
      followUpsScanned: followUpRows.length,
      candidates: drafts.length,
      // A cap nobody can see is how a backlog stays invisible. If any of these
      // is true the run did not look at everything it was meant to, and the
      // batch size or the backlog needs attention.
      overdueTruncated,
      soonTruncated,
      overdueFollowUpsTruncated,
      soonFollowUpsTruncated,
    },
  };
}
