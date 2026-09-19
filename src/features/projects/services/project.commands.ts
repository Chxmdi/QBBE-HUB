"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { hasProgramCapability, hasProjectCapability } from "@/lib/access-capabilities";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseLabelledLinks } from "@/lib/links";
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
      // The stale-project sweep reads this column to decide who has gone quiet.
      // Nothing had ever written it, so the sweep silently fell back to
      // updated_at — which any edit touches, so a project could look freshly
      // reported because somebody renamed it.
      last_status_update_at: new Date().toISOString(),
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
  /** Risks still live and issues still unresolved. */
  openRisks: number;
  openIssues: number;
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
  const [tasks, blocked, milestones, risks, issues, updates] = await Promise.all([
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
    // The count that used to be hardcoded to zero. A risk still being
    // mitigated and an issue still being investigated are exactly the things
    // somebody should be told about before they sign a project off, and both
    // have had their own tables since 20260822231017.
    supabase
      .from("risk")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("status", ["open", "mitigating"]),
    supabase
      .from("issue")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("status", ["open", "investigating"]),
    supabase
      .from("project_status_update")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);

  return {
    openTasks: tasks.count ?? 0,
    blockedTasks: blocked.count ?? 0,
    openMilestones: milestones.count ?? 0,
    openRisks: risks.count ?? 0,
    openIssues: issues.count ?? 0,
    hasStatusUpdate: (updates.count ?? 0) > 0,
  };
}

const closeSchema = z.object({
  projectId: z.string().uuid(),
  results: requiredText("Describe what the project delivered.", 5000),
  lessons: z.string().trim().max(5000).optional(),
  /** "Label|https://…" lines, one per line. Same shape as a program's links. */
  evidenceLinks: z.string().trim().max(4000).optional(),
  /** Documents already filed against this project, offered as evidence. */
  evidenceDocumentIds: z.array(z.string().uuid()).max(25).default([]),
  archiveOpenTasks: z.boolean().default(false),
});

/**
 * Closes a project: records what it delivered and the evidence for it, writes
 * a final status update, optionally archives leftover tasks, moves the project
 * to completed with an audit trail (P0-PRJ-08), and tells everyone who had
 * access that it is over (P1-PRJ-08).
 *
 * The evidence is the part that was missing. A results paragraph describes a
 * closure; the report, the photographs and the attendance sheet are what makes
 * it checkable a year later, and they already existed as `document` rows that
 * nothing pointed at.
 */
export async function closeProject(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const {
    projectId, results, lessons, evidenceLinks, evidenceDocumentIds,
    archiveOpenTasks,
  } = parsed.data;

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

  // The closure record, and the evidence for it. Written after the stage move
  // so a failed close leaves no closure claiming a project that is still open.
  // Upserted on project_id: closing a reopened project replaces the old record
  // rather than failing on the unique constraint.
  const { data: closure, error: closureError } = await supabase
    .from("project_closure")
    .upsert(
      {
        organization_id: session.organizationId,
        project_id: projectId,
        results,
        lessons: lessons || null,
        evidence_links: parseLabelledLinks(evidenceLinks),
        closed_by: session.userId,
        closed_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    )
    .select("id")
    .single();

  if (closureError || !closure) {
    return {
      ok: false,
      error:
        "The project is closed, but its closure record could not be saved. Add the results again from the project page.",
    };
  }

  if (evidenceDocumentIds.length > 0) {
    await supabase
      .from("project_closure_document")
      .delete()
      .eq("closure_id", closure.id);
    // The trigger refuses a document filed against another project, so a
    // rejected row here means the list was tampered with, not that the close
    // failed. The closure itself is already saved.
    await supabase.from("project_closure_document").insert(
      evidenceDocumentIds.map((documentId) => ({
        closure_id: closure.id as string,
        document_id: documentId,
      })),
    );
  }

  // Everyone who could see the project is told it ended — including the people
  // whose access came from a team or an inherited program grant, who are
  // exactly the ones who would otherwise find out by opening it next month.
  const { data: audience } = await supabase
    .from("project_access_grant")
    .select("user_id")
    .eq("project_id", projectId);

  const recipients = [
    ...new Set((audience ?? []).map((row) => row.user_id as string)),
  ].filter((userId) => userId !== session.userId);

  if (recipients.length > 0) {
    await supabase.from("notification").upsert(
      recipients.map((userId) => ({
        user_id: userId,
        organization_id: session.organizationId,
        category: "system",
        title: `Closed: ${project.name}`,
        body: results.slice(0, 500),
        source_type: "project",
        source_id: projectId,
        link: `/projects/${projectId}`,
        dedupe_key: `project-closed:${projectId}`,
      })),
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    );
  }

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
    metadata: {
      archived_open_tasks: archiveOpenTasks,
      evidence_documents: evidenceDocumentIds.length,
      evidence_links: parseLabelledLinks(evidenceLinks).length,
      notified: recipients.length,
    },
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
  description: z.string().trim().max(4000).optional(),
  // Empty string means "none"; a <select> cannot submit null.
  programId: z.union([z.string().uuid(), z.literal("")]).optional(),
  ownerId: z.string().uuid({ message: "A project needs an accountable owner." }),
  sponsorId: z.union([z.string().uuid(), z.literal("")]).optional(),
  startDate: z.string().optional(),
  targetDate: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  reportingCadence: z.enum(["none", "weekly", "monthly"]).default("none"),
});
// health is deliberately absent. publishStatusUpdate is the only writer of
// project.health after creation, which is what makes P0-PRJ-04's "adverse
// health requires a reason" unbypassable through the interface. Accepting it
// here would reopen exactly that hole.

