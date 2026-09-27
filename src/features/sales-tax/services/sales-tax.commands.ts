"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { parseMoneyToCents } from "@/features/ledger/money";
import { FILING_FREQUENCIES, TAX_CODES } from "@/features/sales-tax/return-lines";

/**
 * GST/QST actions (#152). Every write is for owners and admins who completed
 * MFA; the database checks the same thing again, enforces the tax rules and
 * closed periods, and writes the audit record for each step.
 */

const SALES_TAX = "/finance/sales-tax";

type DbError = { code?: string; message: string } | null;

// The tax functions raise with sentences written for people; anything else
// (row-level security, a network failure) gets a generic message.
const READABLE_CODES = new Set(["23514", "22023", "42501", "23505", "P0002"]);

function dbMessage(error: DbError, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "23514" && /violates check constraint/i.test(error.message)) {
    return "Check the values entered.";
  }
  if (
    error.code &&
    READABLE_CODES.has(error.code) &&
    !/row-level security|permission denied/i.test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}

const isoDate = (message: string) => requiredText(message).regex(/^\d{4}-\d{2}-\d{2}$/, message);

/** Optional money: blank means "let the database calculate it". */
const optionalMoney = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const cents = parseMoneyToCents(v);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Enter amounts like 12.34." });
      return z.NEVER;
    }
    return cents;
  });

async function authorize(): Promise<
  { ok: true; organizationId: string } | { ok: false; result: ActionResult }
> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, result: { ok: false, error: auth.error } };
  // Shares the ledger's budget: the same people write both.
  const limited = await enforceRateLimit("ledger:write", auth.session.userId);
  if (limited) return { ok: false, result: limited };
  return { ok: true, organizationId: auth.session.organizationId };
}

const settingsSchema = z.object({
  gstRegistered: z.boolean(),
  gstNumber: z.string().trim().max(40, "Registration numbers are at most 40 characters.").optional(),
  qstRegistered: z.boolean(),
  qstNumber: z.string().trim().max(40, "Registration numbers are at most 40 characters.").optional(),
  filingFrequency: z.enum(FILING_FREQUENCIES, { message: "Choose how often returns are filed." }),
  // A percent with up to two decimals, stored as basis points.
  claimPercent: requiredText("Enter the share of tax paid that can be claimed back.").regex(
    /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/,
    "Enter a percentage between 0 and 100.",
  ),
  showPsbRebate: z.boolean(),
});

export async function saveTaxSettings(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const [whole, fraction = ""] = parsed.data.claimPercent.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("sales_tax_save_settings", {
    p_organization: auth.organizationId,
    p_gst_registered: parsed.data.gstRegistered,
    p_gst_number: parsed.data.gstNumber ?? null,
    p_qst_registered: parsed.data.qstRegistered,
    p_qst_number: parsed.data.qstNumber ?? null,
    p_filing_frequency: parsed.data.filingFrequency,
    p_itc_claim_bp: basisPoints,
    p_show_psb_rebate: parsed.data.showPsbRebate,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not save the tax settings. Try again.") };
  revalidatePath(SALES_TAX, "layout");
  return { ok: true };
}

const periodSchema = z.object({
  startsOn: isoDate("Enter the first day of the period."),
  endsOn: isoDate("Enter the last day of the period."),
});

export async function createTaxPeriod(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = periodSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("sales_tax_create_period", {
    p_organization: auth.organizationId,
    p_starts_on: parsed.data.startsOn,
    p_ends_on: parsed.data.endsOn,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not add the period. Try again.") };
  revalidatePath(SALES_TAX, "layout");
  return { ok: true, id: data as string };
}

const lineSchema = z.object({
  id: z.string().uuid().optional(),
  direction: z.enum(["sale", "purchase"], { message: "Choose sale or purchase." }),
  taxCode: z.enum(TAX_CODES, { message: "Choose a tax code." }),
  transactionDate: isoDate("Enter the date of the transaction."),
  counterparty: requiredText("Enter who the sale or purchase was with.", 200),
  reference: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).optional(),
  amount: requiredText("Enter the amount before tax.").transform((v, ctx) => {
    const cents = parseMoneyToCents(v);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Enter the amount before tax like 12.34." });
      return z.NEVER;
    }
    return cents;
  }),
  gst: optionalMoney,
  qst: optionalMoney,
  itc: optionalMoney,
  itr: optionalMoney,
});

export async function saveTaxLine(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = lineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("sales_tax_save_line", {
    p_organization: auth.organizationId,
    p_line: d.id ?? null,
    p_direction: d.direction,
    p_tax_code: d.taxCode,
    p_transaction_date: d.transactionDate,
    p_counterparty: d.counterparty,
    p_reference: d.reference ?? null,
    p_description: d.description ?? null,
    p_amount_cents: d.amount,
    p_gst_cents: d.gst,
    p_qst_cents: d.qst,
    p_itc_cents: d.direction === "purchase" ? d.itc : null,
    p_itr_cents: d.direction === "purchase" ? d.itr : null,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not save the tax line. Try again.") };
  revalidatePath(SALES_TAX, "layout");
  return { ok: true, id: data as string };
}

export async function deleteTaxLine(lineId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!z.string().uuid().safeParse(lineId).success) return { ok: false, error: "Tax line not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("sales_tax_delete_line", { p_line: lineId });
  if (error) return { ok: false, error: dbMessage(error, "Could not delete the tax line. Try again.") };
  revalidatePath(SALES_TAX, "layout");
  return { ok: true };
}

const rangeSchema = z.object({
  from: isoDate("Enter the first date."),
  to: isoDate("Enter the last date."),
});

export async function importReceipts(input: unknown): Promise<ActionResult & { count?: number }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = rangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("sales_tax_import_receipts", {
    p_organization: auth.organizationId,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not bring in the receipts. Try again.") };
  revalidatePath(SALES_TAX, "layout");
  return { ok: true, count: Number(data ?? 0) };
}

export async function closeTaxPeriod(periodId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!z.string().uuid().safeParse(periodId).success) return { ok: false, error: "Tax period not found." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("sales_tax_close_period", { p_period: periodId });
  if (error) return { ok: false, error: dbMessage(error, "Could not close the period. Try again.") };
  revalidatePath(SALES_TAX, "layout");
  revalidatePath("/finance/ledger", "layout");
  return { ok: true, id: (data as string | null) ?? undefined };
}

const reopenSchema = z.object({
  periodId: z.string().uuid(),
  reversalDate: isoDate("Enter the date of the reversing entry."),
});

export async function reopenTaxPeriod(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("sales_tax_reopen_period", {
    p_period: parsed.data.periodId,
    p_reversal_date: parsed.data.reversalDate,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not reopen the period. Try again.") };
  revalidatePath(SALES_TAX, "layout");
  revalidatePath("/finance/ledger", "layout");
  return { ok: true };
}
