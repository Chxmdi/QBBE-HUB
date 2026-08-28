"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  REFUSED_REQUEST_STATUSES,
  createProjectRequestSchema,
  decideApprovalSchema,
  decideProjectRequestSchema,
  requestApprovalSchema,
  updateProjectRequestSchema,
} from "@/features/requests/schemas";

/**
 * Intake writes.
 *
 * Two rules are worth stating because they are enforced elsewhere and only
 * surfaced here:
 *
 *   - Approving a request creates its project in one database transaction
 *     (`approve_project_request`). Doing it as two round trips would strand a
 *     project whenever the second one failed.
 *   - Only the person named on an approval can answer it. That lives in the
 *     policy, so a wrong caller simply changes no rows, and this code reports
 *     that as a permission message rather than a silent success.
 */

async function notify(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: {
    userId: string | null | undefined;
    actorId: string;
    organizationId: string;
    title: string;
    link: string;
    dedupeKey: string;
    urgency?: "normal" | "high";
  },
) {
  if (!input.userId || input.userId === input.actorId) return;
  await supabase.from("notification").upsert(
    {
      user_id: input.userId,
      organization_id: input.organizationId,
      category: "assignment",
      title: input.title,
      source_type: "request",
      link: input.link,
      urgency: input.urgency ?? "normal",
      dedupe_key: input.dedupeKey,
    },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
  );
}

export async function submitProjectRequest(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = createProjectRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase
    .from("project_request")
    .insert({
      organization_id: session.organizationId,
      title: data.title,
      summary: data.summary,
      rationale: data.rationale || null,
      beneficiaries: data.beneficiaries || null,
      program_id: data.programId || null,
      sponsor_id: data.sponsorId || null,
      needed_by: data.neededBy || null,
      estimated_effort: data.estimatedEffort || null,
      requested_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, error: "That request could not be submitted." };
  }

  // A named sponsor is being volunteered for something; tell them.
  await notify(supabase, {
    userId: data.sponsorId,
    actorId: session.userId,
    organizationId: session.organizationId,
    title: `You are named as sponsor: ${data.title}`,
    link: `/requests?request=${created.id}`,
    dedupeKey: `request-sponsor:${created.id}`,
  });

  revalidatePath("/requests");
  return { ok: true, id: created.id as string };
}

export async function updateProjectRequest(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = updateProjectRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { requestId, ...fields } = parsed.data;

  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.summary !== undefined) patch.summary = fields.summary;
  if (fields.rationale !== undefined) patch.rationale = fields.rationale || null;
  if (fields.beneficiaries !== undefined) {
    patch.beneficiaries = fields.beneficiaries || null;
  }
  if (fields.programId !== undefined) patch.program_id = fields.programId || null;
  if (fields.sponsorId !== undefined) patch.sponsor_id = fields.sponsorId || null;
  if (fields.neededBy !== undefined) patch.needed_by = fields.neededBy || null;
  if (fields.estimatedEffort !== undefined) {
    patch.estimated_effort = fields.estimatedEffort || null;
  }

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("project_request")
    .update(patch)
    .eq("id", requestId)
    .select("id");

  if (error || (updated ?? []).length === 0) {
    // The edit policy only covers your own request while it is untouched, so
    // "no rows" here means it has already been picked up.
    return {
      ok: false,
      error: "That request can no longer be edited — it is already being reviewed.",
    };
  }

  revalidatePath("/requests");
  return { ok: true, id: requestId };
}

