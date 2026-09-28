"use server";

import { revalidatePath } from "next/cache";
import { createNotifications } from "@/features/jobs/services/notify";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { localizeIssue, recipientTranslators } from "@/features/projects/i18n";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  affectedRecordList,
  createDecisionRequestSchema,
  declineDecisionRequestSchema,
  recordProjectDecisionSchema,
  reopenDecisionSchema,
} from "@/features/risks/schemas";

/**
 * Project decisions and the requests that ask for them.
 *
 * Writes run as the signed-in person. Reading and managing follow the parent
 * project's policies; the database also refuses an assignee who cannot read
 * that project.
 */

export async function recordProjectDecision(
  input: unknown,
): Promise<ActionResult> {
  const t = await getT();
  const session = await requireSession();
  const parsed = recordProjectDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: localizeIssue(t, parsed.error.issues[0]?.message, "risks.errors.invalidInput"),
    };
  }
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: decision, error } = await supabase
    .from("decision")
    .insert({
      organization_id: session.organizationId,
      project_id: data.projectId,
      title: data.title,
      detail: data.detail || null,
      alternatives: data.alternatives || null,
      affected_records: affectedRecordList(data.affectedRecords),
      reopen_conditions: data.reopenConditions || null,
      decided_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !decision) {
    return {
      ok: false,
      error: t("risks.errors.noDecisionPermission"),
    };
  }

  if (data.requestId) {
    const { error: requestError } = await supabase
      .from("decision_request")
      .update({ status: "decided", decision_id: decision.id })
      .eq("id", data.requestId)
      .eq("status", "open");
    if (requestError) {
      return {
        ok: false,
        error: t("risks.errors.requestNotClosed"),
      };
    }
  }

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "created",
    source_type: "decision",
    source_id: decision.id,
    project_id: data.projectId,
    summary: `recorded decision “${data.title}”`,
  });

  revalidatePath(`/projects/${data.projectId}`);
  return { ok: true, id: decision.id as string };
}

export async function reopenDecision(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const session = await requireSession();
  const parsed = reopenDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: localizeIssue(t, parsed.error.issues[0]?.message, "risks.errors.invalidInput"),
    };
  }
  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("decision")
    .update({ reopened_at: new Date().toISOString() })
    .eq("id", parsed.data.decisionId)
    .select("id, project_id, title")
    .maybeSingle();
  if (error || !updated)
    return { ok: false, error: t("risks.errors.reopenFailed") };

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "updated",
    source_type: "decision",
    source_id: updated.id,
    project_id: updated.project_id,
    summary: `reopened decision “${updated.title}”`,
  });

  revalidatePath(`/projects/${updated.project_id}`);
  return { ok: true, id: updated.id as string };
}

export async function createDecisionRequest(
  input: unknown,
): Promise<ActionResult> {
  const t = await getT();
  const session = await requireSession();
  const parsed = createDecisionRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: localizeIssue(t, parsed.error.issues[0]?.message, "risks.errors.invalidInput"),
    };
  }
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: request, error } = await supabase
    .from("decision_request")
    .insert({
      organization_id: session.organizationId,
      project_id: data.projectId,
      requester_id: session.userId,
      assignee_id: data.assigneeId,
      due_at: data.dueAt,
      context: data.context,
    })
    .select("id")
    .single();

  if (error || !request) {
    const message = error?.message ?? "";
    if (message.includes("allowed to read")) {
      return {
        ok: false,
        error: t("risks.errors.assigneeCannotRead"),
      };
    }
    return {
      ok: false,
      error: t("risks.errors.noRequestPermission"),
    };
  }

  if (data.assigneeId !== session.userId) {
    // Through the shared path: an upsert needs the new row to pass the read
    // policy, which a notification for someone else never does, so this one
    // was refused and the person asked was never told.
    const assigneeT = (await recipientTranslators(supabase, [data.assigneeId]))(
      data.assigneeId,
    );
    await createNotifications(supabase, [
      {
        user_id: data.assigneeId,
        organization_id: session.organizationId,
        category: "assignment",
        title: assigneeT("risks.notifications.decisionRequested"),
        body: data.context,
        source_type: "decision_request",
        source_id: request.id,
        link: `/projects/${data.projectId}?tab=risks`,
        urgency: "high",
        dedupe_key: `decision-request:${request.id}`,
      },
    ]);
  }

  revalidatePath(`/projects/${data.projectId}`);
  return { ok: true, id: request.id as string };
}

export async function declineDecisionRequest(
  input: unknown,
): Promise<ActionResult> {
  const t = await getT();
  const session = await requireSession();
  const parsed = declineDecisionRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: localizeIssue(t, parsed.error.issues[0]?.message, "risks.errors.invalidInput"),
    };
  }
  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("decision_request")
    .update({ status: "declined" })
    .eq("id", parsed.data.requestId)
    .eq("status", "open")
    .select("id, project_id")
    .maybeSingle();
  if (error || !updated)
    return { ok: false, error: t("risks.errors.declineFailed") };

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "updated",
    source_type: "decision_request",
    source_id: updated.id,
    project_id: updated.project_id,
    summary: "declined a decision request",
  });

  revalidatePath(`/projects/${updated.project_id}`);
  return { ok: true, id: updated.id as string };
}
