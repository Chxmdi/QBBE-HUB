"use server";

import { reportError } from "@/lib/observability";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TaskStatus } from "@/types/entities";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  TASK_STATUSES,
  blockedReasonError,
  bulkSchema,
  createTaskSchema,
  taskRoleSchema,
  updateTaskSchema,
  TASK_ROLE_LABELS,
} from "@/features/tasks/schemas";
import {
  TRACKED_TASK_FIELDS,
  diffTaskFields,
  summarizeChanges,
  type LabelLookup,
  type TaskFieldChange,
  type TaskFieldValues,
} from "@/features/tasks/services/task.history";

/**
 * Task commands — durable server mutations (WORK-002). Validation happens
 * at the trust boundary (DEV-002); RLS enforces authorization underneath.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Resolve display text for the id-valued fields in a diff.
 *
 * Labels are stored on the event rather than joined on read, so a history entry
 * still reads correctly after a person is deactivated or a project renamed, and
 * so rendering it never depends on the reader being able to see those records.
 */
async function resolveChangeLabels(
  supabase: ServerClient,
  changes: TaskFieldChange[],
): Promise<LabelLookup> {
  const people = new Set<string>();
  const projects = new Set<string>();
  const milestones = new Set<string>();
  for (const change of changes) {
    const ids = [change.from, change.to].filter((v): v is string => v !== null);
    // Reviewer and approver are people too. Before this they resolved to
    // nothing, so a history entry read "changed Approver from  to " — the ids
    // were there in the metadata and neither name was.
    if (
      change.field === "assignee_id" ||
      change.field === "reviewer_id" ||
      change.field === "approver_id"
    ) {
      ids.forEach((id) => people.add(id));
    }
    if (change.field === "project_id") ids.forEach((id) => projects.add(id));
    if (change.field === "milestone_id") ids.forEach((id) => milestones.add(id));
  }
  if (people.size === 0 && projects.size === 0 && milestones.size === 0) return {};

  const [{ data: profiles }, { data: projectRows }, { data: milestoneRows }] =
    await Promise.all([
      people.size
        ? supabase.from("user_profile").select("id, full_name").in("id", [...people])
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      projects.size
        ? supabase.from("project").select("id, name").in("id", [...projects])
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      milestones.size
        ? supabase.from("milestone").select("id, name").in("id", [...milestones])
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

  const labels: LabelLookup = {};
  for (const row of profiles ?? []) labels[row.id as string] = row.full_name as string;
  for (const row of projectRows ?? []) labels[row.id as string] = row.name as string;
  for (const row of milestoneRows ?? []) labels[row.id as string] = row.name as string;
  return labels;
}

/**
 * Write one activity event describing what actually changed (P0-TSK-05).
 * The event carries the actor and timestamp as before; `metadata.changes` is
 * what makes it answerable rather than merely present.
 */
async function recordTaskChanges(
  supabase: ServerClient,
  session: { organizationId: string; userId: string },
  taskId: string,
  before: TaskFieldValues,
  after: TaskFieldValues,
  context: {
    title: string;
    projectId: string | null;
    programId: string | null;
    verb?: string;
  },
): Promise<void> {
  const bare = diffTaskFields(before, after);
  const changes = bare.length
    ? diffTaskFields(before, after, await resolveChangeLabels(supabase, bare))
    : bare;

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: context.verb ?? "updated",
    source_type: "task",
    source_id: taskId,
    project_id: context.projectId,
    program_id: context.programId,
    summary: summarizeChanges(context.title, changes),
    metadata: { changes },
  });
}

