import type { createSupabasePageClient } from "@/lib/supabase/page";
import type { MessageKey } from "@/lib/i18n/translate";
import { normalizeRows, type BudgetAccountType, type BudgetReportRow } from "@/features/budgets/budget";

type Client = Awaited<ReturnType<typeof createSupabasePageClient>>;

export type BudgetStatus = "draft" | "approved" | "superseded";

export interface BudgetSummary {
  id: string;
  fiscal_year_start: string;
  version: number;
  name: string;
  notes: string | null;
  status: BudgetStatus;
  approved_at: string | null;
  superseded_at: string | null;
  created_at: string;
}

export interface BudgetLine {
  id: string;
  account_id: string;
  fund_id: string | null;
  program_id: string | null;
  project_id: string | null;
  month_cents: number[];
  annual_cents: number;
  note: string | null;
}

export interface BudgetOptions {
  accounts: { id: string; code: string; name: string; account_type: BudgetAccountType; is_active: boolean }[];
  funds: { id: string; code: string; name: string }[];
  programs: { id: string; name: string }[];
  projects: { id: string; name: string; program_id: string | null }[];
}

/** Catalogue keys; translate with `t()` where shown. */
export const BUDGET_STATUS_LABEL: Record<BudgetStatus, MessageKey> = {
  draft: "finance.budgets.statuses.draft",
  approved: "finance.budgets.statuses.approved",
  superseded: "finance.budgets.statuses.superseded",
};

const BUDGET_COLUMNS = "id, fiscal_year_start, version, name, notes, status, approved_at, superseded_at, created_at";

/** Every version of every budget, newest fiscal year and version first. */
export async function listBudgets(supabase: Client, organizationId: string): Promise<BudgetSummary[]> {
  const { data, error } = await supabase
    .from("budget")
    .select(BUDGET_COLUMNS)
    .eq("organization_id", organizationId)
    .order("fiscal_year_start", { ascending: false })
    .order("version", { ascending: false });
  if (error) throw new Error(`Could not load budgets: ${error.message}`);
  return (data ?? []) as BudgetSummary[];
}

export async function getBudget(
  supabase: Client,
  organizationId: string,
  id: string,
): Promise<{ budget: BudgetSummary; lines: BudgetLine[]; versions: BudgetSummary[] } | null> {
  const { data: budget } = await supabase
    .from("budget")
    .select(BUDGET_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!budget) return null;
  const [{ data: lines, error }, { data: versions }] = await Promise.all([
    supabase
      .from("budget_line")
      .select("id, account_id, fund_id, program_id, project_id, month_cents, annual_cents, note")
      .eq("budget_id", id),
    supabase
      .from("budget")
      .select(BUDGET_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("fiscal_year_start", (budget as BudgetSummary).fiscal_year_start)
      .order("version", { ascending: false }),
  ]);
  if (error) throw new Error(`Could not load the budget lines: ${error.message}`);
  return {
    budget: budget as BudgetSummary,
    lines: ((lines ?? []) as BudgetLine[]).map((l) => ({
      ...l,
      annual_cents: Number(l.annual_cents),
      month_cents: l.month_cents.map(Number),
    })),
    versions: (versions ?? []) as BudgetSummary[],
  };
}

/** Accounts, funds, programs and projects a budget line can name. */
export async function budgetOptions(supabase: Client, organizationId: string): Promise<BudgetOptions> {
  const [accounts, funds, programs, projects] = await Promise.all([
    supabase
      .from("ledger_account")
      .select("id, code, name, account_type, is_active")
      .eq("organization_id", organizationId)
      .in("account_type", ["revenue", "expense"])
      .order("code"),
    supabase.from("ledger_fund").select("id, code, name").eq("organization_id", organizationId).order("code"),
    supabase.from("program").select("id, name").eq("organization_id", organizationId).order("name"),
    supabase.from("project").select("id, name, program_id").eq("organization_id", organizationId).order("name"),
  ]);
  return {
    accounts: (accounts.data ?? []) as BudgetOptions["accounts"],
    funds: (funds.data ?? []) as BudgetOptions["funds"],
    programs: (programs.data ?? []) as BudgetOptions["programs"],
    projects: (projects.data ?? []) as BudgetOptions["projects"],
  };
}

export interface ReportFilters {
  programId: string | null;
  projectId: string | null;
  fundId: string | null;
}

/** Budget against posted actuals for a month (YYYY-MM) and the year to date. */
export async function budgetVsActual(
  supabase: Client,
  budgetId: string,
  month: string,
  filters: ReportFilters,
): Promise<{ rows: BudgetReportRow[]; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("budget_vs_actual", {
    p_budget: budgetId,
    p_month: `${month}-01`,
    p_program: filters.programId,
    p_project: filters.projectId,
    p_fund: filters.fundId,
  });
  return { rows: normalizeRows(data), error };
}

/** Programs the caller leads or manages. */
export async function managedPrograms(supabase: Client, organizationId: string) {
  const { data, error } = await supabase.rpc("budget_managed_programs", { p_organization: organizationId });
  if (error) throw new Error(`Could not load your programs: ${error.message}`);
  return ((data ?? []) as { program_id: string; name: string }[]).map((p) => ({ id: p.program_id, name: p.name }));
}

export interface ProgramSummary {
  budget: { id: string; name: string; version: number; fiscal_year_start: string } | null;
  rows: BudgetReportRow[];
}

/** One program against the approved budget covering the month. Totals only. */
export async function programSummary(supabase: Client, programId: string, month: string): Promise<ProgramSummary> {
  const { data, error } = await supabase.rpc("budget_program_summary", {
    p_program: programId,
    p_month: `${month}-01`,
  });
  if (error) throw new Error(`Could not load the program budget: ${error.message}`);
  const raw = (data ?? []) as (BudgetReportRow & {
    budget_id: string;
    budget_name: string;
    budget_version: number;
    fiscal_year_start: string;
  })[];
  const first = raw[0];
  return {
    budget: first
      ? {
          id: first.budget_id,
          name: first.budget_name,
          version: first.budget_version,
          fiscal_year_start: first.fiscal_year_start,
        }
      : null,
    rows: normalizeRows(raw),
  };
}
