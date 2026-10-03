"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText, isCalendarDate, isCalendarMonth } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  ACCOUNT_TYPES,
  FUND_RESTRICTIONS,
  parseMoneyToCents,
} from "@/features/ledger/money";

/**
 * Bookkeeping actions (#148, #149). Every write is for owners and admins who
 * completed MFA; the database checks the same thing again, and it alone
 * enforces balance, closed periods, fund rules and immutability. It also
 * writes the audit record for each step, so none is written here.
 */

const LEDGER = "/finance/ledger";

type DbError = { code?: string; message: string } | null;

// The ledger's own rules raise with sentences written for people; anything
// else (row-level security, a network failure) gets a generic message.
const READABLE_CODES = new Set(["23514", "22023", "42501", "23505", "P0002"]);

function dbMessage(t: TranslateFn, error: DbError, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "23503") return t("finance.ledger.errors.notInOrganization");
  if (error.code === "23505" && /unique|duplicate/i.test(error.message)) {
    return error.message.includes("reversed") ? error.message : t("finance.ledger.errors.codeUsed");
  }
  if (error.code === "23514" && /violates check constraint/i.test(error.message)) {
    return t("finance.ledger.errors.checkValues");
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

/** Validation messages are catalogue keys, translated when the action returns. */
const K = (key: MessageKey): string => key;

/** A validation message in the reader's language; one that is not a key shows as is. */
function issueMessage(t: TranslateFn, message: string | undefined): string | undefined {
  return message === undefined ? undefined : t(message as MessageKey);
}

const isoDate = (message: string) =>
  requiredText(message).regex(/^\d{4}-\d{2}-\d{2}$/, message).refine(isCalendarDate, message);

const optionalDate = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, K("finance.ledger.errors.datesFormat"))
  .refine((value) => value === "" || isCalendarDate(value), K("finance.ledger.errors.datesFormat"))
  .optional()
  .transform((v) => v || null);

async function authorize(): Promise<
  { ok: true; organizationId: string; userId: string } | { ok: false; result: ActionResult }
> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, result: { ok: false, error: auth.error } };
  const limited = await enforceRateLimit("ledger:write", auth.session.userId);
  if (limited) return { ok: false, result: limited };
  return { ok: true, organizationId: auth.session.organizationId, userId: auth.session.userId };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const approvalSchema = z.object({
  approvedOn: isoDate(K("finance.ledger.errors.approvalDate")),
  approvedByName: requiredText(K("finance.ledger.errors.approvalName"), 200),
});

export async function recordChartApproval(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error.issues[0]?.message) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_record_chart_approval", {
    p_organization: auth.organizationId,
    p_approved_on: parsed.data.approvedOn,
    p_approved_by_name: parsed.data.approvedByName,
  });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.ledger.errors.recordApproval")) };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

const fiscalYearSchema = z.object({
  startMonth: requiredText(K("finance.ledger.errors.firstMonth")).refine(isCalendarMonth, K("finance.ledger.errors.firstMonth")),
});

export async function createFiscalYear(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = fiscalYearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error.issues[0]?.message) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_create_fiscal_year", {
    p_organization: auth.organizationId,
    p_starts_on: `${parsed.data.startMonth}-01`,
  });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.ledger.errors.createPeriods")) };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

export async function setPeriodStatus(periodId: string, status: "open" | "closed"): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!z.string().uuid().safeParse(periodId).success || !["open", "closed"].includes(status)) {
    return { ok: false, error: t("finance.ledger.errors.periodNotFound") };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_set_period_status", { p_period: periodId, p_status: status });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.ledger.errors.changePeriod")) };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Chart of accounts and funds
// ---------------------------------------------------------------------------

const accountSchema = z.object({
  id: z.string().uuid().optional(),
  code: requiredText(K("finance.ledger.errors.accountCode")).regex(/^[0-9]{3,6}$/, K("finance.ledger.errors.accountCodeFormat")),
  name: requiredText(K("finance.ledger.errors.accountName"), 200),
  accountType: z.enum(ACCOUNT_TYPES, { message: K("finance.ledger.errors.accountType") }),
  description: z.string().trim().max(1000).optional(),
  isActive: z.boolean().default(true),
});

export async function saveAccount(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error.issues[0]?.message) };
  const d = parsed.data;
  const row = {
    code: d.code,
    name: d.name,
    account_type: d.accountType,
    description: d.description || null,
    is_active: d.isActive,
  };
  const supabase = await createSupabaseServerClient();
  const { data, error } = d.id
    ? await supabase
        .from("ledger_account")
        .update(row)
        .eq("id", d.id)
        .eq("organization_id", auth.organizationId)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("ledger_account")
        .insert({ ...row, organization_id: auth.organizationId })
        .select("id")
        .single();
  if (error || !data) return { ok: false, error: dbMessage(t, error, t("finance.ledger.errors.saveAccount")) };
  revalidatePath(LEDGER, "layout");
  return { ok: true, id: data.id as string };
}

