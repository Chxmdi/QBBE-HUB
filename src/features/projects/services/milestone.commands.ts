"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasProjectCapability } from "@/lib/access-capabilities";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calendarDateInZone } from "@/lib/time";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  compareMilestones,
  completeMilestoneSchema,
  createMilestoneSchema,
  reorderMilestoneSchema,
  updateMilestoneSchema,
} from "@/features/projects/schemas";

/**
 * Milestone writes.
 *
 * Two rules live here rather than in the database, and for opposite reasons:
 *
 *   - **Evidence to complete** is enforced in both places. The constraint is
 *     the boundary; this copy exists so somebody reads "say what shows this
 *     was met" instead of `completed_milestones_show_their_work`.
 *   - **`missed` needs a target date that has actually passed** is enforced
 *     only here, because "has it passed" is a question about the
 *     organization's calendar and the database only has the server's.
 */

async function loadMilestone(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  milestoneId: string,
) {
  const { data } = await supabase
    .from("milestone")
    .select("id, project_id, name, due_date, status, completed_at, sort_key")
    .eq("id", milestoneId)
    .maybeSingle();
  return data as {
    id: string;
    project_id: string;
    name: string;
    due_date: string | null;
    status: string;
    completed_at: string | null;
    sort_key: number;
  } | null;
}

export async function createMilestone(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = createMilestoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { projectId, name, description, ownerId, dueDate, status } = parsed.data;
  const supabase = await createSupabaseServerClient();
  if (!(await hasProjectCapability(supabase, projectId, "manage"))) {
    return { ok: false, error: "You cannot add milestones to this project." };
  }

  const { data: row, error } = await supabase
    .from("milestone")
    .insert({
      project_id: projectId,
      name,
      description: description || null,
      owner_id: ownerId || null,
      due_date: dueDate || null,
      status,
    })
    .select("id")
    .single();

  if (error || !row) {
    return { ok: false, error: "Could not create the milestone." };
  }

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "created",
    source_type: "milestone",
    source_id: row.id,
    project_id: projectId,
    summary: `added milestone “${name}”`,
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/calendar");
  return { ok: true, id: row.id as string };
}

/**
 * Completing or reopening a milestone.
 *
 * Completing requires evidence. Reopening clears it, because evidence that
 * outlives the completion it was offered for is evidence for nothing — and it
 * would satisfy the constraint on the next completion without anybody having
 * looked at it.
 */
export async function completeMilestone(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = completeMilestoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { milestoneId, completed, evidence } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const current = await loadMilestone(supabase, milestoneId);
  if (!current) return { ok: false, error: "Milestone not found." };
  if (!(await hasProjectCapability(supabase, current.project_id, "manage"))) {
    return { ok: false, error: "You cannot update this milestone." };
  }

  if (completed && current.completed_at) {
    return { ok: true, id: milestoneId };
  }

  // The trigger keeps `status` in step, so only one of the pair is written.
  const { error } = await supabase
    .from("milestone")
    .update(
      completed
        ? { completed_at: new Date().toISOString(), evidence: evidence ?? null }
        : { completed_at: null, evidence: null },
    )
    .eq("id", milestoneId);
  if (error) return { ok: false, error: "Could not update the milestone." };

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: completed ? "completed" : "reopened",
    source_type: "milestone",
    source_id: milestoneId,
    project_id: current.project_id,
    summary: `${completed ? "completed" : "reopened"} milestone “${current.name}”`,
  });

  revalidatePath(`/projects/${current.project_id}`);
  revalidatePath("/calendar");
  return { ok: true };
}

