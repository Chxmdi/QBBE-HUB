"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText, isCalendarMonth } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { parseMoneyToCents } from "@/features/ledger/money";
import { evenSplit, MONTHS_IN_YEAR } from "@/features/budgets/budget";
import { getT } from "@/lib/i18n/server";
import type { MessageKey, MessageVars, TranslateFn } from "@/lib/i18n/translate";

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

function dbMessage(t: TranslateFn, error: DbError, fallback: MessageKey): string {
  if (!error) return t(fallback);
  if (error.code === "23503") return t("finance.budgets.errors.notInOrganization");
  if (
    error.code &&
    READABLE_CODES.has(error.code) &&
    !/row-level security|permission denied|violates/i.test(error.message)
  ) {
    return error.message;
  }
  return t(fallback);
}

/**
 * The first validation problem, in the person's language. Schema messages are
 * catalogue keys (a custom issue may carry `params` for its placeholders);
 * anything else (a Zod default) is shown as it is.
 */
function issueMessage(t: TranslateFn, error: z.ZodError): string | undefined {
  const issue = error.issues[0];
  if (!issue) return undefined;
  const vars = issue.code === z.ZodIssueCode.custom ? (issue.params as MessageVars | undefined) : undefined;
  return t(issue.message as MessageKey, vars);
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
  startMonth: requiredText("finance.budgets.errors.startMonth" satisfies MessageKey).refine(
    isCalendarMonth,
    "finance.budgets.errors.startMonth" satisfies MessageKey,
  ),
  name: requiredText("finance.budgets.errors.name" satisfies MessageKey, 200),
  notes: z.string().trim().max(2000, "finance.budgets.errors.notesTooLong" satisfies MessageKey).optional(),
});

export async function createBudget(input: unknown): Promise<ActionResult & { id?: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(await getT(), parsed.error) };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("budget_create", {
    p_organization: auth.organizationId,
    p_fiscal_year_start: `${parsed.data.startMonth}-01`,
    p_name: parsed.data.name,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) return { ok: false, error: dbMessage(await getT(), error, "finance.budgets.errors.create") };
  revalidatePath(BUDGETS, "layout");
  return { ok: true, id: data as string };
}

const lineSchema = z
  .object({
    budgetId: uuid,
    lineId: optionalUuid,
    accountId: requiredText("finance.budgets.errors.chooseAccount" satisfies MessageKey).uuid(
      "finance.budgets.errors.chooseAccount" satisfies MessageKey,
    ),
    fundId: optionalUuid,
    programId: optionalUuid,
    projectId: optionalUuid,
    phasing: z.enum(["even", "custom"]),
    annual: z.string().optional(),
    months: z.array(z.string()).optional(),
    note: z.string().trim().max(500, "finance.budgets.errors.noteTooLong" satisfies MessageKey).optional(),
  })
  .transform((v, ctx) => {
    let months: number[] | null = null;
    if (v.phasing === "even") {
      const annual = parseMoneyToCents(v.annual ?? "");
      if (annual === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "finance.budgets.errors.annualAmount" satisfies MessageKey });
        return z.NEVER;
      }
      months = evenSplit(annual);
    } else {
      if (!v.months || v.months.length !== MONTHS_IN_YEAR) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "finance.budgets.errors.eachMonth" satisfies MessageKey });
        return z.NEVER;
      }
      const parsed = v.months.map((m) => (m.trim() === "" ? 0 : parseMoneyToCents(m)));
      const bad = parsed.findIndex((m) => m === null);
      if (bad >= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "finance.budgets.errors.monthAmount" satisfies MessageKey,
          params: { month: bad + 1 },
        });
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
  if (!parsed.success) return { ok: false, error: issueMessage(await getT(), parsed.error) };
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
  if (error) return { ok: false, error: dbMessage(await getT(), error, "finance.budgets.errors.saveLine") };
  revalidatePath(`${BUDGETS}/${v.budgetId}`);
  return { ok: true };
}

async function simple(
  fn: "budget_delete_line" | "budget_approve" | "budget_delete_draft",
  param: "p_line" | "p_budget",
  id: string,
  fallback: MessageKey,
): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!uuid.safeParse(id).success) return { ok: false, error: t(fallback) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(fn, { [param]: id });
  if (error) return { ok: false, error: dbMessage(t, error, fallback) };
  revalidatePath(BUDGETS, "layout");
  return { ok: true };
}

export async function deleteBudgetLine(lineId: string): Promise<ActionResult> {
  return simple("budget_delete_line", "p_line", lineId, "finance.budgets.errors.removeLine");
}

export async function approveBudget(budgetId: string): Promise<ActionResult> {
  return simple("budget_approve", "p_budget", budgetId, "finance.budgets.errors.approve");
}

export async function deleteBudgetDraft(budgetId: string): Promise<ActionResult> {
  return simple("budget_delete_draft", "p_budget", budgetId, "finance.budgets.errors.deleteDraft");
}

export async function reviseBudget(budgetId: string): Promise<ActionResult & { id?: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const t = await getT();
  if (!uuid.safeParse(budgetId).success) return { ok: false, error: t("finance.budgets.errors.revise") };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("budget_revise", { p_budget: budgetId });
  if (error) return { ok: false, error: dbMessage(t, error, "finance.budgets.errors.revise") };
  revalidatePath(BUDGETS, "layout");
  return { ok: true, id: data as string };
}
