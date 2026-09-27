"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { parseMoneyToCents } from "@/features/ledger/money";
import { evenSplit, MONTHS_IN_YEAR } from "@/features/budgets/budget";

/**
 * Budget actions (#153). Every write is for owners and admins who completed
 * MFA; the database checks the same thing again, locks approved versions for
 * every role and writes the audit record for each step.
 */

const BUDGETS = "/finance/budgets";

type DbError = { code?: string; message: string } | null;

// The budget functions raise with sentences written for people; anything
// else (row-level security, a network failure) gets a generic message.
const READABLE_CODES = new Set(["22023", "42501", "23505", "P0002"]);

function dbMessage(error: DbError, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "23503") return "An account, fund, program or project is not in this organization.";
  if (
    error.code &&
    READABLE_CODES.has(error.code) &&
    !/row-level security|permission denied|violates/i.test(error.message)
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
  const limited = await enforceRateLimit("ledger:write", auth.session.userId);
  if (limited) return { ok: false, result: limited };
  return { ok: true, organizationId: auth.session.organizationId };
}

const uuid = z.string().uuid();
const optionalUuid = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => v || null)
  .pipe(uuid.nullable());

const createSchema = z.object({
  startMonth: requiredText("Choose the first month of the fiscal year.").regex(
    /^\d{4}-\d{2}$/,
    "Choose the first month of the fiscal year.",
  ),
  name: requiredText("Name the budget.", 200),
  notes: z.string().trim().max(2000, "Keep notes under 2,000 characters.").optional(),
});

export async function createBudget(input: unknown): Promise<ActionResult & { id?: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("budget_create", {
    p_organization: auth.organizationId,
    p_fiscal_year_start: `${parsed.data.startMonth}-01`,
    p_name: parsed.data.name,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not create the budget. Try again.") };
  revalidatePath(BUDGETS, "layout");
  return { ok: true, id: data as string };
}

const lineSchema = z
  .object({
    budgetId: uuid,
    lineId: optionalUuid,
    accountId: requiredText("Choose an account.").uuid("Choose an account."),
    fundId: optionalUuid,
    programId: optionalUuid,
    projectId: optionalUuid,
    phasing: z.enum(["even", "custom"]),
    annual: z.string().optional(),
    months: z.array(z.string()).optional(),
    note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
  })
  .transform((v, ctx) => {
    let months: number[] | null = null;
    if (v.phasing === "even") {
      const annual = parseMoneyToCents(v.annual ?? "");
      if (annual === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the annual amount, like 12000.00." });
        return z.NEVER;
      }
      months = evenSplit(annual);
    } else {
      if (!v.months || v.months.length !== MONTHS_IN_YEAR) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter an amount for each month." });
        return z.NEVER;
      }
      const parsed = v.months.map((m) => (m.trim() === "" ? 0 : parseMoneyToCents(m)));
      const bad = parsed.findIndex((m) => m === null);
      if (bad >= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Month ${bad + 1}: enter an amount like 1000.00.` });
        return z.NEVER;
      }
      months = parsed as number[];
    }
    return { ...v, monthCents: months };
  });

export async function saveBudgetLine(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = lineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("budget_save_line", {
    p_budget: v.budgetId,
    p_line: v.lineId,
    p_account: v.accountId,
    p_fund: v.fundId,
    p_program: v.programId,
    p_project: v.projectId,
    p_month_cents: v.monthCents,
    p_note: v.note || null,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not save the line. Try again.") };
  revalidatePath(`${BUDGETS}/${v.budgetId}`);
  return { ok: true };
}

async function simple(
  fn: "budget_delete_line" | "budget_approve" | "budget_delete_draft",
  param: "p_line" | "p_budget",
  id: string,
  fallback: string,
): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!uuid.safeParse(id).success) return { ok: false, error: fallback };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(fn, { [param]: id });
  if (error) return { ok: false, error: dbMessage(error, fallback) };
  revalidatePath(BUDGETS, "layout");
  return { ok: true };
}

export async function deleteBudgetLine(lineId: string): Promise<ActionResult> {
  return simple("budget_delete_line", "p_line", lineId, "Could not remove the line. Try again.");
}

export async function approveBudget(budgetId: string): Promise<ActionResult> {
  return simple("budget_approve", "p_budget", budgetId, "Could not approve the budget. Try again.");
}

export async function deleteBudgetDraft(budgetId: string): Promise<ActionResult> {
  return simple("budget_delete_draft", "p_budget", budgetId, "Could not delete the draft. Try again.");
}

export async function reviseBudget(budgetId: string): Promise<ActionResult & { id?: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!uuid.safeParse(budgetId).success) return { ok: false, error: "Could not start a revision. Try again." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("budget_revise", { p_budget: budgetId });
  if (error) return { ok: false, error: dbMessage(error, "Could not start a revision. Try again.") };
  revalidatePath(BUDGETS, "layout");
  return { ok: true, id: data as string };
}
