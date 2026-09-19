"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { hasProgramCapability, hasProjectCapability } from "@/lib/access-capabilities";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const createProjectSchema = z.object({
  name: requiredText("A project needs a name.", 200),
  outcome: z.string().trim().max(2000).optional(),
  programId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  sponsorId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  targetDate: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  health: z.enum(["on_track", "at_risk", "off_track", "paused", "unknown"]).default("unknown"),
  healthReason: z.string().trim().max(2000).optional(),
  reportingCadence: z.enum(["none", "weekly", "monthly"]).default("none"),
  stage: z
    .enum(["proposed", "approved", "planning", "active"])
    .default("planning"),
}).superRefine((value, ctx) => {
  if (value.stage === "active") {
    if (!value.programId || !value.outcome || !value.targetDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An active project needs a program, outcome and target date.",
      });
    }
  }
  if ((value.health === "at_risk" || value.health === "off_track") && !value.healthReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Adverse health requires a reason.",
    });
  }
});

export async function createProject(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const {
    name, outcome, programId, ownerId, sponsorId, startDate, targetDate, stage,
    priority, health, healthReason, reportingCadence,
  } = parsed.data;

  const supabase = await createSupabaseServerClient();
  if (programId) {
    if (!(await hasProgramCapability(supabase, programId, "manage"))) {
      return { ok: false, error: "You cannot create a project in this program." };
    }
  } else if (!session.isAdmin) {
    return { ok: false, error: "Independent projects can only be created by an administrator." };
  }
  const projectId = crypto.randomUUID();
  const { error } = await supabase
    .from("project")
    .insert({
      id: projectId,
      organization_id: session.organizationId,
      program_id: programId ?? null,
      name,
      outcome: outcome || null,
      owner_id: ownerId ?? session.userId,
      sponsor_id: sponsorId ?? null,
      stage,
      health,
      health_reason: healthReason || null,
      priority,
      reporting_cadence: reportingCadence,
      start_date: startDate || null,
      target_date: targetDate || null,
      created_by: session.userId,
    });

  if (error) return { ok: false, error: "Could not create the project." };

  await supabase.from("project_membership").insert({
    project_id: projectId,
    user_id: ownerId ?? session.userId,
    role: "manager",
  });

  const channelSlug = `project-${slugify(name) || projectId.slice(0, 8)}`;
  const { data: channel } = await supabase
    .from("channel")
    .insert({
      organization_id: session.organizationId,
      name,
      slug: channelSlug,
      type: "project",
      privacy: "public",
      purpose: `Project conversation for ${name}.`,
      project_id: projectId,
      program_id: programId ?? null,
      owner_id: ownerId ?? session.userId,
      created_by: session.userId,
    })
    .select("id")
    .maybeSingle();
  if (channel) {
    await supabase.rpc("add_channel_member", {
      p_channel_id: channel.id,
      p_user_id: ownerId ?? session.userId,
    });
  }

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "created",
    source_type: "project",
    source_id: projectId,
    project_id: projectId,
    program_id: programId ?? null,
    summary: `created project “${name}”`,
  });

  revalidatePath("/projects");
  return { ok: true, id: projectId };
}

const statusUpdateSchema = z.object({
  projectId: z.string().uuid(),
  health: z.enum(["on_track", "at_risk", "off_track", "paused"]),
  progressSummary: requiredText("Progress summary is required.", 5000),
  nextSteps: z.string().trim().max(5000).optional(),
  blockers: z.string().trim().max(5000).optional(),
  decisionsNeeded: z.string().trim().max(5000).optional(),
  helpRequested: z.string().trim().max(5000).optional(),
  healthReason: z.string().trim().max(1000).optional(),
});

/**
 * Publishes a structured status update (P0-PRJ-05) and applies health
 * discipline: at-risk/off-track requires a reason (P0-PRJ-04).
 */
