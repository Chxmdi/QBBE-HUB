"use server";

import { revalidatePath } from "next/cache";
import { authorizeAdminAction } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { opsEn } from "@/lib/i18n/messages/workspace/ops.en";
import type { MessageKey } from "@/lib/i18n/translate";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  classifyDocumentSchema,
  fiscalYearEndSchema,
  placeHoldSchema,
  releaseHoldSchema,
  saveRuleSchema,
} from "@/features/record-retention/schemas";

/**
 * Records retention and legal hold.
 *
 * `authorizeAdminAction` gives a clear sentence to somebody who is not an
 * administrator or has not completed MFA. It is not the boundary: row security
 * and the triggers in 20260927400000 are, and they also write the audit events
 * for every change here, so an edit made around this code is audited too.
 */

const PATH = "/admin/records";

/**
 * The first validation problem, in the reader's language. The schemas keep
 * their English sentences, which are the English catalogue values, so the
 * sentence finds its key; anything else (zod's own defaults) falls through.
 */
async function firstIssue(error: { issues: { message: string }[] }): Promise<string> {
  const t = await getT();
  const message = error.issues[0]?.message;
  if (!message) return t("records.errors.invalidInput");
  const key = Object.entries(opsEn.records.errors).find(([, text]) => text === message)?.[0];
  return key ? t(`records.errors.${key}` as MessageKey) : message;
}

export async function saveRetentionRule(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = saveRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: await firstIssue(parsed.error) };
  const { categoryKey, retainYears, confirmed, confirmationNote } = parsed.data;
  const session = authorization.session;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("record_retention_rule")
    .select("retain_years, confirmed_at")
    .eq("organization_id", session.organizationId)
    .eq("category_key", categoryKey)
    .maybeSingle();

  // Keep an existing confirmation only when the period is unchanged and the
  // box is still ticked; the database clears it when the period changes.
  const unchanged = existing && existing.retain_years === retainYears;
  const confirmedAt = confirmed
    ? unchanged && existing.confirmed_at
      ? existing.confirmed_at
      : new Date().toISOString()
    : null;

  const { error } = await supabase.from("record_retention_rule").upsert(
    {
      organization_id: session.organizationId,
      category_key: categoryKey,
      retain_years: retainYears,
      confirmed_at: confirmedAt,
      confirmation_note: confirmationNote || null,
    },
    { onConflict: "organization_id,category_key" },
  );
  // The trigger's message names the category and its floor.
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function saveFiscalYearEnd(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = fiscalYearEndSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: await firstIssue(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("record_retention_setting").upsert(
    {
      organization_id: authorization.session.organizationId,
      fiscal_year_end_month: parsed.data.month,
      fiscal_year_end_day: parsed.data.day,
    },
    { onConflict: "organization_id" },
  );
  if (error) return { ok: false, error: (await getT())("records.errors.yearEndNotSaved") };

  revalidatePath(PATH);
  return { ok: true };
}

export async function placeLegalHold(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = placeHoldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: await firstIssue(parsed.error) };
  const session = authorization.session;

  const target =
    parsed.data.scope === "category"
      ? { scope: "category", category_key: parsed.data.categoryKey }
      : { scope: "record", record_type: "document", record_id: parsed.data.recordId };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("legal_hold")
    .insert({
      organization_id: session.organizationId,
      ...target,
      reason: parsed.data.reason,
      placed_by: session.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true, id: data.id as string };
}

export async function releaseLegalHold(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = releaseHoldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: await firstIssue(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("legal_hold")
    .update({ released_at: new Date().toISOString(), release_reason: parsed.data.reason })
    .eq("id", parsed.data.holdId)
    .eq("organization_id", authorization.session.organizationId)
    .is("released_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: (await getT())("records.errors.holdNotActive") };
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function classifyDocument(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = classifyDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: await firstIssue(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("document")
    .update({
      record_category: parsed.data.categoryKey || null,
      record_date: parsed.data.recordDate || null,
    })
    .eq("id", parsed.data.documentId)
    .eq("organization_id", authorization.session.organizationId)
    .select("id");
  // The guard's message says why: a hold, or a change that would shorten
  // how long the record must be kept.
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: (await getT())("records.errors.documentNotFound") };
  }

  revalidatePath(PATH);
  return { ok: true };
}
