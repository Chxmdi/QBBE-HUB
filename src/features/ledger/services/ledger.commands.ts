"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

function dbMessage(error: DbError, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "23503") return "An account, fund, program or project is not in this organization.";
  if (error.code === "23505" && /unique|duplicate/i.test(error.message)) {
    return error.message.includes("reversed") ? error.message : "That code is already used.";
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

const isoDate = (message: string) =>
  requiredText(message).regex(/^\d{4}-\d{2}-\d{2}$/, message);

const optionalDate = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Enter dates as YYYY-MM-DD.")
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
  approvedOn: isoDate("Enter the date the accountant approved the chart."),
  approvedByName: requiredText("Name the accountant who approved the chart.", 200),
});

export async function recordChartApproval(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_record_chart_approval", {
    p_organization: auth.organizationId,
    p_approved_on: parsed.data.approvedOn,
    p_approved_by_name: parsed.data.approvedByName,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not record the approval. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

const fiscalYearSchema = z.object({
  startMonth: requiredText("Choose the first month of the fiscal year.").regex(
    /^\d{4}-\d{2}$/,
    "Choose the first month of the fiscal year.",
  ),
});

export async function createFiscalYear(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = fiscalYearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_create_fiscal_year", {
    p_organization: auth.organizationId,
    p_starts_on: `${parsed.data.startMonth}-01`,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not create the periods. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

export async function setPeriodStatus(periodId: string, status: "open" | "closed"): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!z.string().uuid().safeParse(periodId).success || !["open", "closed"].includes(status)) {
    return { ok: false, error: "Period not found." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_set_period_status", { p_period: periodId, p_status: status });
  if (error) return { ok: false, error: dbMessage(error, "Could not change the period. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Chart of accounts and funds
// ---------------------------------------------------------------------------

const accountSchema = z.object({
  id: z.string().uuid().optional(),
  code: requiredText("Enter an account code.").regex(/^[0-9]{3,6}$/, "Account codes are 3 to 6 digits."),
  name: requiredText("Enter the account name.", 200),
  accountType: z.enum(ACCOUNT_TYPES, { message: "Choose the account type." }),
  description: z.string().trim().max(1000).optional(),
  isActive: z.boolean().default(true),
});

export async function saveAccount(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
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
  if (error || !data) return { ok: false, error: dbMessage(error, "Could not save the account. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true, id: data.id as string };
}

const fundSchema = z
  .object({
    id: z.string().uuid().optional(),
    code: requiredText("Enter a fund code.").regex(
      /^[A-Z0-9][A-Z0-9-]{0,19}$/,
      "Fund codes are up to 20 capital letters, digits and dashes.",
    ),
    name: requiredText("Enter the fund name.", 200),
    restriction: z.enum(FUND_RESTRICTIONS, { message: "Choose how the fund is restricted." }),
    funder: z.string().trim().max(200).optional(),
    startsOn: optionalDate,
    endsOn: optionalDate,
    description: z.string().trim().max(1000).optional(),
    isActive: z.boolean().default(true),
    programIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .refine((f) => !f.startsOn || !f.endsOn || f.startsOn <= f.endsOn, {
    message: "The end date must be on or after the start date.",
    path: ["endsOn"],
  });

export async function saveFund(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = fundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
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
  if (error || !data) return { ok: false, error: dbMessage(error, "Could not save the fund. Try again.") };
  const fundId = data.id as string;

  // Unrestricted funds carry no program limits.
  const wanted = new Set(d.restriction === "unrestricted" ? [] : d.programIds);
  const { data: current, error: readError } = await supabase
    .from("ledger_fund_program")
    .select("program_id")
    .eq("fund_id", fundId);
  if (readError) return { ok: false, error: "The fund was saved but its programs could not be updated." };
  const have = new Set((current ?? []).map((r) => r.program_id as string));
  const remove = [...have].filter((id) => !wanted.has(id));
  const add = [...wanted].filter((id) => !have.has(id));
  if (remove.length > 0) {
    const { error: removeError } = await supabase
      .from("ledger_fund_program")
      .delete()
      .eq("fund_id", fundId)
      .in("program_id", remove);
    if (removeError) return { ok: false, error: "The fund was saved but its programs could not be updated." };
  }
  if (add.length > 0) {
    const { error: addError } = await supabase.from("ledger_fund_program").insert(
      add.map((programId) => ({
        organization_id: auth.organizationId,
        fund_id: fundId,
        program_id: programId,
      })),
    );
    if (addError) return { ok: false, error: dbMessage(addError, "The fund was saved but its programs could not be updated.") };
  }
  revalidatePath(LEDGER, "layout");
  return { ok: true, id: fundId };
}

// ---------------------------------------------------------------------------
// Journal entries
// ---------------------------------------------------------------------------

const lineSchema = z
  .object({
    accountId: z.string().uuid({ message: "Choose an account on every line." }),
    fundId: z.string().uuid({ message: "Choose a fund on every line." }),
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
      ctx.addIssue({ code: "custom", message: "Enter amounts like 1234.56." });
      return z.NEVER;
    }
    if ((debit > 0) === (credit > 0)) {
      ctx.addIssue({ code: "custom", message: "Each line needs either a debit or a credit, not both." });
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
    entryDate: isoDate("Enter the entry date."),
    memo: requiredText("Describe the entry.", 500),
    kind: z.enum(["standard", "opening"]).default("standard"),
    lines: z.array(lineSchema).min(2, "An entry needs at least two lines.").max(500),
    post: z.boolean().default(false),
  })
  .refine(
    (e) =>
      e.lines.reduce((s, l) => s + l.debit_cents, 0) === e.lines.reduce((s, l) => s + l.credit_cents, 0),
    { message: "Debits and credits must be equal.", path: ["lines"] },
  );

/** Saves a draft (and posts it when asked). A failed post leaves the draft saved. */
export async function saveEntry(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
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
  if (error || !entryId) return { ok: false, error: dbMessage(error, "Could not save the entry. Try again.") };
  revalidatePath(LEDGER, "layout");
  if (d.post) {
    const { error: postError } = await supabase.rpc("ledger_post_entry", { p_entry: entryId });
    if (postError) {
      return {
        ok: false,
        id: entryId as string,
        error: `Saved as a draft but not posted: ${dbMessage(postError, "try posting again.")}`,
      };
    }
  }
  return { ok: true, id: entryId as string };
}

export async function postEntry(entryId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!z.string().uuid().safeParse(entryId).success) return { ok: false, error: "Entry not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_post_entry", { p_entry: entryId });
  if (error) return { ok: false, error: dbMessage(error, "Could not post the entry. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true, id: entryId };
}

export async function deleteDraft(entryId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!z.string().uuid().safeParse(entryId).success) return { ok: false, error: "Entry not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_delete_draft", { p_entry: entryId });
  if (error) return { ok: false, error: dbMessage(error, "Could not delete the draft. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

const reverseSchema = z.object({
  entryId: z.string().uuid(),
  entryDate: isoDate("Enter the date of the reversing entry."),
  memo: z.string().trim().max(500).optional(),
});

export async function reverseEntry(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ledger_reverse_entry", {
    p_entry: parsed.data.entryId,
    p_entry_date: parsed.data.entryDate,
    p_memo: parsed.data.memo || null,
  });
  if (error || !data) return { ok: false, error: dbMessage(error, "Could not reverse the entry. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true, id: data as string };
}

// ---------------------------------------------------------------------------
// Releasing restricted money (#149)
// ---------------------------------------------------------------------------

const releaseSchema = z.object({
  fromFundId: z.string({ message: "Choose the restricted fund." }).uuid("Choose the restricted fund."),
  toFundId: z.string({ message: "Choose the unrestricted fund." }).uuid("Choose the unrestricted fund."),
  amount: requiredText("Enter the amount to release."),
  releaseDate: isoDate("Enter the date of the release."),
  condition: requiredText("Name the condition that was met.", 300),
});

/**
 * Moves restricted money to an unrestricted fund once its condition is met.
 * The database posts the balanced entry and refuses an unrestricted source,
 * more than the fund's available balance, and a closed period.
 */
export async function releaseRestricted(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const cents = parseMoneyToCents(parsed.data.amount);
  if (cents === null || cents <= 0) return { ok: false, error: "Enter an amount above zero, like 1250.00." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ledger_release_restricted", {
    p_organization: auth.organizationId,
    p_from_fund: parsed.data.fromFundId,
    p_to_fund: parsed.data.toFundId,
    p_amount_cents: cents,
    p_release_date: parsed.data.releaseDate,
    p_condition: parsed.data.condition,
  });
  if (error || !data) return { ok: false, error: dbMessage(error, "Could not release the money. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true, id: data as string };
}

// ---------------------------------------------------------------------------
// Who may read the books
// ---------------------------------------------------------------------------

export async function grantLedgerReader(userId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: "Choose a staff member." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("ledger_reader")
    .insert({ organization_id: auth.organizationId, user_id: userId });
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "They can already read the ledger." : dbMessage(error, "Could not grant access. Try again."),
    };
  }
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

export async function revokeLedgerReader(userId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: "Reader not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("ledger_reader")
    .delete()
    .eq("organization_id", auth.organizationId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: dbMessage(error, "Could not remove access. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}