export async function createTask(input: unknown): Promise<ActionResult> {
  const session = await requireSession();

  const limited = await enforceRateLimit("task:create", session.userId);
  if (limited) return limited;
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const {
    title, description, projectId, milestoneId, assigneeId, priority, dueAt,
    completionCriteria, reviewerId, approverId, status,
  } = parsed.data;

  const supabase = await createSupabaseServerClient();

  let programId: string | null = null;
  if (projectId) {
    const { data: project } = await supabase
      .from("project")
      .select("program_id")
      .eq("id", projectId)
      .maybeSingle();
    programId = (project?.program_id as string | null) ?? null;
  }

  const { data: task, error } = await supabase
    .from("task")
    .insert({
      organization_id: session.organizationId,
      program_id: programId,
      project_id: projectId ?? null,
      milestone_id: milestoneId ?? null,
      title,
      description: description || null,
      priority,
      assignee_id: assigneeId ?? null,
      requester_id: session.userId,
      due_at: dueAt || null,
      completion_criteria: completionCriteria || null,
      reviewer_id: reviewerId ?? null,
      approver_id: approverId ?? null,
      created_by: session.userId,
      status: status ?? "not_started",
      // Status and completion time are one fact with two spellings. Recording
      // work that is already finished is a supported case (P0-TSK-01), but
      // writing `completed` without the timestamp produces a task that every
      // report measuring completion by date cannot see — the same split-fact
      // defect #28 repaired on `milestone`, where every completed milestone
      // still reported `status = 'planned'`.
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error || !task) {
    return { ok: false, error: "Could not save the task. Please try again." };
  }

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "created",
    source_type: "task",
    source_id: task.id,
    project_id: projectId ?? null,
    program_id: programId,
    summary: `created task “${title}”`,
  });

  // Deduplicated assignment notification (P0-NOT-04): one per task+assignee.
  if (assigneeId && assigneeId !== session.userId) {
    await supabase.from("notification").insert({
      user_id: assigneeId,
      organization_id: session.organizationId,
      category: "assignment",
      title: `${session.profile.full_name} assigned you a task`,
      body: title,
      source_type: "task",
      source_id: task.id,
      link: `/my-work?task=${task.id}`,
      urgency: priority === "critical" ? "high" : "normal",
      dedupe_key: `assign:${task.id}:${assigneeId}`,
    });
  }

  revalidatePath("/", "layout");
  return { ok: true, id: task.id as string };
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  blockedReason?: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Unknown status." };
  }
  const blockedError = blockedReasonError(status, blockedReason);
  if (blockedError) {
    return { ok: false, error: blockedError };
  }

  const supabase = await createSupabaseServerClient();
  // Read the prior status before writing. Completing an already-completed task
  // is not a state change, and treating it as one is what spawned duplicate
  // recurrences. The unique index is the actual guarantee; this is so the
  // ordinary case never has to rely on catching a constraint violation.
  const { data: before } = await supabase
    .from("task")
    .select("status, blocked_reason")
    .eq("id", taskId)
    .maybeSingle();
  const wasAlreadyCompleted = before?.status === "completed";

  const { data: updated, error } = await supabase
    .from("task")
    .update({
      status,
      blocked_reason: status === "blocked" ? blockedReason!.trim() : null,
      // Leaving the blocking person behind on an unblocked task would keep
      // asking somebody for an action nobody is waiting on any more.
      ...(status === "blocked" ? {} : { blocked_by_id: null }),
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", taskId)
    .select("id, title, project_id, program_id, assignee_id, blocked_reason")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "Could not update the task status." };
  }

  if (status === "completed" && !wasAlreadyCompleted) {
    const { data: source } = await supabase
      .from("task")
      .select("title, description, project_id, program_id, assignee_id, priority, due_at, recurrence_rule")
      .eq("id", taskId)
      .maybeSingle();
    if (source?.recurrence_rule && source.due_at) {
      const { nextOccurrence } = await import("@/features/tasks/recurrence");
      const nextDue = nextOccurrence(source.recurrence_rule as string, source.due_at as string);
      // `recurrence_parent_id` is uniquely indexed, so a concurrent second
      // completion loses the race rather than creating a twin. The error is
      // swallowed on purpose: the successor exists either way, which is the
      // outcome the caller wanted, and reporting a failure for a task that was
      // completed successfully would be a worse lie than saying nothing.
      const { error: spawnError } = await supabase.from("task").insert({
        organization_id: session.organizationId,
        program_id: source.program_id,
        project_id: source.project_id,
        title: source.title,
        description: source.description,
        priority: source.priority,
        assignee_id: source.assignee_id,
        requester_id: session.userId,
        due_at: nextDue,
        created_by: session.userId,
        status: "not_started",
        recurrence_rule: source.recurrence_rule,
        recurrence_anchor: nextDue,
        recurrence_parent_id: taskId,
      });
      // 23505 is the unique violation — the successor already exists. Anything
      // else is a real failure and should be visible rather than silent.
      if (spawnError && spawnError.code !== "23505") {
        reportError(spawnError, {
          source: "recurrence",
          taskId,
          message: "could not spawn the next occurrence",
        });
      }
    }
  }

  await recordTaskChanges(
    supabase,
    session,
    taskId,
    { status: before?.status ?? null, blocked_reason: before?.blocked_reason ?? null },
    {
      status,
      // Taken from the row that was written rather than from the input, so the
      // entry records the clearing that happens when a task leaves `blocked`
      // as well as the reason given when it enters it.
      blocked_reason: (updated.blocked_reason as string | null) ?? null,
    },
    {
      title: updated.title as string,
      projectId: (updated.project_id as string | null) ?? null,
      programId: (updated.program_id as string | null) ?? null,
      verb: status === "completed" ? "completed" : "updated",
    },
  );

  const { fireWorkflows } = await import("@/features/admin/services/workflow.runtime");
  await fireWorkflows(supabase, {
    organizationId: session.organizationId,
    actorId: session.userId,
    eventType: "task_status_changed",
    status,
    title: updated.title as string,
    sourceType: "task",
    sourceId: taskId,
    link: `/my-work?task=${taskId}`,
    assigneeId: (updated.assignee_id as string | null) ?? null,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateTask(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { taskId, ...fields } = parsed.data;

  const supabase = await createSupabaseServerClient();

  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.assigneeId !== undefined) patch.assignee_id = fields.assigneeId;
  if (fields.priority !== undefined) patch.priority = fields.priority;
  if (fields.dueAt !== undefined) patch.due_at = fields.dueAt || null;
  if (fields.projectId !== undefined) patch.project_id = fields.projectId;
  if (fields.completionCriteria !== undefined) {
    patch.completion_criteria = fields.completionCriteria || null;
  }
  if (fields.milestoneId !== undefined) patch.milestone_id = fields.milestoneId;
  if (fields.reviewerId !== undefined) patch.reviewer_id = fields.reviewerId;
  if (fields.approverId !== undefined) patch.approver_id = fields.approverId;
  if (fields.blockedById !== undefined) patch.blocked_by_id = fields.blockedById;

  // Read the tracked fields before writing: a history entry has to say what the
  // value was, and after the update that information is gone (P0-TSK-05).
  const { data: before } = await supabase
    .from("task")
    .select("assignee_id, due_at, status, priority, project_id, milestone_id, reviewer_id, approver_id, completion_criteria, blocked_reason")
    .eq("id", taskId)
    .maybeSingle();

  const { data: updated, error } = await supabase
    .from("task")
    .update(patch)
    .eq("id", taskId)
    // One line on purpose: supabase-js infers the row type by parsing this
    // string literal, and a concatenation is just `string`, which collapses
    // every field below into an error type.
    .select("id, title, assignee_id, project_id, program_id, due_at, status, priority, milestone_id, reviewer_id, approver_id, completion_criteria, blocked_reason")
    .maybeSingle();

  if (error || !updated) return { ok: false, error: "Could not update the task." };

  if (fields.assigneeId && fields.assigneeId !== session.userId) {
    await supabase.from("notification").insert({
      user_id: fields.assigneeId,
      organization_id: session.organizationId,
      category: "assignment",
      title: `${session.profile.full_name} assigned you a task`,
      body: updated.title,
      source_type: "task",
      source_id: taskId,
      link: `/my-work?task=${taskId}`,
      dedupe_key: `assign:${taskId}:${fields.assigneeId}`,
    });
  }

  await recordTaskChanges(
    supabase,
    session,
    taskId,
    before ?? {},
    {
      assignee_id: updated.assignee_id,
      due_at: updated.due_at,
      status: updated.status,
      priority: updated.priority,
      project_id: updated.project_id,
      milestone_id: updated.milestone_id,
      reviewer_id: updated.reviewer_id,
      approver_id: updated.approver_id,
      completion_criteria: updated.completion_criteria,
      blocked_reason: updated.blocked_reason,
    },
    {
      title: updated.title as string,
      projectId: (updated.project_id as string | null) ?? null,
      programId: (updated.program_id as string | null) ?? null,
    },
  );

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Give somebody a role on a task (P0-TSK-02).
 *
 * The role is what confers their capability — the database reads
 * `task_assignment` when deciding what they may do — so this is an
 * authorization change, and RLS decides whether the caller may make it.
 */
export async function setTaskRole(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = taskRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { taskId, userId, role } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("task_assignment")
    .upsert({ task_id: taskId, user_id: userId, role }, {
      onConflict: "task_id,user_id,role",
    });

  if (error) {
    // The scope trigger rejects a member of another organization.
    if (error.code === "23514") {
      return { ok: false, error: "That person is not an active member of this organization." };
    }
    return { ok: false, error: "Could not assign that role." };
  }

  const { data: task } = await supabase
    .from("task")
    .select("id, title, project_id, program_id")
    .eq("id", taskId)
    .maybeSingle();

  if (task) {
    await supabase.from("activity_event").insert({
      organization_id: session.organizationId,
      actor_id: session.userId,
      verb: "updated",
      source_type: "task",
      source_id: taskId,
      project_id: task.project_id,
      program_id: task.program_id,
      summary: `added a ${TASK_ROLE_LABELS[role].toLowerCase()} to “${task.title}”`,
      metadata: { role, userId },
    });

    if (userId !== session.userId) {
      await supabase.from("notification").insert({
        user_id: userId,
        organization_id: session.organizationId,
        category: "assignment",
        title: `${session.profile.full_name} made you ${
          role === "approver" ? "an" : "a"
        } ${TASK_ROLE_LABELS[role].toLowerCase()}`,
        body: task.title,
        source_type: "task",
        source_id: taskId,
        link: `/my-work?task=${taskId}`,
        dedupe_key: `role:${taskId}:${userId}:${role}`,
      });
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Withdraw a task role. Removing the last one removes the access it carried. */
export async function removeTaskRole(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = taskRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { taskId, userId, role } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("task_assignment")
    .delete()
    .eq("task_id", taskId)
    .eq("user_id", userId)
    .eq("role", role);

  if (error) return { ok: false, error: "Could not remove that role." };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Bulk reassign / reprioritize / reschedule / archive (P0-TSK-05).
 * "Blocked" is excluded from bulk status changes because each blocked task
 * requires its own explanation (business rule §19).
 */
export async function bulkUpdateTasks(
  input: unknown,
): Promise<ActionResult & { updated?: number }> {
  const session = await requireSession();
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { taskIds, action, status, assigneeId, priority, dueAt } = parsed.data;

  const patch: Record<string, unknown> = {};
  if (action === "status") {
    if (!status) return { ok: false, error: "Pick a status." };
    patch.status = status;
    patch.completed_at = status === "completed" ? new Date().toISOString() : null;
    // `updateTaskStatus` has always cleared these when a task leaves `blocked`;
    // this path did not, so a bulk move off `blocked` left the old reason and
    // the old blocker behind. The list and the board went on printing
    // "Blocked: waiting on the venue" above a task whose status said
    // `in_progress` — text describing a blockage that had been declared over.
    // The bulk schema cannot express `blocked` (it needs a reason, which a
    // bulk bar does not collect), so leaving is the only direction available.
    patch.blocked_reason = null;
    patch.blocked_by_id = null;
  } else if (action === "assignee") {
    if (assigneeId === undefined) return { ok: false, error: "Pick an assignee." };
    patch.assignee_id = assigneeId;
  } else if (action === "priority") {
    if (!priority) return { ok: false, error: "Pick a priority." };
    patch.priority = priority;
  } else if (action === "due") {
    patch.due_at = dueAt || null;
  } else if (action === "archive") {
    patch.archived_at = new Date().toISOString();
  }

  const supabase = await createSupabaseServerClient();

  // Prior values for the whole selection, in one read. A bulk change is still a
  // change to each task, and each one owes its own history entry (P0-TSK-05).
  const { data: beforeRows } = await supabase
    .from("task")
    .select("id, assignee_id, due_at, status, priority, project_id, blocked_reason")
    .in("id", taskIds);
  const priorById = new Map<string, TaskFieldValues>(
    (beforeRows ?? []).map((row) => [row.id as string, row as TaskFieldValues]),
  );

  const { data: updated, error } = await supabase
    .from("task")
    .update(patch)
    .in("id", taskIds)
    .select("id, title, project_id, program_id");

  if (error) {
    return { ok: false, error: "Bulk update failed. No changes were applied." };
  }

  const rows = updated ?? [];
  if (rows.length > 0) {
    // Only the tracked fields this action actually wrote. `archived_at` is not
    // one of them, so archiving keeps its own plain summary below.
    const after: TaskFieldValues = {};
    for (const field of TRACKED_TASK_FIELDS) {
      if (field in patch) after[field] = patch[field];
    }

    const changesById = new Map<string, TaskFieldChange[]>();
    for (const row of rows) {
      changesById.set(
        row.id as string,
        diffTaskFields(priorById.get(row.id as string) ?? {}, after),
      );
    }
    const labels = await resolveChangeLabels(
      supabase,
      [...changesById.values()].flat(),
    );

    await supabase.from("activity_event").insert(
      rows.map((row) => {
        const changes = diffTaskFields(
          priorById.get(row.id as string) ?? {},
          after,
          labels,
        );
        return {
          organization_id: session.organizationId,
          actor_id: session.userId,
          verb: action === "archive" ? "archived" : "updated",
          source_type: "task",
          source_id: row.id,
          project_id: row.project_id,
          program_id: row.program_id,
          summary:
            action === "archive"
              ? `archived “${row.title}”`
              : summarizeChanges(row.title as string, changes),
          metadata: { changes, bulk: true },
        };
      }),
    );

    // One deduplicated notification per newly assigned person.
    if (action === "assignee" && assigneeId && assigneeId !== session.userId) {
      await supabase.from("notification").insert(
        rows.map((row) => ({
          user_id: assigneeId,
          organization_id: session.organizationId,
          category: "assignment",
          title: `${session.profile.full_name} assigned you a task`,
          body: row.title,
          source_type: "task",
          source_id: row.id,
          link: `/my-work?task=${row.id}`,
          dedupe_key: `assign:${row.id}:${assigneeId}`,
        })),
      );
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, updated: rows.length };
}

export async function addTaskComment(
  taskId: string,
  body: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Comment cannot be empty." };
  if (trimmed.length > 5000) return { ok: false, error: "Comment is too long." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("task_comment").insert({
    task_id: taskId,
    author_id: session.userId,
    body: trimmed,
  });
  if (error) return { ok: false, error: "Could not post the comment." };

  // Notify assignee about new discussion, deduplicated per comment author.
  const { data: task } = await supabase
    .from("task")
    .select("title, assignee_id, project_id, program_id")
    .eq("id", taskId)
    .maybeSingle();

  if (task?.assignee_id && task.assignee_id !== session.userId) {
    await supabase.from("notification").insert({
      user_id: task.assignee_id,
      organization_id: session.organizationId,
      category: "reply",
      title: `${session.profile.full_name} commented on “${task.title}”`,
      body: trimmed.slice(0, 140),
      source_type: "task",
      source_id: taskId,
      link: `/my-work?task=${taskId}`,
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