export async function updateProject(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const db = await createSupabaseServerClient();
  const { projectId, name, outcome, description, programId, ownerId, sponsorId,
    startDate, targetDate, priority, reportingCadence } = parsed.data;

  if (!(await hasProjectCapability(db, projectId, "manage"))) {
    return { ok: false, error: "You cannot edit this project." };
  }

  const { data: before } = await db
    .from("project")
    .select("name, program_id, owner_id, stage")
    .eq("id", projectId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Project not found." };

  // Moving a project between programs moves who can reach it, because project
  // capability inherits from the program. Requiring `manage` on the destination
  // stops a project being pushed into a program the editor does not run.
  const nextProgramId = programId ? programId : null;
  if (nextProgramId && nextProgramId !== before.program_id) {
    if (!(await hasProgramCapability(db, nextProgramId, "manage"))) {
      return { ok: false, error: "You cannot move this project into that program." };
    }
  }
  // Taking a project out of its program removes that inherited access from
  // everybody who held it only through the program, so it is an admin decision.
  if (!nextProgramId && before.program_id && !session.isAdmin) {
    return {
      ok: false,
      error: "Only an administrator can remove a project from its program.",
    };
  }

  const { data, error } = await db.from("project").update({
    name,
    outcome: outcome || null,
    description: description || null,
    program_id: nextProgramId,
    // Never defaults to the editor: an edit that omitted the owner used to
    // reassign the project to whoever was saving it.
    owner_id: ownerId,
    sponsor_id: sponsorId || null,
    start_date: startDate || null,
    target_date: targetDate || null,
    priority,
    reporting_cadence: reportingCadence,
  }).eq("id", projectId).select("id").maybeSingle();
  if (error || !data) {
    // The active-project trigger refuses a name-only edit that would leave an
    // active project without a program, outcome or target date.
    return {
      ok: false,
      error:
        before.stage === "active"
          ? "An active project needs a program, outcome and target date."
          : "Could not save the project.",
    };
  }

  await db.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "updated",
    source_type: "project",
    source_id: projectId,
    project_id: projectId,
    program_id: nextProgramId,
    summary: `edited project “${name}”`,
  });

  // Ownership and programme are access-bearing, so they are audited rather than
  // only recorded in the activity feed.
  if (before.owner_id !== ownerId || before.program_id !== nextProgramId) {
    await db.from("audit_event").insert({
      organization_id: session.organizationId,
      actor_id: session.userId,
      event_type: "project",
      action: "project_reassigned",
      object_type: "project",
      object_id: projectId,
      metadata: {
        previous_owner_id: before.owner_id,
        owner_id: ownerId,
        previous_program_id: before.program_id,
        program_id: nextProgramId,
      },
    });
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return { ok: true, id: projectId };
}
