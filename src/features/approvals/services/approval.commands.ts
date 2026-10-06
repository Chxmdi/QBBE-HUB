"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLocale, getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  approvalDelegationSchema,
  approvalIssueText,
  approvalRuleSchema,
  commentApprovalSchema,
  decideApprovalSchema,
  submitApprovalSchema,
  withdrawApprovalSchema,
} from "@/features/approvals/schemas";

/**
 * Approval writes (#143).
 *
 * Items, steps and the trail are written only by database functions, which
 * enforce the rules (no self-approval, one person per step, admins only with
 * MFA) and write the notification and audit event in the same transaction.
 * This file validates input and turns refusals into sentences.
 */

interface DbError {
  code?: string;
  message?: string;
}

/** The database's own messages for refusals are written for people. */
function explain(error: DbError, fallback: string, t: TranslateFn): string {
  if (error.code === "42501" || error.code === "22023") return error.message ?? fallback;
  if (error.code === "23505") return t("finance.approvals.errors.alreadyWaiting");
  if (error.code === "23514") return t("finance.approvals.errors.checkAmountProgram");
  return fallback;
}

/** The first validation message, in the requester's language. */
async function firstIssue(error: z.ZodError, fallback: string): Promise<string> {
  const message = error.issues[0]?.message;
  return message ? approvalIssueText(message, await getLocale()) : fallback;
}

function refresh() {
  revalidatePath("/approvals");
}

export async function submitApproval(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  if (!session.isStaff) return { ok: false, error: t("finance.approvals.errors.staffOnly") };
  const limited = await enforceRateLimit("approval:submit", session.userId);
  if (limited) return limited;
  const parsed = submitApprovalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: await firstIssue(parsed.error, t("finance.approvals.errors.checkRequest")) };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: id, error } = await supabase.rpc("submit_approval", {
    p_organization: session.organizationId,
    p_subject_type: data.subjectType,
    p_title: data.title,
    p_amount_cents: data.amount,
    p_program_id: data.programId,
    p_description: data.description || null,
    p_subject_id: null,
  });
  if (error || !id) return { ok: false, error: explain(error ?? {}, t("finance.approvals.errors.submitFailed"), t) };
  refresh();
  return { ok: true, id: id as string };
}

export async function decideApproval(input: unknown): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  const parsed = decideApprovalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: await firstIssue(parsed.error, t("finance.approvals.errors.checkDecision")) };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("decide_approval", {
    p_item: parsed.data.itemId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note || null,
  });
  if (error) return { ok: false, error: explain(error, t("finance.approvals.errors.decideFailed"), t) };
  refresh();
  return { ok: true, id: parsed.data.itemId };
}

export async function commentOnApproval(input: unknown): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  const parsed = commentApprovalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: await firstIssue(parsed.error, t("finance.approvals.errors.writeComment")) };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("comment_on_approval", {
    p_item: parsed.data.itemId,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: explain(error, t("finance.approvals.errors.commentFailed"), t) };
  refresh();
  return { ok: true, id: parsed.data.itemId };
}

export async function withdrawApproval(input: unknown): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  const parsed = withdrawApprovalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: await firstIssue(parsed.error, t("finance.approvals.errors.checkRequest")) };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("withdraw_approval", {
    p_item: parsed.data.itemId,
    p_note: parsed.data.note || null,
  });
  if (error) return { ok: false, error: explain(error, t("finance.approvals.errors.withdrawFailed"), t) };
  refresh();
  return { ok: true, id: parsed.data.itemId };
}

// ---------------------------------------------------------------------------
// Away cover (delegation)
// ---------------------------------------------------------------------------

/**
 * Name a delegate for a date range. The database checks who may set it (the
 * approver, or an owner/admin with MFA for anyone), refuses chains and
 * overlaps, and writes the audit event.
 */
