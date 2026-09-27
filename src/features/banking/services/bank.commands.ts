"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { fingerprint, sha256Hex } from "@/features/banking/fingerprint";
import {
  CSV_PRESETS,
  MAX_LINES,
  parseSignedCents,
  parseStatementFile,
  type CsvMapping,
} from "@/features/banking/parsers";

/**
 * Bank import and reconciliation actions (#151). Every write is for owners
 * and admins who completed MFA; the database checks the same thing again and
 * alone enforces the matching rules, de-duplication and the zero-difference
 * close. It also writes the audit record for each step.
 */

const BANK = "/finance/bank";
/** Largest statement file accepted, as text. Server actions take 1 MB. */
const MAX_FILE_CHARS = 900_000;

type DbError = { code?: string; message: string } | null;

const READABLE_CODES = new Set(["23514", "22023", "42501", "23505", "P0002"]);

function dbMessage(error: DbError, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "23503") return "An account or fund is not in this organization.";
  if (error.code === "23505" && /bank_account_organization_id_ledger_account_id_key/.test(error.message)) {
    return "Another bank account already uses that cash account.";
  }
  if (error.code === "23505" && /bank_reconciliation_bank_account_id_statement_end_key/.test(error.message)) {
    return "A statement ending that day already exists for this account.";
  }
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

async function authorize(): Promise<
  { ok: true; organizationId: string } | { ok: false; result: ActionResult }
> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, result: { ok: false, error: auth.error } };
  const limited = await enforceRateLimit("bank:write", auth.session.userId);
  if (limited) return { ok: false, result: limited };
  return { ok: true, organizationId: auth.session.organizationId };
}

const id = z.string().uuid();
const isoDate = (message: string) => requiredText(message).regex(/^\d{4}-\d{2}-\d{2}$/, message);
const signedMoney = (message: string) =>
  requiredText(message).transform((v, ctx) => {
    const cents = parseSignedCents(v);
    if (cents === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return cents;
  });

// ---------------------------------------------------------------------------
// Bank accounts
// ---------------------------------------------------------------------------

const INSTITUTIONS = ["desjardins", "national_bank", "rbc", "td", "bmo", "other"] as const;

const accountSchema = z.object({
  id: id.optional(),
  name: requiredText("Name the account, for example Chequing.", 120),
  institution: z.enum(INSTITUTIONS, { message: "Choose the bank." }),
  accountLast4: z
    .string()
    .trim()
    .regex(/^(\d{4})?$/, "Enter only the last four digits of the account number.")
    .optional(),
  ledgerAccountId: id.or(z.literal("")).refine(Boolean, "Choose the ledger cash account."),
  defaultFundId: id.or(z.literal("")).refine(Boolean, "Choose the fund."),
  reconcileFrom: isoDate("Choose the first day to reconcile."),
  isActive: z.boolean().default(true),
});

export async function saveBankAccount(input: unknown): Promise<ActionResult & { id?: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bank_save_account", {
    p_organization: auth.organizationId,
    p_id: d.id ?? null,
    p_name: d.name,
    p_institution: d.institution,
    p_account_last4: d.accountLast4 || null,
    p_ledger_account: d.ledgerAccountId,
    p_default_fund: d.defaultFundId,
    p_reconcile_from: d.reconcileFrom,
    p_is_active: d.isActive,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not save the bank account. Try again.") };
  revalidatePath(BANK, "layout");
  return { ok: true, id: data as string };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const mappingSchema = z.object({
  dateColumn: z.number().int().min(0).max(99),
  dateOrder: z.enum(["ymd", "mdy", "dmy"]),
  descriptionColumns: z.array(z.number().int().min(0).max(99)).min(1).max(4),
  amount: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("signed"), column: z.number().int().min(0).max(99), negate: z.boolean().optional() }),
    z.object({
      kind: z.literal("split"),
      withdrawal: z.number().int().min(0).max(99),
      deposit: z.number().int().min(0).max(99),
    }),
  ]),
  referenceColumn: z.number().int().min(0).max(99).nullable().optional(),
  skipRows: z.number().int().min(0).max(50),
});

const LAYOUTS = ["custom", ...CSV_PRESETS.map((p) => p.id)] as [string, ...string[]];

const importSchema = z.object({
  bankAccountId: id,
  fileName: requiredText("Choose a statement file.", 200),
  text: z
    .string({ required_error: "Choose a statement file." })
    .min(1, "The file is empty.")
    .max(MAX_FILE_CHARS, "The file is too large. Export a shorter date range."),
  layout: z.enum(LAYOUTS, { message: "Choose the bank's file layout." }),
  mapping: mappingSchema.optional(),
});

export interface ImportResult extends ActionResult {
  added?: number;
  skipped?: number;
  total?: number;
}

