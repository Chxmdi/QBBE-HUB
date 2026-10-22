import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/observability";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { createNotifications, notificationDedupeKey } from "@/features/jobs/services/notify";
import { daysInMonth, nextOccurrence } from "@/features/tasks/recurrence";

/**
 * The next occurrence of a recurring task, created when one is completed
 * (P1-TSK-11). Every path that completes tasks calls this, the drawer's
 * status change and the list's bulk "Completed" alike; before, only the
 * former did, so completing a weekly chore from the bulk bar ended it.
 *
 * Not a "use server" module: callers have already established who is asking
 * and pass their own client, so RLS still decides what may be read and made.
 */

export interface SuccessorActor {
  userId: string;
  organizationId: string;
  displayName: string;
}

/** False only when the read worked and found no active membership. */
async function isActiveMember(db: SupabaseClient, organizationId: string, userId: string): Promise<boolean> {
  const { data, error } = await db
    .from("organization_membership")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  // A failed read is not a departure: keep the assignee, and let the insert
  // (which the database checks again) say so if they really have left.
  if (error) {
    reportError(error, { source: "recurrence", message: "could not check the assignee's membership" });
    return true;
  }
  return Boolean(data);
}

async function translatorFor(db: SupabaseClient, userId: string) {
  const { data } = await db.from("user_profile").select("locale").eq("id", userId).maybeSingle();
  const locale = data?.locale;
  return createTranslator(isLocale(locale) ? locale : DEFAULT_LOCALE);
}

export async function spawnRecurringSuccessor(
  db: SupabaseClient,
  actor: SuccessorActor,
  taskId: string,
): Promise<void> {
  const { data: source } = await db
    .from("task")
    .select("title, description, project_id, program_id, assignee_id, priority, due_at, recurrence_rule, recurrence_anchor, recurrence_parent_id, series_id, series_edited_at")
    .eq("id", taskId)
    .maybeSingle();
  if (!source?.recurrence_rule || !source.due_at) return;

  // A series that has been stopped keeps everything it produced and makes
  // nothing further. Asked before the successor is built rather than after,
  // so a stopped series costs one read and no write.
  let seriesDefinition: { title: string; owner_id: string | null } | null = null;
  if (source.series_id) {
    const { data: series } = await db
      .from("task_series")
      .select("stopped_at, title, owner_id")
      .eq("id", source.series_id as string)
      .maybeSingle();
    if (series?.stopped_at) return;
    if (series) {
      seriesDefinition = { title: series.title as string, owner_id: (series.owner_id as string | null) ?? null };
    }
  }

  // What the next occurrence is built from. Normally it is the task just
  // completed, which carries any correction forward. Once an occurrence has
  // been detached, it is the series' own definition instead, so renaming or
  // reassigning a single week does not rename or reassign every week after it.
  const detached = Boolean(source.series_edited_at) && Boolean(seriesDefinition);
  const title = (detached ? seriesDefinition!.title : source.title) as string;
  let assignee = (detached ? (seriesDefinition!.owner_id ?? source.assignee_id) : source.assignee_id) as string | null;

  // A monthly chain follows its due date, so a rescheduled occurrence carries
  // its new day forward. The one exception is a date the month clamped: an
  // occurrence on the last day of a short month (28 February) whose chain was
  // on a later day (the 31st) goes back to that day next month. Successors
  // carry that day as their anchor; the first task in a chain has none of its
  // own (its anchor is when the repeat was switched on, not a day of month).
  const due = source.due_at as string;
  const [dueYear, dueMonth, dueDay] = due.split("-").map(Number);
  const carried = source.recurrence_parent_id ? (source.recurrence_anchor as string | null) : null;
  const carriedDay = carried ? Number(carried.split("-")[2]) : 0;
  const clamped = dueDay === daysInMonth(dueYear, dueMonth - 1) && carriedDay > dueDay;
  const anchor = clamped ? carried! : due;
  const nextDue = nextOccurrence(source.recurrence_rule as string, due, anchor);

  // The person it was going to may have left. The database refuses a task for
  // an inactive member, which used to end the series with nobody told. It goes
  // to the series owner instead when they are active, or to nobody.
  let fallback: "owner" | "unassigned" | null = null;
  if (assignee && !(await isActiveMember(db, actor.organizationId, assignee))) {
    const owner = seriesDefinition?.owner_id ?? null;
    if (owner && owner !== assignee && (await isActiveMember(db, actor.organizationId, owner))) {
      assignee = owner;
      fallback = "owner";
    } else {
      assignee = null;
      fallback = "unassigned";
    }
  }

  // `recurrence_parent_id` is uniquely indexed, so a concurrent second
  // completion loses the race rather than creating a twin.
  const { data: created, error } = await db
    .from("task")
    .insert({
      organization_id: actor.organizationId,
      program_id: source.program_id,
      project_id: source.project_id,
      title,
      description: source.description,
      priority: source.priority,
      assignee_id: assignee,
      requester_id: actor.userId,
      due_at: nextDue,
      created_by: actor.userId,
      status: "not_started",
      recurrence_rule: source.recurrence_rule,
      recurrence_anchor: anchor,
      recurrence_parent_id: taskId,
      ...(source.series_id ? { series_id: source.series_id, occurrence_date: nextDue } : {}),
    })
    .select("id")
    .maybeSingle();
  // 23505: the successor already exists, which is the outcome wanted.
  if (error) {
    if (error.code !== "23505") {
      reportError(error, { source: "recurrence", taskId, message: "could not spawn the next occurrence" });
    }
    return;
  }
  if (!fallback || !created) return;

  // Somebody has to know the next one did not go to the usual person: the new
  // assignee (the series owner), or the person who completed this one when it
  // went to nobody.
  const nextId = created.id as string;
  const recipient = fallback === "owner" ? assignee! : actor.userId;
  const t = await translatorFor(db, recipient);
  await createNotifications(db, [
    {
      user_id: recipient,
      organization_id: actor.organizationId,
      category: "assignment",
      title: t(fallback === "owner" ? "tasks.notify.recurringToOwner" : "tasks.notify.recurringUnassigned", { title }),
      body: title,
      source_type: "task",
      source_id: nextId,
      link: `/my-work?task=${nextId}`,
      reason: "recurrence",
      context: title,
      owner_label: actor.displayName,
      due_on: nextDue,
      project_id: (source.project_id as string | null) ?? null,
      dedupe_key: notificationDedupeKey("task", nextId, recipient),
    },
  ]);
}
