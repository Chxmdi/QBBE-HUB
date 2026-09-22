"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { readAll } from "@/lib/supabase/read-all";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calendarDateInZone } from "@/lib/time";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  circularMilestoneDependencyError,
  milestoneDependencySchema,
  rescheduleSchema,
  taskSeriesSchema,
} from "@/features/tasks/schemas";

/**
 * Advanced planning commands (#31).
 *
 * Milestone dependencies, recurring series and calendar rescheduling. Each one
 * has a database rule behind it — a cycle trigger, a unique index, a policy —
 * and the checks here exist to produce a readable message, not to be the
 * guarantee. Anything that must hold under two concurrent callers is stated in
 * `20260921170000_planning_dependencies_and_series.sql`.
 */

// ---------------------------------------------------------------------------
// Milestone dependencies (P1-TSK-09)
// ---------------------------------------------------------------------------

export async function addMilestoneDependency(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = milestoneDependencySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick two valid milestones." };
  const { blockingMilestoneId, blockedMilestoneId } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await readAll(
    supabase
      .from("milestone_dependency")
      .select("blocking_milestone_id, blocked_milestone_id")
      .order("blocked_milestone_id"),
    "blocking_milestone_id",
  );
  if (readError) return { ok: false, error: "Could not check dependencies. Please retry." };

  // The readable answer, from the edges this person is allowed to see. The
  // trigger repeats the walk over the whole graph, including edges hidden by
  // policy, so a cycle through a project the caller cannot open is still
  // refused — just with the generic message below.
  const cycle = circularMilestoneDependencyError(
    blockingMilestoneId,
    blockedMilestoneId,
    (existing ?? []) as { blocking_milestone_id: string; blocked_milestone_id: string }[],
  );
  if (cycle) return { ok: false, error: cycle };

  const { error } = await supabase.from("milestone_dependency").insert({
    blocking_milestone_id: blockingMilestoneId,
    blocked_milestone_id: blockedMilestoneId,
  });
  // Adding an edge that is already there is what the person asked for.
  if (error?.code === "23505") return { ok: true };
  if (error?.code === "23514") return { ok: false, error: "That dependency would create a cycle." };
  if (error) return { ok: false, error: "Could not save the dependency." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeMilestoneDependency(
  blockingMilestoneId: string,
  blockedMilestoneId: string,
): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("milestone_dependency")
    .delete()
    .eq("blocking_milestone_id", blockingMilestoneId)
    .eq("blocked_milestone_id", blockedMilestoneId);
  if (error) return { ok: false, error: "Could not remove the dependency." };
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recurring series (P1-TSK-11)
// ---------------------------------------------------------------------------

export async function createTaskSeries(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = taskSeriesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid series." };
  }
  const { title, projectId, recurrenceRule, ownerId } = parsed.data;
  const supabase = await createSupabaseServerClient();

  // The anchor is the workspace's today, not the server's. A series anchored a
  // day late recurs on the wrong weekday for as long as it lives, which is the
  // same reasoning `setTaskRecurrence` records.
  const anchor =
    calendarDateInZone(new Date(), session.timeZone) ?? new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("task_series")
    .insert({
      organization_id: session.organizationId,
      project_id: projectId ?? null,
      title,
      recurrence_rule: recurrenceRule,
      recurrence_anchor: anchor,
      owner_id: ownerId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not create the recurring task." };

  // The first occurrence, so a new series is visible as work rather than as a
  // setting that will produce work later.
  const { error: occurrenceError } = await supabase.from("task").insert({
    organization_id: session.organizationId,
    project_id: projectId ?? null,
    title,
    assignee_id: ownerId,
    due_at: anchor,
    series_id: data.id as string,
    occurrence_date: anchor,
  });
  if (occurrenceError) {
    // Leave no series that produces nothing: a row with no occurrence looks
    // like a recurrence that silently stopped.
    await supabase.from("task_series").delete().eq("id", data.id as string);
    return { ok: false, error: "Could not create the recurring task." };
  }

  revalidatePath("/", "layout");
  return { ok: true, id: data.id as string };
}

/**
 * Stop a series without touching what it already produced.
 *
 * Occurrences that exist are real work somebody may have done, so this sets an
 * end date rather than deleting rows. `stopped_at` is what a generator reads
 * before creating the next occurrence.
 */
export async function stopTaskSeries(seriesId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("task_series")
    .update({ stopped_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", seriesId)
    .is("stopped_at", null)
    .select("id");
  if (error) return { ok: false, error: "Could not stop the recurring task." };
  // Already stopped, or not this caller's to stop. Both are "nothing changed",
  // and the policy has already decided which.
  if (!data?.length) return { ok: true };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Detach one occurrence from its series (P1-TSK-11, "safe edited occurrences").
 *
 * Marking rather than copying: the occurrence keeps its id, its history and
 * anything linked to it, and simply stops being a row a regenerating job may
 * overwrite. The date pairing constraint means `series_id` and
 * `occurrence_date` have to be cleared together.
 */
export async function detachSeriesOccurrence(taskId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("task")
    .update({ series_edited_at: new Date().toISOString() })
    .eq("id", taskId)
    .not("series_id", "is", null)
    .select("id");
  if (error) return { ok: false, error: "Could not update this occurrence." };
  if (!data?.length) return { ok: false, error: "That task is not part of a series." };
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Calendar rescheduling (P1-TSK-12)
// ---------------------------------------------------------------------------

/**
 * Move a task or milestone to a calendar date.
 *
 * Authorization is not re-derived here. `task.due_at` and `milestone.due_date`
 * are both guarded by update policies that already know who may change them,
 * so an unauthorized drag updates nothing; asking for the row back is how that
 * is told apart from a successful write.
 *
 * Both columns are `date`, so nothing here converts an instant. That is the
 * point: a calendar drag names a day, and turning it into a timestamp and back
 * is what puts a task on the wrong side of midnight for half the world.
 */
export async function rescheduleCalendarItem(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid date." };
  }
  const { kind, id, date } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const table = kind === "task" ? "task" : "milestone";
  const column = kind === "task" ? "due_at" : "due_date";

  const { data, error } = await supabase
    .from(table)
    .update({ [column]: date })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: "Could not move that item." };
  if (!data?.length) {
    return { ok: false, error: "You do not have permission to reschedule that item." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
