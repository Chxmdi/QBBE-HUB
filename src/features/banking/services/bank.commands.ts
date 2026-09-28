"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";
import type { bankEn } from "@/lib/i18n/messages/finance/bank.en";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { fingerprint, sha256Hex } from "@/features/banking/fingerprint";
import {
  CSV_PRESETS,
  MAX_LINES,
  parseSignedCents,
  parseStatementFile,
  translateParseError,
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

type ErrorName = keyof typeof bankEn.errors;
const E = (name: ErrorName): MessageKey => `finance.bank.errors.${name}`;

/**
 * Validation messages are catalogue keys (#141); this shows one in the
 * reader's language. Anything else (Zod's own wording) is shown as it came.
 */
function issueText(t: TranslateFn, message: string | undefined): string | undefined {
  if (message === undefined) return undefined;
  return message.startsWith("finance.bank.") ? t(message as MessageKey) : message;
}

function dbMessage(t: TranslateFn, error: DbError, fallback: ErrorName): string {
  if (!error) return t(E(fallback));
  if (error.code === "23503") return t(E("notInOrganization"));
  if (error.code === "23505" && /bank_account_organization_id_ledger_account_id_key/.test(error.message)) {
    return t(E("cashAccountTaken"));
  }
  if (error.code === "23505" && /bank_reconciliation_bank_account_id_statement_end_key/.test(error.message)) {
    return t(E("statementEndTaken"));
  }
  if (error.code === "23514" && /violates check constraint/i.test(error.message)) {
    return t(E("checkValues"));
  }
  if (
    error.code &&
    READABLE_CODES.has(error.code) &&
    !/row-level security|permission denied/i.test(error.message)
  ) {
    return error.message;
  }
  return t(E(fallback));
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
const isoDate = (message: MessageKey) => requiredText(message).regex(/^\d{4}-\d{2}-\d{2}$/, message);
const signedMoney = (message: MessageKey) =>
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
  name: requiredText(E("accountName"), 120),
  institution: z.enum(INSTITUTIONS, { message: E("chooseBank") }),
  accountLast4: z
    .string()
    .trim()
    .regex(/^(\d{4})?$/, E("last4"))
    .optional(),
  ledgerAccountId: id.or(z.literal("")).refine(Boolean, E("chooseLedgerAccount")),
  defaultFundId: id.or(z.literal("")).refine(Boolean, E("chooseFund")),
  reconcileFrom: isoDate(E("reconcileFrom")),
  isActive: z.boolean().default(true),
});

export async function saveBankAccount(input: unknown): Promise<ActionResult & { id?: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueText(t, parsed.error.issues[0]?.message) };
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
  if (error) return { ok: false, error: dbMessage(t, error, "saveAccount") };
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
  fileName: requiredText(E("chooseFile"), 200),
  text: z
    .string({ required_error: E("chooseFile") })
    .min(1, E("fileEmpty"))
    .max(MAX_FILE_CHARS, E("fileTooLarge")),
  layout: z.enum(LAYOUTS, { message: E("chooseLayout") }),
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
  const t = await getT();
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueText(t, parsed.error.issues[0]?.message) };
  const d = parsed.data;
  const result = parseStatementFile(d.fileName, d.text, d.layout, d.mapping as CsvMapping | undefined);
  if (!result.ok) return { ok: false, error: translateParseError(t, result) };
  const { statement } = result;
  if (statement.lines.length > MAX_LINES) return { ok: false, error: t(E("tooManyLines"), { max: MAX_LINES }) };

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
        error: t(E("wrongAccount"), { file: statement.accountLast4, account: last4 }),
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
  if (error) return { ok: false, error: dbMessage(t, error, "importFailed") };
  revalidatePath(BANK, "layout");
  const counts = data as { added: number; skipped: number };
  return { ok: true, added: counts.added, skipped: counts.skipped, total: statement.lines.length };
}