const fundSchema = z
  .object({
    id: z.string().uuid().optional(),
    code: requiredText(K("finance.ledger.errors.fundCode")).regex(
      /^[A-Z0-9][A-Z0-9-]{0,19}$/,
      K("finance.ledger.errors.fundCodeFormat"),
    ),
    name: requiredText(K("finance.ledger.errors.fundName"), 200),
    restriction: z.enum(FUND_RESTRICTIONS, { message: K("finance.ledger.errors.fundRestriction") }),
    funder: z.string().trim().max(200).optional(),
    startsOn: optionalDate,
    endsOn: optionalDate,
    description: z.string().trim().max(1000).optional(),
    isActive: z.boolean().default(true),
    programIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .refine((f) => !f.startsOn || !f.endsOn || f.startsOn <= f.endsOn, {
    message: K("finance.ledger.errors.fundDates"),
    path: ["endsOn"],
  });

export async function saveFund(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = fundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error.issues[0]?.message) };
  const d = parsed.data;
  const row = {
    code: d.code,
    name: d.name,
    restriction: d.restriction,
    funder: d.funder || null,
    starts_on: d.startsOn,
    ends_on: d.endsOn,
    description: d.description || null,
    is_active: d.isActive,
  };
  const supabase = await createSupabaseServerClient();
  const { data, error } = d.id
    ? await supabase
        .from("ledger_fund")
        .update(row)
        .eq("id", d.id)
        .eq("organization_id", auth.organizationId)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("ledger_fund")
        .insert({ ...row, organization_id: auth.organizationId })
        .select("id")
        .single();
  if (error || !data) return { ok: false, error: dbMessage(t, error, t("finance.ledger.errors.saveFund")) };
  const fundId = data.id as string;

  // Unrestricted funds carry no program limits.
  const wanted = new Set(d.restriction === "unrestricted" ? [] : d.programIds);
  const { data: current, error: readError } = await supabase
    .from("ledger_fund_program")
    .select("program_id")
    .eq("fund_id", fundId);
  if (readError) return { ok: false, error: t("finance.ledger.errors.fundPrograms") };
  const have = new Set((current ?? []).map((r) => r.program_id as string));
  const remove = [...have].filter((id) => !wanted.has(id));
  const add = [...wanted].filter((id) => !have.has(id));
  if (remove.length > 0) {
    const { error: removeError } = await supabase
      .from("ledger_fund_program")
      .delete()
      .eq("fund_id", fundId)
      .in("program_id", remove);
    if (removeError) return { ok: false, error: t("finance.ledger.errors.fundPrograms") };
  }
  if (add.length > 0) {
    const { error: addError } = await supabase.from("ledger_fund_program").insert(
      add.map((programId) => ({
        organization_id: auth.organizationId,
        fund_id: fundId,
        program_id: programId,
      })),
    );
    if (addError) return { ok: false, error: dbMessage(t, addError, t("finance.ledger.errors.fundPrograms")) };
  }
  revalidatePath(LEDGER, "layout");
  return { ok: true, id: fundId };
}

// ---------------------------------------------------------------------------
// Journal entries
// ---------------------------------------------------------------------------

const lineSchema = z
  .object({
    accountId: z.string().uuid({ message: K("finance.ledger.errors.lineAccount") }),
    fundId: z.string().uuid({ message: K("finance.ledger.errors.lineFund") }),
    programId: z.string().uuid().optional().or(z.literal("")),
    projectId: z.string().uuid().optional().or(z.literal("")),
    description: z.string().trim().max(500).optional(),
    debit: z.string().trim().max(30).optional(),
    credit: z.string().trim().max(30).optional(),
  })
  .transform((line, ctx) => {
    const debit = line.debit ? parseMoneyToCents(line.debit) : 0;
    const credit = line.credit ? parseMoneyToCents(line.credit) : 0;
    if (debit === null || credit === null) {
      ctx.addIssue({ code: "custom", message: K("finance.ledger.errors.lineAmount") });
      return z.NEVER;
    }
    if ((debit > 0) === (credit > 0)) {
      ctx.addIssue({ code: "custom", message: K("finance.ledger.errors.lineDebitOrCredit") });
      return z.NEVER;
    }
    return {
      account_id: line.accountId,
      fund_id: line.fundId,
      program_id: line.programId || null,
      project_id: line.projectId || null,
      description: line.description || null,
      debit_cents: debit,
      credit_cents: credit,
    };
  });

const entrySchema = z
  .object({
    entryId: z.string().uuid().optional(),
    entryDate: isoDate(K("finance.ledger.errors.entryDate")),
    memo: requiredText(K("finance.ledger.errors.entryMemo"), 500),
    kind: z.enum(["standard", "opening"]).default("standard"),
    lines: z.array(lineSchema).min(2, K("finance.ledger.errors.entryLines")).max(500),
    post: z.boolean().default(false),
  })
  .refine(
    (e) =>
      e.lines.reduce((s, l) => s + l.debit_cents, 0) === e.lines.reduce((s, l) => s + l.credit_cents, 0),
    { message: K("finance.ledger.errors.unbalanced"), path: ["lines"] },
  );

