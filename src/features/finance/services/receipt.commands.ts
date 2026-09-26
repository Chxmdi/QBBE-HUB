"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { parseMoneyToCents } from "@/features/finance/money";
import { requiredText } from "@/lib/schema";

const money = (label: string, required: boolean) =>
  z
    .string()
    .nullish()
    .transform((raw, ctx) => {
      const value = (raw ?? "").trim();
      if (value === "" && !required) return 0;
      const cents = parseMoneyToCents(value);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: `Enter ${label} as an amount, like 42.18.` });
        return z.NEVER;
      }
      return cents;
    });

const receiptSchema = z
  .object({
    kind: z.enum(["receipt", "bill"]).default("receipt"),
    documentDate: requiredText("Enter the date on the receipt.").regex(
      /^\d{4}-\d{2}-\d{2}$/,
      "Enter the date on the receipt.",
    ),
    vendor: requiredText("Enter who was paid.", 200),
    total: money("the total", true),
    gst: money("the GST", false),
    qst: money("the QST", false),
    programId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    note: z.string().trim().max(2000).optional(),
    storagePath: requiredText("Upload the receipt file first.", 500),
    fileName: requiredText("Upload the receipt file first.", 200),
    mimeType: z.string().trim().max(200).optional(),
    sizeBytes: z.coerce.number().int().min(0).optional(),
  })
  .refine((r) => r.gst + r.qst <= r.total, {
    message: "GST and QST together cannot be more than the total.",
    path: ["gst"],
  });

/** Records a receipt after the browser has put its file in the receipts bucket. */
export async function registerReceipt(input: unknown): Promise<ActionResult> {
  const session = await requireStaff();
  const limited = await enforceRateLimit("receipt:submit", session.userId);
  if (limited) return limited;
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the receipt details." };
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
          ? "That project does not belong to the chosen program."
          : "Could not save the receipt. Try again.",
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
  if (!z.string().uuid().safeParse(receiptId).success) {
    return { ok: false, error: "Receipt not found." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("finance_receipt")
    .update({ status: reviewed ? "reviewed" : "submitted" })
    .eq("id", receiptId)
    .select("id")
    .maybeSingle();
  if (error?.code === "42501") {
    return { ok: false, error: "Only finance administrators can review receipts." };
  }
  if (error || !data) return { ok: false, error: "Could not update the receipt." };

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
  if (!z.string().uuid().safeParse(receiptId).success) {
    return { ok: false, error: "Receipt not found." };
  }
  const supabase = await createSupabaseServerClient();
  const { data: receipt } = await supabase
    .from("finance_receipt")
    .select("id, storage_path, scan_status")
    .eq("id", receiptId)
    .maybeSingle();
  if (!receipt) return { ok: false, error: "Receipt not found or not accessible." };
  if (receipt.scan_status !== "clean") {
    return { ok: false, error: "This file is still being checked or has been quarantined." };
  }
  const { data: signed, error } = await supabase.storage
    .from("receipts")
    .createSignedUrl(receipt.storage_path as string, 60);
  if (error || !signed) return { ok: false, error: "Could not open the file." };

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
