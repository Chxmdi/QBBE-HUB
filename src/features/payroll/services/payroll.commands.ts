"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText, isCalendarDate } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { parseMoneyToCents } from "@/features/finance/money";
import { CATEGORY_KEYS, totalsAddUp, type RunCents } from "@/features/payroll/categories";
import { MAX_RUNS } from "@/features/payroll/parsers";

/**
 * Payroll actions (#155). Every write is for owners and admins who completed
 * MFA; the database checks the same thing again, builds the journal entry
 * itself from the stored totals and writes the audit record for each step.
 *
 * The import receives run totals only. The payroll file is read in the
 * browser, so employee names, SINs and per-employee lines never reach the
 * server.
 */

const PAYROLL = "/finance/payroll";

type DbError = { code?: string; message: string } | null;

// The payroll and ledger functions raise with sentences written for people;
// anything else (row-level security, a network failure) gets a generic one.
const READABLE_CODES = new Set(["22023", "42501", "23505", "23514", "P0002"]);

function dbMessage(error: DbError, fallback: string): string {
  if (!error) return fallback;
  if (
    error.code &&
    READABLE_CODES.has(error.code) &&
    !/row-level security|permission denied|violates|duplicate key/i.test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}

/**
 * A schema message is a catalogue key; anything else (a message zod wrote
 * itself) is shown as it is, since `t()` falls back to the text it was given.
 */
function issueMessage(t: TranslateFn, message: string | undefined): string | undefined {
  return message === undefined ? undefined : t(message as MessageKey, { max: MAX_RUNS });
}

async function authorize(): Promise<
  { ok: true; organizationId: string } | { ok: false; result: ActionResult }
> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, result: { ok: false, error: auth.error } };
  const limited = await enforceRateLimit("payroll:write", auth.session.userId);
  if (limited) return { ok: false, result: limited };
  return { ok: true, organizationId: auth.session.organizationId };
}

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "finance.payroll.errors.runDates" satisfies MessageKey).refine(isCalendarDate, "finance.payroll.errors.runDates" satisfies MessageKey);
const cents = z.number().int().min(0).max(10_000_000_000_000);

const runSchema = z
  .object({
    runReference: z.string().trim().max(60).nullable(),
    payDate: date,
    periodStart: date,
    periodEnd: date,
    cents: z.object(Object.fromEntries(CATEGORY_KEYS.map((k) => [k, cents])) as Record<keyof RunCents, typeof cents>),
  })
  // Only these keys: anything else in the payload is dropped, never stored.
  .strip()
  .refine((r) => totalsAddUp(r.cents as RunCents), {
    message: "finance.payroll.errors.runDoesNotAddUp" satisfies MessageKey,
  });

const importSchema = z.object({
  provider: z.enum(["nethris", "employeur_d", "adp_wfn", "ceridian_powerpay", "other"], {
    message: "finance.payroll.errors.chooseProvider" satisfies MessageKey,
  }),
  fileName: requiredText("finance.payroll.import.chooseFile" satisfies MessageKey, 200),
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  runs: z
    .array(runSchema)
    .min(1, "finance.payroll.errors.noRuns" satisfies MessageKey)
    .max(MAX_RUNS, "finance.payroll.errors.maxRuns" satisfies MessageKey),
});

export interface ImportResult extends ActionResult {
  added?: number;
  skipped?: number;
  ids?: string[];
}

export async function importPayrollRuns(input: unknown): Promise<ImportResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error.issues[0]?.message) };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("payroll_import_runs", {
    p_organization: auth.organizationId,
    p_provider: d.provider,
    p_file_name: d.fileName,
    p_file_sha256: d.fileSha256,
    p_runs: d.runs.map((r) => ({
      run_reference: r.runReference,
      pay_date: r.payDate,
      period_start: r.periodStart,
      period_end: r.periodEnd,
      ...Object.fromEntries(CATEGORY_KEYS.map((k) => [`${k}_cents`, r.cents[k]])),
    })),
  });
  if (error) return { ok: false, error: dbMessage(error, t("finance.payroll.errors.importFailed")) };
  revalidatePath(PAYROLL, "layout");
  const result = data as { added: number; skipped: number; ids: string[] };
  return { ok: true, added: result.added, skipped: result.skipped, ids: result.ids };
}