/** Saves a draft (and posts it when asked). A failed post leaves the draft saved. */
export async function saveEntry(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error.issues[0]?.message) };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: entryId, error } = await supabase.rpc("ledger_save_draft", {
    p_organization: auth.organizationId,
    p_entry: d.entryId ?? null,
    p_entry_date: d.entryDate,
    p_memo: d.memo,
    p_kind: d.kind,
    p_lines: d.lines,
  });
  if (error || !entryId) return { ok: false, error: dbMessage(t, error, t("finance.ledger.errors.saveEntry")) };
  revalidatePath(LEDGER, "layout");
  if (d.post) {
    const { error: postError } = await supabase.rpc("ledger_post_entry", { p_entry: entryId });
    if (postError) {
      return {
        ok: false,
        id: entryId as string,
        error: t("finance.ledger.errors.savedNotPosted", { reason: dbMessage(t, postError, t("finance.ledger.errors.tryPostingAgain")) }),
      };
    }
  }
  return { ok: true, id: entryId as string };
}

export async function postEntry(entryId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!z.string().uuid().safeParse(entryId).success) return { ok: false, error: t("finance.ledger.errors.entryNotFound") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_post_entry", { p_entry: entryId });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.ledger.errors.postEntry")) };
  revalidatePath(LEDGER, "layout");
  return { ok: true, id: entryId };
}

export async function deleteDraft(entryId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!z.string().uuid().safeParse(entryId).success) return { ok: false, error: t("finance.ledger.errors.entryNotFound") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_delete_draft", { p_entry: entryId });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.ledger.errors.deleteDraft")) };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

const reverseSchema = z.object({
  entryId: z.string().uuid(),
  entryDate: isoDate(K("finance.ledger.errors.reversalDate")),
  memo: z.string().trim().max(500).optional(),
});

export async function reverseEntry(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error.issues[0]?.message) };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ledger_reverse_entry", {
    p_entry: parsed.data.entryId,
    p_entry_date: parsed.data.entryDate,
    p_memo: parsed.data.memo || null,
  });
  if (error || !data) return { ok: false, error: dbMessage(t, error, t("finance.ledger.errors.reverseEntry")) };
  revalidatePath(LEDGER, "layout");
  return { ok: true, id: data as string };
}

// ---------------------------------------------------------------------------
// Releasing restricted money (#149)
// ---------------------------------------------------------------------------

const releaseSchema = z.object({
  fromFundId: z
    .string({ message: K("finance.ledger.release.errors.chooseRestricted") })
    .uuid(K("finance.ledger.release.errors.chooseRestricted")),
  toFundId: z
    .string({ message: K("finance.ledger.release.errors.chooseUnrestricted") })
    .uuid(K("finance.ledger.release.errors.chooseUnrestricted")),
  amount: requiredText(K("finance.ledger.release.errors.amount")),
  releaseDate: isoDate(K("finance.ledger.release.errors.date")),
  condition: requiredText(K("finance.ledger.release.errors.condition"), 300),
});

/**
 * Moves restricted money to an unrestricted fund once its condition is met.
 * The database posts the balanced entry and refuses an unrestricted source,
 * more than the fund's available balance, and a closed period.
 */
export async function releaseRestricted(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error.issues[0]?.message) };
  const cents = parseMoneyToCents(parsed.data.amount);
  if (cents === null || cents <= 0) {
    return { ok: false, error: t("finance.ledger.release.errors.amountPositive") };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ledger_release_restricted", {
    p_organization: auth.organizationId,
    p_from_fund: parsed.data.fromFundId,
    p_to_fund: parsed.data.toFundId,
    p_amount_cents: cents,
    p_release_date: parsed.data.releaseDate,
    p_condition: parsed.data.condition,
  });
  if (error || !data) return { ok: false, error: dbMessage(t, error, t("finance.ledger.release.errors.failed")) };
  revalidatePath(LEDGER, "layout");
  return { ok: true, id: data as string };
}

/**
 * What a restricted fund can release on a given date, for the release form's
 * hint. The same database function the release itself checks, so the hint and
 * the refusal agree. Read-only; returns null when it cannot be answered.
 */
export async function fundAvailableOn(fundId: unknown, date: unknown): Promise<number | null> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return null;
  const parsed = z
    .object({ fundId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate) })
    .safeParse({ fundId, date });
  if (!parsed.success) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ledger_fund_available_cents", {
    p_fund: parsed.data.fundId,
    p_as_of: parsed.data.date,
  });
  return error ? null : Number(data ?? 0);
}

// ---------------------------------------------------------------------------
// Who may read the books
// ---------------------------------------------------------------------------

export async function grantLedgerReader(userId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: t("finance.ledger.errors.chooseStaff") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("ledger_reader")
    .insert({ organization_id: auth.organizationId, user_id: userId });
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? t("finance.ledger.errors.alreadyReader") : dbMessage(t, error, t("finance.ledger.errors.grantAccess")),
    };
  }
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

export async function revokeLedgerReader(userId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: t("finance.ledger.errors.readerNotFound") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("ledger_reader")
    .delete()
    .eq("organization_id", auth.organizationId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.ledger.errors.removeAccess")) };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}