export async function updateMilestone(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = updateMilestoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { milestoneId, name, description, ownerId, dueDate, status, evidence } =
    parsed.data;

  const supabase = await createSupabaseServerClient();
  const existing = await loadMilestone(supabase, milestoneId);
  if (!existing) return { ok: false, error: "Milestone not found." };
  if (!(await hasProjectCapability(supabase, existing.project_id, "manage"))) {
    return { ok: false, error: "You cannot update this milestone." };
  }

  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description || null;
  if (ownerId !== undefined) patch.owner_id = ownerId || null;
  if (dueDate !== undefined) patch.due_date = dueDate || null;
  if (evidence !== undefined) patch.evidence = evidence || null;

  if (status !== undefined) {
    // The edit schema cannot express `completed`, so any status here on an
    // already-completed milestone is an attempt to reopen it. That goes
    // through completeMilestone, which clears the evidence, rather than
    // happening as a side effect of an edit somebody made for the name.
    if (existing.completed_at) {
      return {
        ok: false,
        error: "Reopen the milestone first — that also clears its completion evidence.",
      };
    }
    if (status === "missed") {
      const due = dueDate !== undefined ? dueDate || null : existing.due_date;
      const today = calendarDateInZone(new Date(), session.timeZone);
      if (!due || !today || due >= today) {
        return {
          ok: false,
          error: "Only a milestone whose target date has passed can be marked missed.",
        };
      }
    }
    patch.status = status;
  }

  if (Object.keys(patch).length === 0) return { ok: true, id: milestoneId };

  const { data: row, error } = await supabase
    .from("milestone")
    .update(patch)
    .eq("id", milestoneId)
    .select("id, project_id")
    .maybeSingle();
  if (error || !row) return { ok: false, error: "Could not update the milestone." };

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "updated",
    source_type: "milestone",
    source_id: milestoneId,
    project_id: existing.project_id,
    summary: `updated milestone “${name ?? existing.name}”`,
    metadata: { fields: Object.keys(patch) },
  });

  revalidatePath(`/projects/${row.project_id}`);
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteMilestone(milestoneId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const existing = await loadMilestone(supabase, milestoneId);
  if (!existing) return { ok: false, error: "Milestone not found." };
  if (!(await hasProjectCapability(supabase, existing.project_id, "manage"))) {
    return { ok: false, error: "You cannot delete this milestone." };
  }

  // `task.milestone_id` is ON DELETE SET NULL, so the work survives and loses
  // only its grouping. Saying so is the difference between a deliberate delete
  // and one somebody regrets.
  const { data: deleted, error } = await supabase
    .from("milestone")
    .delete()
    .eq("id", milestoneId)
    .select("id");
  if (error || (deleted ?? []).length === 0) {
    return { ok: false, error: "Could not delete the milestone." };
  }

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "deleted",
    source_type: "milestone",
    source_id: milestoneId,
    project_id: existing.project_id,
    summary: `deleted milestone “${existing.name}”`,
  });

  revalidatePath(`/projects/${existing.project_id}`);
  revalidatePath("/calendar");
  return { ok: true };
}

/**
 * Move one milestone up or down its project's order.
 *
 * Swapping sort keys with the neighbour rather than renumbering the list keeps
 * this to two writes and leaves every other milestone's key alone. Move-up and
 * move-down buttons rather than drag alone: the board shipped a drag-only
 * reorder in #30 that could not be operated from a keyboard.
 */
export async function reorderMilestone(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = reorderMilestoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { milestoneId, direction } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const existing = await loadMilestone(supabase, milestoneId);
  if (!existing) return { ok: false, error: "Milestone not found." };
  if (!(await hasProjectCapability(supabase, existing.project_id, "manage"))) {
    return { ok: false, error: "You cannot reorder these milestones." };
  }

  const { data: siblings } = await supabase
    .from("milestone")
    .select("id, name, due_date, sort_key")
    .eq("project_id", existing.project_id);

  const ordered = ((siblings ?? []) as unknown as {
    id: string;
    name: string;
    due_date: string | null;
    sort_key: number;
  }[]).sort(compareMilestones);

  const index = ordered.findIndex((row) => row.id === milestoneId);
  const neighbour = ordered[direction === "up" ? index - 1 : index + 1];
  if (index === -1 || !neighbour) {
    // Already at the end it was asked to move towards. Not an error: the
    // button is there, and refusing loudly would be noise.
    return { ok: true, id: milestoneId };
  }

  // Ties are possible — every milestone created before this shipped sits on
  // the default 0 — and swapping equal keys would change nothing. Give the
  // pair distinct keys straddling the neighbour's.
  const mine = ordered[index].sort_key;
  const theirs = neighbour.sort_key;
  const [nextMine, nextTheirs] =
    mine === theirs
      ? direction === "up"
        ? [theirs - 0.5, theirs]
        : [theirs + 0.5, theirs]
      : [theirs, mine];

  await supabase
    .from("milestone")
    .update({ sort_key: nextMine })
    .eq("id", milestoneId);
  await supabase
    .from("milestone")
    .update({ sort_key: nextTheirs })
    .eq("id", neighbour.id);

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "reordered",
    source_type: "milestone",
    source_id: milestoneId,
    project_id: existing.project_id,
    summary: `moved milestone “${existing.name}” ${direction}`,
  });

  revalidatePath(`/projects/${existing.project_id}`);
  return { ok: true };
}
