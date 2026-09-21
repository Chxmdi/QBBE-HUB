import { createSupabaseServerClient } from "@/lib/supabase/server";
import { planTemplateItems, type TemplateItem } from "@/features/programs/template-plan";

/**
 * Fill a project that was just created from a template with the milestones and
 * tasks the template describes (P1-PRJ-09, P1-PROG-03).
 *
 * Deliberately not a "use server" module: this is shared by two server actions
 * and exporting it as an action of its own would put an unauthenticated entry
 * point on the network for something that assumes its caller already checked
 * who is asking.
 *
 * What it copies is exactly what `project_template_item` holds — a name, a
 * description, a kind and a day offset. There is nothing else to copy, which
 * is the point of the requirement: a project built from a template arrives
 * with no comments, no private notes and no history, because a template never
 * had any. It goes through `createMilestone` and `createTask` rather than
 * inserting rows, so an instantiated project's work is indistinguishable from
 * work somebody typed, down to its activity trail.
 */
export async function expandProjectTemplate(input: {
  projectTemplateId: string;
  projectId: string;
  /** A calendar date (YYYY-MM-DD) in the organization's zone. */
  startDate: string;
}): Promise<{ milestones: number; tasks: number }> {
  const db = await createSupabaseServerClient();
  const { createMilestone } = await import(
    "@/features/projects/services/milestone.commands"
  );
  const { createTask } = await import("@/features/tasks/services/task.commands");

  const { data: items } = await db
    .from("project_template_item")
    .select("kind, name, description, day_offset, sort_key")
    .eq("project_template_id", input.projectTemplateId)
    .order("sort_key");

  let milestones = 0;
  let tasks = 0;

  for (const planned of planTemplateItems(
    (items ?? []) as unknown as TemplateItem[],
    input.startDate,
  )) {
    if (planned.kind === "milestone") {
      const result = await createMilestone({
        projectId: input.projectId,
        name: planned.name,
        dueDate: planned.dueDate ?? "",
      });
      if (result.ok) milestones += 1;
    } else {
      const result = await createTask({
        title: planned.name,
        description: planned.description ?? undefined,
        projectId: input.projectId,
        dueAt: planned.dueDate ?? undefined,
      });
      if (result.ok) tasks += 1;
    }
  }

  return { milestones, tasks };
}
