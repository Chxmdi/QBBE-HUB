import type { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildStatements,
  fiscalYearsFromPeriods,
  priorFiscalYear,
  type ExportLine,
  type FiscalYear,
  type StatementTotalRow,
  type Statements,
} from "@/features/ledger/year-end";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Rows per request: PostgREST returns at most this many (supabase/config.toml max_rows). */
const PAGE = 1000;
/** A year-end export larger than this is refused rather than cut short. */
export const EXPORT_LINE_LIMIT = 200_000;

export interface YearClose {
  id: string;
  starts_on: string;
  ends_on: string;
  closing_entry_id: string | null;
  closed_at: string;
  reopened_at: string | null;
  reopen_reason: string | null;
  reopening_entry_id: string | null;
  closer: { full_name: string } | null;
  reopener: { full_name: string } | null;
}

export interface YearStatus extends FiscalYear {
  periods: number;
  openPeriods: number;
  close: YearClose | null;
  history: YearClose[];
}

/** Fiscal years (newest first) with their periods and closes. Row-level security applies. */
export async function loadFiscalYears(supabase: Client, organizationId: string): Promise<YearStatus[]> {
  const [{ data: periods }, { data: closes }] = await Promise.all([
    supabase
      .from("ledger_period")
      .select("starts_on, ends_on, status")
      .eq("organization_id", organizationId)
      .order("starts_on"),
    supabase
      .from("ledger_year_close")
      .select(
        "id, starts_on, ends_on, closing_entry_id, closed_at, reopened_at, reopen_reason, reopening_entry_id, closer:closed_by(full_name), reopener:reopened_by(full_name)",
      )
      .eq("organization_id", organizationId)
      .order("closed_at", { ascending: false }),
  ]);
  const periodRows = (periods ?? []) as { starts_on: string; ends_on: string; status: "open" | "closed" }[];
  const closeRows = (closes ?? []) as unknown as YearClose[];
  return fiscalYearsFromPeriods(periodRows).map((year) => {
    const inYear = periodRows.filter((p) => p.starts_on >= year.startsOn && p.ends_on <= year.endsOn);
    const history = closeRows.filter((c) => c.starts_on === year.startsOn);
    return {
      ...year,
      periods: inYear.length,
      openPeriods: inYear.filter((p) => p.status === "open").length,
      close: history.find((c) => !c.reopened_at) ?? null,
      history,
    };
  });
}

/** The year a `?year=YYYY-MM-DD` parameter names, or the latest one that has started. */
export function pickYear<T extends FiscalYear>(years: T[], param: string | undefined, today: string): T | null {
  const named = years.find((y) => y.startsOn === param);
  if (named) return named;
  return years.find((y) => y.startsOn <= today) ?? years.at(-1) ?? null;
}

export async function statementsFor(
  supabase: Client,
  organizationId: string,
  from: string,
  to: string,
): Promise<{ statements: Statements; error: string | null }> {
  const { data, error } = await supabase.rpc("ledger_statement_totals", {
    p_organization: organizationId,
    p_from: from,
    p_to: to,
  });
  const rows = ((data ?? []) as StatementTotalRow[]).map((r) => ({
    ...r,
    opening_cents: Number(r.opening_cents),
    movement_cents: Number(r.movement_cents),
    closing_movement_cents: Number(r.closing_movement_cents),
    balance_cents: Number(r.balance_cents),
  }));
  return { statements: buildStatements(rows, from, to), error: error?.message ?? null };
}

/** A year's statements and, when the prior year has anything posted, the prior year's. */
export async function yearStatements(supabase: Client, organizationId: string, year: FiscalYear) {
  const prior = priorFiscalYear(year);
  const [current, previous] = await Promise.all([
    statementsFor(supabase, organizationId, year.startsOn, year.endsOn),
    statementsFor(supabase, organizationId, prior.startsOn, prior.endsOn),
  ]);
  return {
    current: current.statements,
    prior: previous.statements.empty ? null : previous.statements,
    priorYear: prior,
    error: current.error ?? previous.error,
  };
}

/** Every posted line between two dates, fetched a page at a time. */
export async function exportLines(
  supabase: Client,
  organizationId: string,
  from: string,
  to: string,
): Promise<{ lines: ExportLine[]; error: string | null; tooMany: boolean }> {
  const lines: ExportLine[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .rpc("ledger_export_lines", { p_organization: organizationId, p_from: from, p_to: to })
      .range(offset, offset + PAGE - 1);
    if (error) return { lines, error: error.message, tooMany: false };
    const page = (data ?? []) as ExportLine[];
    lines.push(
      ...page.map((l) => ({ ...l, debit_cents: Number(l.debit_cents), credit_cents: Number(l.credit_cents) })),
    );
    if (page.length < PAGE) break;
    if (lines.length >= EXPORT_LINE_LIMIT) return { lines, error: null, tooMany: true };
  }
  return { lines, error: null, tooMany: false };
}
