import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createNotifications, notificationDedupeKey } from "@/features/jobs/services/notify";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { SOURCE_TABLES, TASK_SOURCE_TYPES, sourceNeedsId, type TaskSource } from "./sources";

/**
 * The one "create task" action (M7a, epic #199).
 *
 * Every place that makes a task (the task form, meeting actions, messages,
 * CRM follow-ups, project templates, the record-template catalogue, and from
 * Workspace OS documents, comments, workflows, capture and commands) calls
 * this, so a task is the same thing whichever door it came through: the same
 * columns filled, the same activity entry, the same assignment notice, and a
 * recorded source (M7b).
 *
 * Deliberately not a "use server" module: it trusts that its caller has
 * already established who is asking (requireSession) and passes that client
 * in. RLS on `task` stays the authorization boundary for the insert; the
 * source is read through the same client, so a task can only claim to come
 * from something the creator can see.
 */

const STATUSES = [
  "not_started",
  "ready",
  "in_progress",
  "waiting",
  "in_review",
  "completed",
  "cancelled",
] as const;

export const universalTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional(),
  projectId: z.string().uuid().optional(),
  /** Used only when there is no project (a channel's program, say). */
  programId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  dueAt: z.string().optional(),
  completionCriteria: z.string().trim().max(2000).optional(),
  reviewerId: z.string().uuid().optional(),
  approverId: z.string().uuid().optional(),
  status: z.enum(STATUSES).optional(),
  source: z
    .object({
      type: z.enum(TASK_SOURCE_TYPES),
      id: z.string().uuid().nullable().default(null),
    })
    .default({ type: "manual", id: null })
    .refine((source) => sourceNeedsId(source.type) === (source.id !== null), {
      message: "source id",
    }),
});

export type UniversalTaskInput = z.input<typeof universalTaskInputSchema>;

export interface TaskActor {
  userId: string;
  organizationId: string;
  /** Shown in the assignee's notification. */
  displayName: string;
}

export interface CreateTaskOptions {
  /** Activity line; defaults to `created task “<title>”`. */
  activitySummary?: string;
  /** Extra columns a caller owns (for example `source_message_id`). */
  extra?: Record<string, unknown>;
  /** Link in the assignee's notification. */
  notificationLink?: (taskId: string) => string;
}

export type CreateTaskResult =
  | { ok: true; id: string; projectId: string | null; programId: string | null }
  | { ok: false; reason: "invalid" | "source" | "failed"; message?: string };

type Db = SupabaseClient;

/** Proves the actor can read the source row, and returns it. */
export async function readSource(
  db: Db,
  source: TaskSource,
): Promise<Record<string, unknown> | null> {
  if (!source.id) return {};
  const spec = SOURCE_TABLES[source.type];
  if (!spec) return {};
  const columns = ["id", spec.title, ...(spec.extra ?? [])].join(", ");
  const { data } = await db.from(spec.table).select(columns).eq("id", source.id).maybeSingle();
  if (data) return data as unknown as Record<string, unknown>;
  // A recurrence names the previous occurrence or, for a series' first, the series.
  if (source.type === "recurrence") {
    const { data: series } = await db
      .from("task_series")
      .select("id, title")
      .eq("id", source.id)
      .maybeSingle();
    return (series as Record<string, unknown> | null) ?? null;
  }
  return null;
}

export async function createUniversalTask(
  db: Db,
  actor: TaskActor,
  input: UniversalTaskInput,
  options: CreateTaskOptions = {},
): Promise<CreateTaskResult> {
  const parsed = universalTaskInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message };
  }
  const data = parsed.data;
  const source: TaskSource = { type: data.source.type, id: data.source.id ?? null };

  if (!(await readSource(db, source))) return { ok: false, reason: "source" };

  let programId: string | null = data.projectId ? null : (data.programId ?? null);
  if (data.projectId) {
    const { data: project } = await db
      .from("project")
      .select("program_id")
      .eq("id", data.projectId)
      .maybeSingle();
    programId = (project?.program_id as string | null) ?? null;
  }

  const { data: task, error } = await db
    .from("task")
    .insert({
      organization_id: actor.organizationId,
      program_id: programId,
      project_id: data.projectId ?? null,
      milestone_id: data.milestoneId ?? null,
      title: data.title,
      description: data.description || null,
      priority: data.priority,
      assignee_id: data.assigneeId ?? null,
      requester_id: actor.userId,
      due_at: data.dueAt || null,
      completion_criteria: data.completionCriteria || null,
      reviewer_id: data.reviewerId ?? null,
      approver_id: data.approverId ?? null,
      created_by: actor.userId,
      status: data.status ?? "not_started",
      // Completed work recorded after the fact still needs its completion
      // time, or every report that measures completion by date misses it.
      completed_at: data.status === "completed" ? new Date().toISOString() : null,
      source_type: source.type,
      source_id: source.id,
      ...options.extra,
    })
    .select("id")
    .single();

  if (error || !task) return { ok: false, reason: "failed", message: error?.message };
  const taskId = task.id as string;

  await db.from("activity_event").insert({
    organization_id: actor.organizationId,
    actor_id: actor.userId,
    verb: "created",
    source_type: "task",
    source_id: taskId,
    project_id: data.projectId ?? null,
    program_id: programId,
    summary: options.activitySummary ?? `created task “${data.title}”`,
    metadata: { source: { type: source.type, id: source.id } },
  });

  // One assignment notice per task and assignee (P0-NOT-04), in the
  // assignee's own language: they read it later, not the person creating it.
  if (data.assigneeId && data.assigneeId !== actor.userId) {
    const { data: profile } = await db
      .from("user_profile")
      .select("locale")
      .eq("id", data.assigneeId)
      .maybeSingle();
    const locale = profile?.locale;
    const t = createTranslator(isLocale(locale) ? locale : DEFAULT_LOCALE);
    await createNotifications(db, [
      {
        user_id: data.assigneeId,
        organization_id: actor.organizationId,
        category: "assignment",
        title: t("tasks.notify.assigned", { name: actor.displayName }),
        body: data.title,
        source_type: "task",
        source_id: taskId,
        link: options.notificationLink?.(taskId) ?? `/my-work?task=${taskId}`,
        urgency: data.priority === "critical" ? "high" : "normal",
        reason: "assigned",
        context: data.title,
        owner_label: actor.displayName,
        due_on: data.dueAt || null,
        project_id: data.projectId ?? null,
        dedupe_key: notificationDedupeKey("task", taskId, data.assigneeId),
      },
    ]);
  }

  return { ok: true, id: taskId, projectId: data.projectId ?? null, programId };
}
