import type { LedgerAccess } from "@/features/ledger/services/ledger.access";
import { formatCents } from "@/features/finance/money";
import type { Locale } from "@/lib/i18n/config";

type Client = LedgerAccess["supabase"];

export interface BankAccountRow {
  id: string;
  name: string;
  institution: string;
  account_last4: string | null;
  ledger_account_id: string;
  default_fund_id: string;
  reconcile_from: string;
  is_active: boolean;
  ledger_account: { code: string; name: string } | null;
}

export async function loadBankAccounts(supabase: Client, organizationId: string): Promise<BankAccountRow[]> {
  const { data } = await supabase
    .from("bank_account")
    .select(
      "id, name, institution, account_last4, ledger_account_id, default_fund_id, reconcile_from, is_active, ledger_account:ledger_account!bank_account_organization_id_ledger_account_id_fkey(code, name)",
    )
    .eq("organization_id", organizationId)
    .order("name");
  return (data ?? []) as unknown as BankAccountRow[];
}

/** Active asset accounts: what a bank account can be tied to. */
export async function loadCashAccountChoices(supabase: Client, organizationId: string) {
  const { data } = await supabase
    .from("ledger_account")
    .select("id, code, name")
    .eq("organization_id", organizationId)
    .eq("account_type", "asset")
    .eq("is_active", true)
    .order("code");
  return ((data ?? []) as { id: string; code: string; name: string }[]).map((a) => ({
    id: a.id,
    label: `${a.code} ${a.name}`,
  }));
}

export interface StatementLineRow {
  id: string;
  posted_on: string;
  amount_cents: number;
  description: string;
  reference: string | null;
  import_id: string;
  journal_line_id: string | null;
  match_method: "suggested" | "manual" | "created" | null;
  entry_id: string | null;
  entry_number: number | null;
  entry_date: string | null;
  entry_memo: string | null;
  locked: boolean;
}

export async function loadStatementLines(
  supabase: Client,
  bankAccountId: string,
  from: string,
  to: string,
): Promise<StatementLineRow[]> {
  const { data, error } = await supabase.rpc("bank_statement_lines", {
    p_bank_account: bankAccountId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return ((data ?? []) as StatementLineRow[]).map((r) => ({ ...r, amount_cents: Number(r.amount_cents) }));
}

export interface CandidateRow {
  bank_transaction_id: string;
  journal_line_id: string;
  entry_id: string;
  entry_number: number;
  entry_date: string;
  memo: string;
  day_gap: number;
}

/** Suggestions are candidates within this many days; manual choices, 60. */
export const SUGGESTION_WINDOW_DAYS = 7;

export async function loadCandidates(
  supabase: Client,
  bankAccountId: string,
  from: string,
  to: string,
): Promise<CandidateRow[]> {
  const { data, error } = await supabase.rpc("bank_match_candidates", {
    p_bank_account: bankAccountId,
    p_from: from,
    p_to: to,
    p_window_days: 60,
  });
  if (error) throw error;
  return (data ?? []) as CandidateRow[];
}

export function candidateLabel(c: CandidateRow): string {
  return `#${c.entry_number} ${c.entry_date} ${c.memo}`.slice(0, 80);
}

export interface ReconciliationRow {
  id: string;
  bank_account_id: string;
  statement_start: string;
  statement_end: string;
  opening_balance_cents: number;
  closing_balance_cents: number;
  status: "open" | "reconciled";
  reconciled_at: string | null;
}

export interface ReconciliationFigures {
  statement_lines_cents: number;
  statement_gap_cents: number;
  ledger_balance_cents: number;
  cleared_balance_cents: number;
  outstanding_cents: number;
  outstanding_count: number;
  unmatched_count: number;
  unmatched_cents: number;
  difference_cents: number;
}

export async function loadFigures(supabase: Client, reconciliationId: string): Promise<ReconciliationFigures> {
  const { data, error } = await supabase.rpc("bank_reconciliation_summary", { p_reconciliation: reconciliationId });
  if (error) throw error;
  const row = ((data ?? []) as Record<string, number | string>[])[0] ?? {};
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as unknown as ReconciliationFigures;
}

export interface OutstandingRow {
  journal_line_id: string;
  entry_id: string;
  entry_number: number;
  entry_date: string;
  memo: string;
  amount_cents: number;
}

export async function loadOutstanding(supabase: Client, reconciliationId: string): Promise<OutstandingRow[]> {
  const { data, error } = await supabase.rpc("bank_reconciliation_outstanding", { p_reconciliation: reconciliationId });
  if (error) throw error;
  return ((data ?? []) as OutstandingRow[]).map((r) => ({ ...r, amount_cents: Number(r.amount_cents) }));
}

/** Signed amount the way a statement shows it: deposits plain, withdrawals with a minus. */
export function formatSigned(cents: number, locale: Locale = "en"): string {
  return cents < 0 ? `−${formatCents(-cents, locale)}` : formatCents(cents, locale);
}

/** First and last day of the month holding `day` (YYYY-MM-DD). */
export function monthOf(day: string): { from: string; to: string } {
  const [y, m] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/** The day after `day`. */
export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface ReconciliationView {
  rec: ReconciliationRow;
  account: BankAccountRow;
  figures: ReconciliationFigures;
  lines: StatementLineRow[];
  outstanding: OutstandingRow[];
}

/** Everything the reconciliation screen and its report show. Null when not readable. */
export async function loadReconciliationView(
  supabase: Client,
  organizationId: string,
  reconciliationId: string,
): Promise<ReconciliationView | null> {
  const { data } = await supabase
    .from("bank_reconciliation")
    .select("id, bank_account_id, statement_start, statement_end, opening_balance_cents, closing_balance_cents, status, reconciled_at")
    .eq("organization_id", organizationId)
    .eq("id", reconciliationId)
    .maybeSingle();
  if (!data) return null;
  const rec = data as ReconciliationRow;
  rec.opening_balance_cents = Number(rec.opening_balance_cents);
  rec.closing_balance_cents = Number(rec.closing_balance_cents);
  const account = (await loadBankAccounts(supabase, organizationId)).find((a) => a.id === rec.bank_account_id);
  if (!account) return null;
  const [figures, lines, outstanding] = await Promise.all([
    loadFigures(supabase, rec.id),
    loadStatementLines(supabase, account.id, rec.statement_start, rec.statement_end),
    loadOutstanding(supabase, rec.id),
  ]);
  return { rec, account, figures, lines, outstanding };
}