export async function decideProjectRequest(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = decideProjectRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { requestId, status, decisionNote, projectName } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("project_request")
    .select("id, title, requested_by, status")
    .eq("id", requestId)
    .maybeSingle();

  if (!existing) {
    return { ok: false, error: "That request is not available to you." };
  }

  if (status === "approved") {
    // One transaction: the project is created and the request settled together.
    const { data: projectId, error } = await supabase.rpc("approve_project_request", {
      p_request_id: requestId,
      p_project_name: projectName || null,
      p_decision_note: decisionNote || null,
    });

    if (error || !projectId) {
      return {
        ok: false,
        error:
          "That request could not be approved — you may not have permission to create projects.",
      };
    }

    await notify(supabase, {
      userId: existing.requested_by as string,
      actorId: session.userId,
      organizationId: session.organizationId,
      title: `Approved: ${existing.title}`,
      link: `/projects/${projectId}`,
      dedupeKey: `request-decided:${requestId}`,
    });

    await supabase.from("activity_event").insert({
      organization_id: session.organizationId,
      actor_id: session.userId,
      verb: "approved",
      source_type: "project_request",
      source_id: requestId,
      project_id: projectId,
      summary: `approved “${existing.title}” and opened the project`,
    });

    revalidatePath("/requests");
    revalidatePath("/projects");
    return { ok: true, id: projectId as string };
  }

  const settling = REFUSED_REQUEST_STATUSES.includes(status);
  const { data: updated, error } = await supabase
    .from("project_request")
    .update({
      status,
      decision_note: decisionNote || null,
      decided_by: settling ? session.userId : null,
      decided_at: settling ? new Date().toISOString() : null,
    })
    .eq("id", requestId)
    .select("id");

  if (error || (updated ?? []).length === 0) {
    return { ok: false, error: "That decision could not be recorded." };
  }

  if (settling) {
    await notify(supabase, {
      userId: existing.requested_by as string,
      actorId: session.userId,
      organizationId: session.organizationId,
      title: `Not going ahead: ${existing.title}`,
      link: `/requests?request=${requestId}`,
      dedupeKey: `request-decided:${requestId}`,
    });
  }

  revalidatePath("/requests");
  return { ok: true, id: requestId };
}

export async function requestApproval(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = requestApprovalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase
    .from("approval_request")
    .insert({
      organization_id: session.organizationId,
      project_request_id: data.projectRequestId ?? null,
      report_id: data.reportId ?? null,
      opportunity_id: data.opportunityId ?? null,
      requested_by: session.userId,
      approver_id: data.approverId,
      note: data.note || null,
      due_at: data.dueAt || null,
    })
    .select("id")
    .single();

  if (error) {
    // The partial unique index is the likeliest refusal, and it means
    // something specific worth saying rather than "save failed".
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Someone is already being asked to decide this one.",
      };
    }
    return { ok: false, error: "That approval could not be requested." };
  }

  await notify(supabase, {
    userId: data.approverId,
    actorId: session.userId,
    organizationId: session.organizationId,
    title: "A decision is waiting on you",
    link: "/requests",
    dedupeKey: `approval-request:${created!.id}`,
    urgency: "high",
  });

  revalidatePath("/requests");
  return { ok: true, id: created!.id as string };
}

export async function decideApproval(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = decideApprovalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { approvalId, decision, decisionNote } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("approval_request")
    .select("id, requested_by, approver_id, decision")
    .eq("id", approvalId)
    .maybeSingle();

  if (!existing) {
    return { ok: false, error: "That approval is not available to you." };
  }
  if (existing.decision !== "pending") {
    return { ok: false, error: "That one has already been answered." };
  }

  const { data: updated, error } = await supabase
    .from("approval_request")
    .update({
      decision,
      decision_note: decisionNote || null,
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", approvalId)
    .select("id");

  // The policy lets only the named approver (or an admin) through, so an
  // update that changes nothing is a permission answer, not a lost write.
  if (error || (updated ?? []).length === 0) {
    return {
      ok: false,
      error: "Only the person asked can answer this — ask an administrator to reassign it.",
    };
  }

  await notify(supabase, {
    userId: existing.requested_by as string,
    actorId: session.userId,
    organizationId: session.organizationId,
    title:
      decision === "approved"
        ? "Your approval request was approved"
        : "Your approval request was answered",
    link: "/requests",
    dedupeKey: `approval-decided:${approvalId}`,
  });

  revalidatePath("/requests");
  return { ok: true, id: approvalId };
}
