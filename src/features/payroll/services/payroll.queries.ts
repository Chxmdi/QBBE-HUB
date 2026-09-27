import type { createSupabasePageClient } from "@/lib/supabase/page";
import {
  CATEGORY_KEYS,
  type AccountType,
  type PayrollCategory,
  type PayrollProvider,
  type RunCents,
} from "@/features/payroll/categories";

type Client = Awaited<ReturnType<typeof createSupabasePageClient>>;

export type RunStatus = "draft" | "posted" | "reversed";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  reversed: "Reversed",
};

export interface PayrollRun {
  id: string;
  provider: PayrollProvider;
  file_name: string | null;
  run_reference: string | null;
  pay_date: string;
  period_start: string;
  period_end: string;
  cents: RunCents;
  status: RunStatus;
  journal_entry_id: string | null;
  reversal_entry_id: string | null;
  posted_at: string | null;
  reversed_at: string | null;
  created_at: string;
}

export interface Allocation {
  share_no: number;
  fund_id: string;
  program_id: string | null;
  share_basis_points: number | null;
  share_cents: number | null;
}

export interface AccountMapRow {
  category: PayrollCategory;
  debit_account_id: string | null;
  credit_account_id: string | null;
}

export interface PayrollOptions {
  accounts: { id: string; code: string; name: string; account_type: AccountType; is_active: boolean }[];
  funds: { id: string; code: string; name: string; restriction: string; is_active: boolean }[];
  programs: { id: string; name: string }[];
}

export interface PreviewLine {
  line_no: number;
  category: PayrollCategory;
  account_id: string;
  fund_id: string;
  program_id: string | null;
  description: string;
  debit_cents: number;
  credit_cents: number;
}

const RUN_COLUMNS = [
  "id, provider, file_name, run_reference, pay_date, period_start, period_end, status",
  "journal_entry_id, reversal_entry_id, posted_at, reversed_at, created_at",
  ...CATEGORY_KEYS.map((k) => `${k}_cents`),
].join(", ");

type RunRow = Omit<PayrollRun, "cents"> & Record<`${PayrollCategory}_cents`, number | string>;

function toRun(row: RunRow): PayrollRun {
  const cents = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, Number(row[`${k}_cents`])])) as RunCents;
  const run = { ...row, cents } as PayrollRun & Partial<RunRow>;
  for (const k of CATEGORY_KEYS) delete run[`${k}_cents`];
  return run;
}

/** Every run, latest pay date first. */
export async function listRuns(supabase: Client, organizationId: string): Promise<PayrollRun[]> {
  const { data, error } = await supabase
    .from("payroll_run")
    .select(RUN_COLUMNS)
    .eq("organization_id", organizationId)
    .order("pay_date", { ascending: false })
    .order("period_start", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Could not load pay runs: ${error.message}`);
  return ((data ?? []) as unknown as RunRow[]).map(toRun);
}

export async function getRun(
  supabase: Client,
  organizationId: string,
  id: string,
): Promise<{ run: PayrollRun; allocation: Allocation[]; entryNumbers: Record<string, number> } | null> {
  const { data } = await supabase
    .from("payroll_run")
    .select(RUN_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const run = toRun(data as unknown as RunRow);
  const entryIds = [run.journal_entry_id, run.reversal_entry_id].filter((x): x is string => Boolean(x));
  const [{ data: allocation }, { data: entries }] = await Promise.all([
    supabase
      .from("payroll_run_allocation")
      .select("share_no, fund_id, program_id, share_basis_points, share_cents")
      .eq("run_id", id)
      .order("share_no"),
    entryIds.length
      ? supabase.from("journal_entry").select("id, entry_number").in("id", entryIds)
      : Promise.resolve({ data: [] as { id: string; entry_number: number }[] }),
  ]);
  return {
    run,
    allocation: ((allocation ?? []) as Allocation[]).map((a) => ({
      ...a,
      share_cents: a.share_cents === null ? null : Number(a.share_cents),
    })),
    entryNumbers: Object.fromEntries(
      ((entries ?? []) as { id: string; entry_number: number }[]).map((e) => [e.id, e.entry_number]),
    ),
  };
}

export async function getAccountMap(supabase: Client, organizationId: string): Promise<AccountMapRow[]> {
  const { data } = await supabase
    .from("payroll_account_map")
    .select("category, debit_account_id, credit_account_id")
    .eq("organization_id", organizationId);
  const rows = (data ?? []) as AccountMapRow[];
  return CATEGORY_KEYS.map(
    (k) => rows.find((r) => r.category === k) ?? { category: k, debit_account_id: null, credit_account_id: null },
  );
}

export async function payrollOptions(supabase: Client, organizationId: string): Promise<PayrollOptions> {
  const [accounts, funds, programs] = await Promise.all([
    supabase
      .from("ledger_account")
      .select("id, code, name, account_type, is_active")
      .eq("organization_id", organizationId)
      .order("code"),
    supabase
      .from("ledger_fund")
      .select("id, code, name, restriction, is_active")
      .eq("organization_id", organizationId)
      .order("code"),
    supabase.from("program").select("id, name").eq("organization_id", organizationId).order("name"),
  ]);
  return {
    accounts: (accounts.data ?? []) as PayrollOptions["accounts"],
    funds: (funds.data ?? []) as PayrollOptions["funds"],
    programs: (programs.data ?? []) as PayrollOptions["programs"],
  };
}

/** The lines posting would create, or the reason it cannot yet. */
export async function previewLines(
  supabase: Client,
  runId: string,
): Promise<{ lines: PreviewLine[]; error: string | null }> {
  const { data, error } = await supabase.rpc("payroll_run_lines", { p_run: runId });
  if (error) {
    const readable = error.code === "22023" || error.code === "P0002";
    return { lines: [], error: readable ? error.message : "The entry could not be prepared." };
  }
  return {
    lines: ((data ?? []) as PreviewLine[]).map((l) => ({
      ...l,
      debit_cents: Number(l.debit_cents),
      credit_cents: Number(l.credit_cents),
    })),
    error: null,
  };
}
