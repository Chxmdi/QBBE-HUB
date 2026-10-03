"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { parseMoneyToCents } from "@/features/finance/money";
import { requiredText, isCalendarDate } from "@/lib/schema";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Validation messages are catalogue keys, translated when the action returns
 * one. Anything else (Zod's own wording) is shown as it is.
 */
function issueText(message: string, t: (key: MessageKey) => string): string {
  return message.startsWith("finance.receipts.") ? t(message as MessageKey) : message;
}

const money = (message: MessageKey, required: boolean) =>
  z
    .string()
    .nullish()
    .transform((raw, ctx) => {
      const value = (raw ?? "").trim();
      if (value === "" && !required) return 0;
      const cents = parseMoneyToCents(value);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return cents;
    });

const receiptSchema = z
  .object({
    kind: z.enum(["receipt", "bill"]).default("receipt"),
    documentDate: requiredText("finance.receipts.validation.dateRequired" satisfies MessageKey).regex(
      /^\d{4}-\d{2}-\d{2}$/,
      "finance.receipts.validation.dateRequired" satisfies MessageKey,
    ).refine(isCalendarDate, "finance.receipts.validation.dateRequired" satisfies MessageKey),
    vendor: requiredText("finance.receipts.validation.vendorRequired" satisfies MessageKey, 200),
    total: money("finance.receipts.validation.totalInvalid", true),
    gst: money("finance.receipts.validation.gstInvalid", false),
    qst: money("finance.receipts.validation.qstInvalid", false),
    programId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    note: z.string().trim().max(2000).optional(),
    storagePath: requiredText("finance.receipts.validation.fileRequired" satisfies MessageKey, 500),
    fileName: requiredText("finance.receipts.validation.fileRequired" satisfies MessageKey, 200),
    mimeType: z.string().trim().max(200).optional(),
    sizeBytes: z.coerce.number().int().min(0).optional(),
  })
  .refine((r) => r.gst + r.qst <= r.total, {
    message: "finance.receipts.validation.taxesOverTotal" satisfies MessageKey,
    path: ["gst"],
  });

/** Records a receipt after the browser has put its file in the receipts bucket. */
export async function registerReceipt(input: unknown): Promise<ActionResult> {
  const session = await requireStaff();
  const limited = await enforceRateLimit("receipt:submit", session.userId);
  if (limited) return limited;
  const t = await getT();
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return {
      ok: false,
      error: message ? issueText(message, t) : t("finance.receipts.validation.checkDetails"),
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("finance_receipt")
    .insert({
      organization_id: session.organizationId,
      submitted_by: session.userId,
      kind: data.kind,
      document_date: data.documentDate,
      vendor: data.vendor,
      total_cents: data.total,
      gst_cents: data.gst,
      qst_cents: data.qst,
      program_id: data.programId ?? null,
      project_id: data.projectId ?? null,
      note: data.note || null,
      storage_path: data.storagePath,
      file_name: data.fileName,
      mime_type: data.mimeType || null,
      size_bytes: data.sizeBytes ?? null,
    })
    .select("id")
    .single();

  if (error || !row) {
    return {
      ok: false,
      error:
        error?.code === "23514"
          ? t("finance.receipts.errors.projectProgram")
          : t("finance.receipts.errors.saveFailed"),
    };
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "finance",
    action: "receipt_submitted",
    object_type: "finance_receipt",
    object_id: row.id,
  });

  revalidatePath("/finance/receipts");
  return { ok: true, id: row.id as string };
}

/** Finance review. The database only lets owners/admins with MFA change it. */
export async function setReceiptReviewed(
  receiptId: string,
  reviewed: boolean,
): Promise<ActionResult> {
  const session = await requireStaff();
  const t = await getT();
  if (!z.string().uuid().safeParse(receiptId).success) {
    return { ok: false, error: t("finance.receipts.errors.notFound") };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("finance_receipt")
    .update({ status: reviewed ? "reviewed" : "submitted" })
    .eq("id", receiptId)
    .select("id")
    .maybeSingle();
  if (error?.code === "42501") {
    return { ok: false, error: t("finance.receipts.errors.adminOnly") };
  }
  if (error || !data) return { ok: false, error: t("finance.receipts.errors.updateFailed") };

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "finance",
    action: reviewed ? "receipt_reviewed" : "receipt_reopened",
    object_type: "finance_receipt",
    object_id: receiptId,
  });
  revalidatePath("/finance/receipts");
  return { ok: true, id: receiptId };
}

/** A one-minute link to the receipt file, only once it has been scanned clean. */
export async function openReceiptFile(
  receiptId: string,
): Promise<ActionResult & { url?: string }> {
  const session = await requireStaff();
  const t = await getT();
  if (!z.string().uuid().safeParse(receiptId).success) {
    return { ok: false, error: t("finance.receipts.errors.notFound") };
  }
  const supabase = await createSupabaseServerClient();
  const { data: receipt } = await supabase
    .from("finance_receipt")
    .select("id, storage_path, scan_status")
    .eq("id", receiptId)
    .maybeSingle();
  if (!receipt) return { ok: false, error: t("finance.receipts.errors.notAccessible") };
  if (receipt.scan_status !== "clean") {
    return { ok: false, error: t("finance.receipts.errors.stillChecking") };
  }
  const { data: signed, error } = await supabase.storage
    .from("receipts")
    .createSignedUrl(receipt.storage_path as string, 60);
  if (error || !signed) return { ok: false, error: t("finance.receipts.errors.openFailed") };

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "finance",
    action: "receipt_file_opened",
    object_type: "finance_receipt",
    object_id: receiptId,
  });
  return { ok: true, url: signed.signedUrl };
}

const receiptTextSchema = z.object({
  id: z.string().uuid(),
  text: z.string().max(400_000),
  source: z.enum(["pdf_text", "ocr"]),
});

/**
 * Stores the words read out of a receipt's file, so library search finds the
 * receipt by what is printed on it (#147). Search only: the figures are what
 * the submitter typed, never this text.
 */
export async function saveReceiptText(input: unknown): Promise<ActionResult> {
  await requireStaff();
  const parsed = receiptTextSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not store the receipt's text." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_receipt_text", {
    p_receipt: parsed.data.id,
    p_text: parsed.data.text,
    p_source: parsed.data.source,
  });
  if (error) return { ok: false, error: "Could not store the receipt's text." };
  return { ok: true, id: parsed.data.id };
}