export async function deleteImport(importId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!id.safeParse(importId).success) return { ok: false, error: t(E("importNotFound")) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_delete_import", { p_import: importId });
  if (error) return { ok: false, error: dbMessage(t, error, "deleteImport") };
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
  const t = await getT();
  if (!id.safeParse(transactionId).success || !id.safeParse(journalLineId).success) {
    return { ok: false, error: t(E("chooseLedgerLine")) };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_match_line", {
    p_transaction: transactionId,
    p_journal_line: journalLineId,
    p_method: method === "manual" ? "manual" : "suggested",
  });
  if (error) return { ok: false, error: dbMessage(t, error, "matchFailed") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}

const acceptSchema = z.array(z.object({ transactionId: id, journalLineId: id })).min(1).max(500);

/** Accepts several suggestions; stops at the first the database refuses. */
export async function acceptSuggestions(input: unknown): Promise<ActionResult & { matched?: number }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t(E("noSuggestions")) };
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
      return { ok: false, matched, error: dbMessage(t, error, "matchSomeFailed") };
    }
    matched++;
  }
  revalidatePath(BANK, "layout");
  return { ok: true, matched };
}

export async function unmatchLine(transactionId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!id.safeParse(transactionId).success) return { ok: false, error: t(E("lineNotFound")) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_unmatch_line", { p_transaction: transactionId });
  if (error) return { ok: false, error: dbMessage(t, error, "unmatchFailed") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}

const createEntrySchema = z.object({
  transactionId: id,
  accountId: id.or(z.literal("")).refine(Boolean, E("chooseContraAccount")),
  fundId: id.optional().or(z.literal("")),
  programId: id.optional().or(z.literal("")),
  memo: z.string().trim().max(500).optional(),
});

export async function createEntryFromLine(input: unknown): Promise<ActionResult & { entryId?: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = createEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueText(t, parsed.error.issues[0]?.message) };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bank_create_entry", {
    p_transaction: d.transactionId,
    p_contra_account: d.accountId,
    p_fund: d.fundId || null,
    p_program: d.programId || null,
    p_memo: d.memo || null,
  });
  if (error) return { ok: false, error: dbMessage(t, error, "createEntryFailed") };
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
    statementStart: isoDate(E("statementStart")),
    statementEnd: isoDate(E("statementEnd")),
    openingBalance: signedMoney(E("openingBalance")),
    closingBalance: signedMoney(E("closingBalance")),
  })
  .refine((v) => v.statementStart <= v.statementEnd, {
    message: E("endBeforeStart"),
  });

export async function startReconciliation(input: unknown): Promise<ActionResult & { id?: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueText(t, parsed.error.issues[0]?.message) };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bank_start_reconciliation", {
    p_bank_account: d.bankAccountId,
    p_statement_start: d.statementStart,
    p_statement_end: d.statementEnd,
    p_opening_balance_cents: d.openingBalance,
    p_closing_balance_cents: d.closingBalance,
  });
  if (error) return { ok: false, error: dbMessage(t, error, "startFailed") };
  revalidatePath(BANK, "layout");
  return { ok: true, id: data as string };
}

const balancesSchema = z.object({
  reconciliationId: id,
  openingBalance: signedMoney(E("openingBalance")),
  closingBalance: signedMoney(E("closingBalance")),
});

export async function updateReconciliationBalances(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = balancesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueText(t, parsed.error.issues[0]?.message) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_update_reconciliation", {
    p_reconciliation: parsed.data.reconciliationId,
    p_opening_balance_cents: parsed.data.openingBalance,
    p_closing_balance_cents: parsed.data.closingBalance,
  });
  if (error) return { ok: false, error: dbMessage(t, error, "saveBalances") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}

export async function setReconciliationStatus(
  reconciliationId: string,
  status: "open" | "reconciled",
): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!id.safeParse(reconciliationId).success || !["open", "reconciled"].includes(status)) {
    return { ok: false, error: t(E("reconciliationNotFound")) };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_set_reconciliation_status", {
    p_reconciliation: reconciliationId,
    p_status: status,
  });
  if (error) return { ok: false, error: dbMessage(t, error, "statusFailed") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}

export async function deleteReconciliation(reconciliationId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!id.safeParse(reconciliationId).success) return { ok: false, error: t(E("reconciliationNotFound")) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bank_delete_reconciliation", { p_reconciliation: reconciliationId });
  if (error) return { ok: false, error: dbMessage(t, error, "deleteFailed") };
  revalidatePath(BANK, "layout");
  return { ok: true };
}