const mapSchema = z.array(
  z.object({
    category: z.enum(CATEGORY_KEYS as [string, ...string[]]),
    debitAccountId: id.nullable(),
    creditAccountId: id.nullable(),
  }),
);

export async function savePayrollAccountMap(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = mapSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("finance.payroll.errors.chooseAccounts") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("payroll_save_account_map", {
    p_organization: auth.organizationId,
    p_map: parsed.data.map((m) => ({
      category: m.category,
      debit_account_id: m.debitAccountId,
      credit_account_id: m.creditAccountId,
    })),
  });
  if (error) return { ok: false, error: dbMessage(error, t("finance.payroll.errors.saveMapFailed")) };
  revalidatePath(PAYROLL, "layout");
  return { ok: true };
}

const allocationSchema = z.object({
  runId: id,
  mode: z.enum(["percent", "amount"]),
  shares: z
    .array(
      z.object({
        fundId: z.string().uuid("finance.payroll.errors.chooseFundEveryShare" satisfies MessageKey),
        programId: z
          .string()
          .optional()
          .nullable()
          .transform((v) => v || null)
          .pipe(id.nullable()),
        value: z.string().trim(),
      }),
    )
    .max(20, "finance.payroll.errors.maxShares" satisfies MessageKey),
});

export async function savePayrollAllocation(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = allocationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error.issues[0]?.message) };
  const { runId, mode, shares } = parsed.data;
  const allocation: Record<string, string | number | null>[] = [];
  for (const [i, s] of shares.entries()) {
    if (mode === "percent") {
      if (!/^\d{1,3}([.,]\d{1,2})?$/.test(s.value)) {
        return { ok: false, error: t("finance.payroll.errors.sharePercent", { number: i + 1 }) };
      }
      allocation.push({ fund_id: s.fundId, program_id: s.programId, share_percent: s.value.replace(",", ".") });
    } else {
      const amount = parseMoneyToCents(s.value);
      if (amount === null || amount === 0) {
        return { ok: false, error: t("finance.payroll.errors.shareAmount", { number: i + 1 }) };
      }
      allocation.push({ fund_id: s.fundId, program_id: s.programId, share_cents: amount });
    }
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("payroll_save_allocation", { p_run: runId, p_allocation: allocation });
  if (error) return { ok: false, error: dbMessage(error, t("finance.payroll.errors.saveAllocationFailed")) };
  revalidatePath(`${PAYROLL}/${runId}`);
  return { ok: true };
}

export async function postPayrollRun(runId: string): Promise<ActionResult & { entryNumber?: number }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!id.safeParse(runId).success) return { ok: false, error: t("finance.payroll.errors.runNotFound") };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("payroll_post_run", { p_run: runId });
  if (error) return { ok: false, error: dbMessage(error, t("finance.payroll.errors.postFailed")) };
  revalidatePath(PAYROLL, "layout");
  revalidatePath("/finance/ledger", "layout");
  return { ok: true, entryNumber: data as number };
}

const reverseSchema = z.object({
  runId: id,
  entryDate: date,
  memo: z.string().trim().max(500).optional(),
});

export async function reversePayrollRun(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("finance.payroll.errors.chooseReversalDate") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("payroll_reverse_run", {
    p_run: parsed.data.runId,
    p_entry_date: parsed.data.entryDate,
    p_memo: parsed.data.memo || null,
  });
  if (error) return { ok: false, error: dbMessage(error, t("finance.payroll.errors.reverseFailed")) };
  revalidatePath(PAYROLL, "layout");
  revalidatePath("/finance/ledger", "layout");
  return { ok: true };
}

export async function deletePayrollDraft(runId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!id.safeParse(runId).success) return { ok: false, error: t("finance.payroll.errors.runNotFound") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("payroll_delete_draft", { p_run: runId });
  if (error) return { ok: false, error: dbMessage(error, t("finance.payroll.errors.deleteFailed")) };
  revalidatePath(PAYROLL, "layout");
  return { ok: true };
}