export async function publishStatusUpdate(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = statusUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  if (
    (data.health === "at_risk" || data.health === "off_track") &&
    !data.healthReason?.trim() &&
    !data.blockers?.trim()
  ) {
    return {
      ok: false,
      error: "Marking a project at risk or off track requires a reason.",
    };
  }

  const supabase = await createSupabaseServerClient();

  const { error: updateError } = await supabase.from("project_status_update").insert({
    project_id: data.projectId,
    author_id: session.userId,
    health: data.health,
    progress_summary: data.progressSummary,
    next_steps: data.nextSteps || null,
    blockers: data.blockers || null,
    decisions_needed: data.decisionsNeeded || null,
    help_requested: data.helpRequested || null,
  });
  if (updateError) return { ok: false, error: "Could not publish the update." };

  const { data: project } = await supabase
    .from("project")
    .update({
      health: data.health,
      health_reason: data.healthReason?.trim() || data.blockers?.trim() || null,
    })
    .eq("id", data.projectId)
    .select("name, program_id, owner_id")
    .maybeSingle();

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "updated",
    source_type: "project",
    source_id: data.projectId,
    project_id: data.projectId,
    program_id: project?.program_id ?? null,
    summary: `published a status update for “${project?.name ?? "project"}” (${data.health.replace(/_/g, " ")})`,
  });

  if (project) {
    const { fireWorkflows } = await import("@/features/admin/services/workflow.runtime");
    await fireWorkflows(supabase, {
      organizationId: session.organizationId,
      actorId: session.userId,
      eventType: "project_health_changed",
      status: data.health,
      title: project.name as string,
      sourceType: "project",
      sourceId: data.projectId,
      link: `/projects/${data.projectId}`,
      assigneeId: (project.owner_id as string | null) ?? null,
    });
  }

  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath("/projects");
  return { ok: true };
}

const stageSchema = z.object({
  projectId: z.string().uuid(),
  stage: z.enum([
    "proposed", "approved", "planning", "active", "paused",
    "completed", "cancelled", "archived",
  ]),
});

export async function updateProjectStage(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { projectId, stage } = parsed.data;

  const supabase = await createSupabaseServerClient();
  if (!(await hasProjectCapability(supabase, projectId, "manage"))) {
    return { ok: false, error: "You cannot change this project's stage." };
  }
  if (stage === "completed") {
    return { ok: false, error: "Use close project so unresolved work is recorded." };
  }
  const { data: project, error } = await supabase
    .from("project")
    .update({
      stage,
      completed_at: null,
      archived_at: stage === "archived" ? new Date().toISOString() : null,
    })
    .eq("id", projectId)
    .select("name, program_id")
    .maybeSingle();

  if (error || !project) return { ok: false, error: "Could not update the stage." };

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "updated",
    source_type: "project",
    source_id: projectId,
    project_id: projectId,
    program_id: project.program_id,
    summary: `moved “${project.name}” to ${stage}`,
  });

  // Auditable lifecycle transition history (P0-PRJ-02).
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "project",
    action: "stage_changed",
    object_type: "project",
    object_id: projectId,
    metadata: { stage },
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return { ok: true };
}

export interface UnresolvedWork {
  openTasks: number;
  blockedTasks: number;
  openMilestones: number;
  openFollowUps: number;
  hasStatusUpdate: boolean;
}

/**
 * Closing a project must surface unresolved work before confirmation
 * (§10.5 acceptance, P0-PRJ-08). This reports what is still open so the
 * manager decides deliberately.
 */
export async function getUnresolvedWork(
  projectId: string,
): Promise<UnresolvedWork> {
  const supabase = await createSupabaseServerClient();
  const [tasks, blocked, milestones, updates] = await Promise.all([
    supabase
      .from("task")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("archived_at", null)
      .in("status", [
        "not_started", "ready", "in_progress", "waiting", "blocked", "in_review",
      ]),
    supabase
      .from("task")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "blocked")
      .is("archived_at", null),
    supabase
      .from("milestone")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("completed_at", null),
    supabase
      .from("project_status_update")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);

  return {
    openTasks: tasks.count ?? 0,
    blockedTasks: blocked.count ?? 0,
    openMilestones: milestones.count ?? 0,
    openFollowUps: 0,
    hasStatusUpdate: (updates.count ?? 0) > 0,
  };
}

const closeSchema = z.object({
  projectId: z.string().uuid(),
  results: requiredText("Describe what the project delivered.", 5000),
  lessons: z.string().trim().max(5000).optional(),
  archiveOpenTasks: z.boolean().default(false),
});

/**
 * Closes a project: records a final status update capturing results and
 * lessons, optionally archives leftover tasks, and moves the project to
 * completed with an audit trail (P0-PRJ-08).
 */