export async function setApprovalDelegation(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  if (!session.isStaff) return { ok: false, error: t("finance.approvals.away.errors.staffOnly") };
  const limited = await enforceRateLimit("approval:delegate", session.userId);
  if (limited) return limited;
  const parsed = approvalDelegationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: await firstIssue(parsed.error, t("finance.approvals.away.errors.checkDates")) };
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: id, error } = await supabase.rpc("set_approval_delegation", {
    p_organization: session.organizationId,
    p_approver: data.approverId ?? session.userId,
    p_delegate: data.delegateId,
    p_starts_on: data.startsOn,
    p_ends_on: data.endsOn,
    p_note: data.note || null,
  });
  if (error || !id) {
    return {
      ok: false,
      error:
        error?.code === "23514"
          ? (error.message ?? t("finance.approvals.away.errors.checkPeopleDates"))
          : explain(error ?? {}, t("finance.approvals.away.errors.setFailed"), t),
    };
  }
  refresh();
  return { ok: true, id: id as string };
}

export async function endApprovalDelegation(delegationId: string): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  if (!z.string().uuid().safeParse(delegationId).success) {
    return { ok: false, error: t("finance.approvals.away.errors.notFound") };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("end_approval_delegation", { p_delegation: delegationId });
  if (error) return { ok: false, error: explain(error, t("finance.approvals.away.errors.endFailed"), t) };
  refresh();
  return { ok: true, id: delegationId };
}

// ---------------------------------------------------------------------------
// Rules (Admin → Approvals)
// ---------------------------------------------------------------------------

async function auditRule(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  actorId: string,
  action: string,
  ruleId: string,
  metadata: Record<string, unknown> = {},
) {
  await supabase.from("audit_event").insert({
    organization_id: organizationId,
    actor_id: actorId,
    event_type: "approval",
    action,
    object_type: "approval_rule",
    object_id: ruleId,
    metadata,
  });
}

export async function createApprovalRule(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { session } = authorization;
  const t = await getT();
  const parsed = approvalRuleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: await firstIssue(parsed.error, t("finance.approvals.errors.checkRule")) };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("approval_rule")
    .insert({
      organization_id: session.organizationId,
      label: data.label,
      step: data.step,
      subject_type: data.subjectType,
      program_id: data.programId,
      min_amount_cents: data.minAmount ?? 0,
      max_amount_cents: data.maxAmount,
      approver_kind: data.approverKind,
      approver_user_id: data.approverKind === "person" ? data.approverUserId : null,
    })
    .select("id")
    .single();
  if (error || !row) {
    return {
      ok: false,
      error:
        error?.code === "23514"
          ? t("finance.approvals.errors.ruleConstraint")
          : t("finance.approvals.errors.ruleSaveFailed"),
    };
  }
  await auditRule(supabase, session.organizationId, session.userId, "rule_created", row.id as string, {
    label: data.label,
  });
  revalidatePath("/admin/approvals");
  return { ok: true, id: row.id as string };
}

export async function setApprovalRuleActive(ruleId: string, active: boolean): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { session } = authorization;
  const t = await getT();
  if (!z.string().uuid().safeParse(ruleId).success) {
    return { ok: false, error: t("finance.approvals.errors.ruleNotFound") };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("approval_rule")
    .update({ active })
    .eq("id", ruleId)
    .select("id");
  if (error || !data?.length) return { ok: false, error: t("finance.approvals.errors.ruleUpdateFailed") };
  await auditRule(supabase, session.organizationId, session.userId,
    active ? "rule_enabled" : "rule_disabled", ruleId);
  revalidatePath("/admin/approvals");
  return { ok: true, id: ruleId };
}

export async function deleteApprovalRule(ruleId: string): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { session } = authorization;
  const t = await getT();
  if (!z.string().uuid().safeParse(ruleId).success) {
    return { ok: false, error: t("finance.approvals.errors.ruleNotFound") };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("approval_rule").delete().eq("id", ruleId).select("id");
  if (error || !data?.length) return { ok: false, error: t("finance.approvals.errors.ruleDeleteFailed") };
  await auditRule(supabase, session.organizationId, session.userId, "rule_deleted", ruleId);
  revalidatePath("/admin/approvals");
  return { ok: true, id: ruleId };
}