export async function importStatement(input: unknown): Promise<ImportResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const result = parseStatementFile(d.fileName, d.text, d.layout, d.mapping as CsvMapping | undefined);
  if (!result.ok) return { ok: false, error: result.error };
  const { statement } = result;
  if (statement.lines.length > MAX_LINES) return { ok: false, error: `A file can hold at most ${MAX_LINES} lines.` };

  const supabase = await createSupabaseServerClient();
  // An OFX file names its account; refuse one that is plainly another account.
  if (statement.accountLast4) {
    const { data: account } = await supabase
      .from("bank_account")
      .select("account_last4")
      .eq("id", d.bankAccountId)
      .maybeSingle();
    const last4 = (account as { account_last4: string | null } | null)?.account_last4;
    if (last4 && last4 !== statement.accountLast4) {
      return {
        ok: false,
        error: `This file is for the account ending ${statement.accountLast4}, not ${last4}.`,
      };
    }
  }

  const { data, error } = await supabase.rpc("bank_import_statement", {
    p_bank_account: d.bankAccountId,
    p_file_name: d.fileName,
    p_file_format: statement.format,
    p_layout: statement.layout,
    p_file_sha256: sha256Hex(d.text),
    p_lines: statement.lines.map((l) => ({
      posted_on: l.postedOn,
      amount_cents: l.amountCents,
      description: l.description,
      reference: l.reference,
      fingerprint: fingerprint(l.key),
    })),
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not import the statement. Try again.") };
  revalidatePath(BANK, "layout");
  const counts = data as { added: number; skipped: number };
  return { ok: true, added: counts.added, skipped: counts.skipped, total: statement.lines.length };
}

export async function deleteImport(importId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!id.safeParse(importId).success) return { ok: false, error: "Import not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_delete_import", { p_import: importId });
  if (error) return { ok: false, error: dbMessage(error, "Could not delete the import. Try again.") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export async function matchLine(
  transactionId: string,
  journalLineId: string,
  method: "suggested" | "manual",
): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!id.safeParse(transactionId).success || !id.safeParse(journalLineId).success) {
    return { ok: false, error: "Choose a ledger line to match." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_match_line", {
    p_transaction: transactionId,
    p_journal_line: journalLineId,
    p_method: method === "manual" ? "manual" : "suggested",
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not match the line. Try again.") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}

const acceptSchema = z.array(z.object({ transactionId: id, journalLineId: id })).min(1).max(500);

/** Accepts several suggestions; stops at the first the database refuses. */
export async function acceptSuggestions(input: unknown): Promise<ActionResult & { matched?: number }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "There are no suggestions to accept." };
  const supabase = await createSupabaseServerClient();
  let matched = 0;
  for (const s of parsed.data) {
    const { error } = await supabase.rpc("bank_match_line", {
      p_transaction: s.transactionId,
      p_journal_line: s.journalLineId,
      p_method: "suggested",
    });
    if (error) {
      revalidatePath(BANK, "layout");
      return { ok: false, matched, error: dbMessage(error, "Could not match every line. Try again.") };
    }
    matched++;
  }
  revalidatePath(BANK, "layout");
  return { ok: true, matched };
}

export async function unmatchLine(transactionId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!id.safeParse(transactionId).success) return { ok: false, error: "Line not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_unmatch_line", { p_transaction: transactionId });
  if (error) return { ok: false, error: dbMessage(error, "Could not undo the match. Try again.") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}

const createEntrySchema = z.object({
  transactionId: id,
  accountId: id.or(z.literal("")).refine(Boolean, "Choose the account for the other side."),
  fundId: id.optional().or(z.literal("")),
  programId: id.optional().or(z.literal("")),
  memo: z.string().trim().max(500).optional(),
});

export async function createEntryFromLine(input: unknown): Promise<ActionResult & { entryId?: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = createEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bank_create_entry", {
    p_transaction: d.transactionId,
    p_contra_account: d.accountId,
    p_fund: d.fundId || null,
    p_program: d.programId || null,
    p_memo: d.memo || null,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not create the entry. Try again.") };
  revalidatePath(BANK, "layout");
  revalidatePath("/finance/ledger", "layout");
  return { ok: true, entryId: data as string };
}

// ---------------------------------------------------------------------------
// Reconciliations
// ---------------------------------------------------------------------------

const startSchema = z
  .object({
    bankAccountId: id,
    statementStart: isoDate("Enter the statement's first day."),
    statementEnd: isoDate("Enter the statement's last day."),
    openingBalance: signedMoney("Enter the opening balance shown on the statement, like 1234.56."),
    closingBalance: signedMoney("Enter the closing balance shown on the statement, like 1234.56."),
  })
  .refine((v) => v.statementStart <= v.statementEnd, {
    message: "The statement ends on or after the day it starts.",
  });

export async function startReconciliation(input: unknown): Promise<ActionResult & { id?: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bank_start_reconciliation", {
    p_bank_account: d.bankAccountId,
    p_statement_start: d.statementStart,
    p_statement_end: d.statementEnd,
    p_opening_balance_cents: d.openingBalance,
    p_closing_balance_cents: d.closingBalance,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not start the reconciliation. Try again.") };
  revalidatePath(BANK, "layout");
  return { ok: true, id: data as string };
}

const balancesSchema = z.object({
  reconciliationId: id,
  openingBalance: signedMoney("Enter the opening balance shown on the statement, like 1234.56."),
  closingBalance: signedMoney("Enter the closing balance shown on the statement, like 1234.56."),
});

export async function updateReconciliationBalances(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = balancesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_update_reconciliation", {
    p_reconciliation: parsed.data.reconciliationId,
    p_opening_balance_cents: parsed.data.openingBalance,
    p_closing_balance_cents: parsed.data.closingBalance,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not save the balances. Try again.") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}

export async function setReconciliationStatus(
  reconciliationId: string,
  status: "open" | "reconciled",
): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!id.safeParse(reconciliationId).success || !["open", "reconciled"].includes(status)) {
    return { ok: false, error: "Reconciliation not found." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_set_reconciliation_status", {
    p_reconciliation: reconciliationId,
    p_status: status,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not change the reconciliation. Try again.") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}

export async function deleteReconciliation(reconciliationId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!id.safeParse(reconciliationId).success) return { ok: false, error: "Reconciliation not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_delete_reconciliation", { p_reconciliation: reconciliationId });
  if (error) return { ok: false, error: dbMessage(error, "Could not delete the reconciliation. Try again.") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}