export async function closeProject(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { projectId, results, lessons, archiveOpenTasks } = parsed.data;

  const supabase = await createSupabaseServerClient();
  if (!(await hasProjectCapability(supabase, projectId, "manage"))) {
    return { ok: false, error: "You cannot close this project." };
  }
  const unresolved = await getUnresolvedWork(projectId);
  if (unresolved.openMilestones > 0 || unresolved.blockedTasks > 0) {
    return {
      ok: false,
      error: "Close or reassign open milestones and blocked work before completing the project.",
    };
  }

  // Final update is required before closure.
  const { error: updateError } = await supabase
    .from("project_status_update")
    .insert({
      project_id: projectId,
      author_id: session.userId,
      health: "on_track",
      progress_summary: `Project closed. Results: ${results}`,
      next_steps: lessons ? `Lessons learned: ${lessons}` : null,
    });
  if (updateError) {
    return { ok: false, error: "Could not record the closing update." };
  }

  if (archiveOpenTasks) {
    await supabase
      .from("task")
      .update({ archived_at: new Date().toISOString() })
      .eq("project_id", projectId)
      .is("archived_at", null)
      .in("status", [
        "not_started", "ready", "in_progress", "waiting", "blocked", "in_review",
      ]);
  }

  const { data: project, error } = await supabase
    .from("project")
    .update({
      stage: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .select("name, program_id")
    .maybeSingle();

  if (error || !project) return { ok: false, error: "Could not close the project." };

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "completed",
    source_type: "project",
    source_id: projectId,
    project_id: projectId,
    program_id: project.program_id,
    summary: `closed project “${project.name}”`,
  });

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "project",
    action: "project_closed",
    object_type: "project",
    object_id: projectId,
    metadata: { archived_open_tasks: archiveOpenTasks },
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return { ok: true };
}

const createProgramSchema = z.object({
  name: requiredText("A program needs a name.", 200),
  description: z.string().trim().max(2000).optional(),
  leadId: z.string().uuid().optional(),
});

export async function createProgram(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const parsed = createProgramSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { name, description, leadId } = parsed.data;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60);
  const programId = crypto.randomUUID();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("program")
    .insert({
      id: programId,
      organization_id: session.organizationId,
      name,
      slug: `${slug}-${Date.now().toString(36).slice(-4)}`,
      description: description || null,
      lead_id: leadId ?? session.userId,
      created_by: session.userId,
    });

  if (error) return { ok: false, error: "Could not create the program." };

  const channelSlug = `program-${slug || programId.slice(0, 8)}`;
  const { data: channel } = await supabase
    .from("channel")
    .insert({
      organization_id: session.organizationId,
      name,
      slug: channelSlug,
      type: "program",
      privacy: "public",
      purpose: `Program conversation for ${name}.`,
      program_id: programId,
      owner_id: leadId ?? session.userId,
      created_by: session.userId,
    })
    .select("id")
    .maybeSingle();
  if (channel) {
    await supabase.rpc("add_channel_member", {
      p_channel_id: channel.id,
      p_user_id: leadId ?? session.userId,
    });
  }

  revalidatePath("/programs");
  revalidatePath("/channels");
  return { ok: true, id: programId };
}

const updateProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: requiredText("A project needs a name.", 200),
  outcome: z.string().trim().max(2000).optional(),
  programId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  sponsorId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  targetDate: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  health: z.enum(["on_track", "at_risk", "off_track", "paused", "unknown"]).default("unknown"),
  healthReason: z.string().trim().max(2000).optional(),
  reportingCadence: z.enum(["none", "weekly", "monthly"]).default("none"),
});

export async function updateProject(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const db = await createSupabaseServerClient();
  if (!(await hasProjectCapability(db, parsed.data.projectId, "manage"))) {
    return { ok: false, error: "You cannot edit this project." };
  }
  const { projectId, name, outcome, programId, ownerId, sponsorId, startDate,
    targetDate, priority, health, healthReason, reportingCadence } = parsed.data;
  const { data, error } = await db.from("project").update({
    name,
    outcome: outcome || null,
    program_id: programId ?? null,
    owner_id: ownerId ?? session.userId,
    sponsor_id: sponsorId ?? null,
    start_date: startDate || null,
    target_date: targetDate || null,
    priority,
    health,
    health_reason: healthReason || null,
    reporting_cadence: reportingCadence,
  }).eq("id", projectId).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Could not save the project." };
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return { ok: true, id: projectId };
}
