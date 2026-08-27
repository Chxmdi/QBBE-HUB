"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  SETTLED_ISSUE_STATUSES,
  SETTLED_RISK_STATUSES,
  createIssueSchema,
  createRiskSchema,
  escalateRiskSchema,
  updateIssueSchema,
  updateRiskSchema,
} from "@/features/risks/schemas";

/**
 * Writes to the project risk and issue log.
 *
 * Every action runs as the signed-in person, so `risk_manage` and
 * `issue_manage` — which defer to the parent project — decide what is allowed.
 * There is no role check here: RLS is the boundary, and duplicating it in the
 * action would only create a second place for the two to disagree.
 */

/** Notifies a newly assigned owner, once, without notifying yourself. */
async function notifyOwner(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: {
    ownerId: string | null | undefined;
    actorId: string;
    organizationId: string;
    kind: "risk" | "issue";
    recordId: string;
    title: string;
    projectId: string;
  },
) {
  if (!input.ownerId || input.ownerId === input.actorId) return;
  await supabase.from("notification").upsert(
    {
      user_id: input.ownerId,
      organization_id: input.organizationId,
      category: "assignment",
      title:
        input.kind === "risk"
          ? `You own a risk: ${input.title}`
          : `You own an issue: ${input.title}`,
      source_type: input.kind,
      source_id: input.recordId,
      link: `/projects/${input.projectId}?tab=risks`,
      urgency: input.kind === "issue" ? "high" : "normal",
      dedupe_key: `${input.kind}-owner:${input.recordId}:${input.ownerId}`,
    },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
  );
}

export async function createRisk(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = createRiskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { projectId, title, description, likelihood, impact, mitigation, ownerId, reviewAt } =
    parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: risk, error } = await supabase
    .from("risk")
    .insert({
      organization_id: session.organizationId,
      project_id: projectId,
      title,
      description: description || null,
      likelihood,
      impact,
      mitigation: mitigation || null,
      owner_id: ownerId ?? null,
      review_at: reviewAt || null,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !risk) {
    return {
      ok: false,
      error: "You don't have permission to log risks on this project, or the save failed.",
    };
  }

  await notifyOwner(supabase, {
    ownerId,
    actorId: session.userId,
    organizationId: session.organizationId,
    kind: "risk",
    recordId: risk.id as string,
    title,
    projectId,
  });

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "created",
    source_type: "risk",
    source_id: risk.id,
    project_id: projectId,
    summary: `logged risk “${title}”`,
  });

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, id: risk.id as string };
}

export async function updateRisk(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = updateRiskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { riskId, ...fields } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.description !== undefined) patch.description = fields.description || null;
  if (fields.likelihood !== undefined) patch.likelihood = fields.likelihood;
  if (fields.impact !== undefined) patch.impact = fields.impact;
  if (fields.mitigation !== undefined) patch.mitigation = fields.mitigation || null;
  if (fields.ownerId !== undefined) patch.owner_id = fields.ownerId;
  if (fields.reviewAt !== undefined) patch.review_at = fields.reviewAt || null;
  if (fields.status !== undefined) {
    patch.status = fields.status;
    // Settling a risk is a decision with a date, so record when it was taken.
    patch.closed_at = SETTLED_RISK_STATUSES.includes(fields.status)
      ? new Date().toISOString()
      : null;
  }

  const { data: updated, error } = await supabase
    .from("risk")
    .update(patch)
    .eq("id", riskId)
    .select("id, title, project_id, owner_id")
    .maybeSingle();

  if (error || !updated) return { ok: false, error: "Could not update the risk." };

  if (fields.ownerId) {
    await notifyOwner(supabase, {
      ownerId: fields.ownerId,
      actorId: session.userId,
      organizationId: session.organizationId,
      kind: "risk",
      recordId: riskId,
      title: updated.title as string,
      projectId: updated.project_id as string,
    });
  }

  revalidatePath(`/projects/${updated.project_id}`);
  return { ok: true, id: riskId };
}

export async function createIssue(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = createIssueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { projectId, riskId, title, description, severity, ownerId, dueAt } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: issue, error } = await supabase
    .from("issue")
    .insert({
      organization_id: session.organizationId,
      project_id: projectId,
      risk_id: riskId ?? null,
      title,
      description: description || null,
      severity,
      owner_id: ownerId ?? null,
      due_at: dueAt || null,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !issue) {
    return {
      ok: false,
      error: "You don't have permission to log issues on this project, or the save failed.",
    };
  }

  await notifyOwner(supabase, {
    ownerId,
    actorId: session.userId,
    organizationId: session.organizationId,
    kind: "issue",
    recordId: issue.id as string,
    title,
    projectId,
  });

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "created",
    source_type: "issue",
    source_id: issue.id,
    project_id: projectId,
    summary: `raised issue “${title}”`,
  });

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, id: issue.id as string };
}

export async function updateIssue(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = updateIssueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { issueId, ...fields } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.description !== undefined) patch.description = fields.description || null;
  if (fields.severity !== undefined) patch.severity = fields.severity;
  if (fields.resolution !== undefined) patch.resolution = fields.resolution || null;
  if (fields.ownerId !== undefined) patch.owner_id = fields.ownerId;
  if (fields.dueAt !== undefined) patch.due_at = fields.dueAt || null;
  if (fields.status !== undefined) {
    patch.status = fields.status;
    patch.resolved_at = SETTLED_ISSUE_STATUSES.includes(fields.status)
      ? new Date().toISOString()
      : null;
  }

  const { data: updated, error } = await supabase
    .from("issue")
    .update(patch)
    .eq("id", issueId)
    .select("id, title, project_id")
    .maybeSingle();

  if (error || !updated) return { ok: false, error: "Could not update the issue." };

  if (fields.ownerId) {
    await notifyOwner(supabase, {
      ownerId: fields.ownerId,
      actorId: session.userId,
      organizationId: session.organizationId,
      kind: "issue",
      recordId: issueId,
      title: updated.title as string,
      projectId: updated.project_id as string,
    });
  }

  revalidatePath(`/projects/${updated.project_id}`);
  return { ok: true, id: issueId };
}

/**
 * A risk that came true. The issue keeps a pointer back, and the risk is closed
 * with a mitigation note explaining what happened — so the log reads as a
 * history rather than a row that quietly changed meaning.
 */
export async function escalateRiskToIssue(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = escalateRiskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { riskId, severity, description } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: risk } = await supabase
    .from("risk")
    .select("id, title, description, project_id, organization_id, owner_id, mitigation")
    .eq("id", riskId)
    .maybeSingle();

  if (!risk) return { ok: false, error: "That risk no longer exists." };

  const { data: issue, error } = await supabase
    .from("issue")
    .insert({
      organization_id: risk.organization_id,
      project_id: risk.project_id,
      risk_id: risk.id,
      title: risk.title,
      description: description || risk.description || null,
      severity,
      owner_id: risk.owner_id,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !issue) {
    return { ok: false, error: "Could not raise the issue from this risk." };
  }

  // The risk is now history. Closing it needs a reason, and "it happened" is
  // the truest one available.
  await supabase
    .from("risk")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      mitigation:
        risk.mitigation ?? "This risk materialised and was raised as an issue.",
    })
    .eq("id", riskId);

  await supabase.from("activity_event").insert({
    organization_id: risk.organization_id,
    actor_id: session.userId,
    verb: "updated",
    source_type: "issue",
    source_id: issue.id,
    project_id: risk.project_id,
    summary: `escalated risk “${risk.title}” to an issue`,
  });

  revalidatePath(`/projects/${risk.project_id}`);
  return { ok: true, id: issue.id as string };
}
