"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  createMilestoneSchema,
  updateMilestoneSchema,
} from "@/features/projects/schemas";

export async function createMilestone(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = createMilestoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { projectId, name, dueDate } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: row, error } = await supabase
    .from("milestone")
    .insert({
      project_id: projectId,
      name,
      due_date: dueDate || null,
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

export async function completeMilestone(
  milestoneId: string,
  completed: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const supabase = await createSupabaseServerClient();

  const { data: current } = await supabase
    .from("milestone")
    .select("id, project_id, name, completed_at")
    .eq("id", milestoneId)
    .maybeSingle();
  if (!current) return { ok: false, error: "Milestone not found." };

  if (completed && current.completed_at) {
    return { ok: true, id: milestoneId };
  }

  const { error } = await supabase
    .from("milestone")
    .update({ completed_at: completed ? new Date().toISOString() : null })
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
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = updateMilestoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { milestoneId, name, dueDate } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (dueDate !== undefined) patch.due_date = dueDate;
  const { data: row, error } = await supabase
    .from("milestone")
    .update(patch)
    .eq("id", milestoneId)
    .select("id, project_id")
    .maybeSingle();
  if (error || !row) return { ok: false, error: "Could not update the milestone." };
  revalidatePath(`/projects/${row.project_id}`);
  revalidatePath("/calendar");
  return { ok: true };
}
