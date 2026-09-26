import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACCOUNT_TYPE_LABEL, centsToDecimal, csvDocument, type AccountType } from "@/features/ledger/money";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface TrialBalanceRow {
  account_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  debit_cents: number;
  credit_cents: number;
  balance_cents: number;
}

export interface GeneralLedgerRow {
  account_id: string;
  account_code: string;
  account_name: string;
  opening_cents: number;
  line_id: string;
  entry_id: string;
  entry_number: number;
  entry_date: string;
  memo: string;
  line_description: string | null;
  fund_code: string;
  debit_cents: number;
  credit_cents: number;
  running_cents: number;
}

export const GL_ROW_LIMIT = 10000;

/** Posted balances as at a date. Row-level security decides what is summed. */
export async function trialBalance(supabase: Client, organizationId: string, asOf: string, fundId: string | null) {
  const { data, error } = await supabase.rpc("ledger_trial_balance", {
    p_organization: organizationId,
    p_as_of: asOf,
    p_fund: fundId,
  });
  const rows = ((data ?? []) as TrialBalanceRow[]).map((r) => ({
    ...r,
    debit_cents: Number(r.debit_cents),
    credit_cents: Number(r.credit_cents),
    balance_cents: Number(r.balance_cents),
  }));
  return { rows, error };
}

/** Posted lines between two dates with each account's running balance. */
export async function generalLedger(
  supabase: Client,
  organizationId: string,
  from: string,
  to: string,
  accountId: string | null,
  fundId: string | null,
) {
  const { data, error } = await supabase
    .rpc("ledger_general_ledger", {
      p_organization: organizationId,
      p_from: from,
      p_to: to,
      p_account: accountId,
      p_fund: fundId,
    })
    .limit(GL_ROW_LIMIT);
  const rows = ((data ?? []) as GeneralLedgerRow[]).map((r) => ({
    ...r,
    opening_cents: Number(r.opening_cents),
    debit_cents: Number(r.debit_cents),
    credit_cents: Number(r.credit_cents),
    running_cents: Number(r.running_cents),
  }));
  return { rows, error, truncated: rows.length === GL_ROW_LIMIT };
}

export function trialBalanceCsv(rows: TrialBalanceRow[], asOf: string, fundLabel: string): string {
  const debit = rows.reduce((s, r) => s + Math.max(r.balance_cents, 0), 0);
  const credit = rows.reduce((s, r) => s + Math.max(-r.balance_cents, 0), 0);
  return csvDocument([
    [`Trial balance as at ${asOf}`, fundLabel],
    ["Account", "Name", "Type", "Debit", "Credit"],
    ...rows.map((r) => [
      r.code,
      r.name,
      ACCOUNT_TYPE_LABEL[r.account_type],
      r.balance_cents > 0 ? centsToDecimal(r.balance_cents) : "",
      r.balance_cents < 0 ? centsToDecimal(-r.balance_cents) : "",
    ]),
    ["", "Total", "", centsToDecimal(debit), centsToDecimal(credit)],
  ]);
}

export function generalLedgerCsv(rows: GeneralLedgerRow[], from: string, to: string, fundLabel: string): string {
  return csvDocument([
    [`General ledger ${from} to ${to}`, fundLabel],
    ["Account", "Name", "Date", "Entry", "Memo", "Line description", "Fund", "Debit", "Credit", "Balance", "Opening balance"],
    ...rows.map((r) => [
      r.account_code,
      r.account_name,
      r.entry_date,
      r.entry_number,
      r.memo,
      r.line_description ?? "",
      r.fund_code,
      r.debit_cents ? centsToDecimal(r.debit_cents) : "",
      r.credit_cents ? centsToDecimal(r.credit_cents) : "",
      centsToDecimal(r.running_cents),
      centsToDecimal(r.opening_cents),
    ]),
  ]);
}

/** Groups general ledger rows by account, keeping the account order. */
export function groupByAccount(rows: GeneralLedgerRow[]) {
  const groups: { accountId: string; code: string; name: string; opening: number; rows: GeneralLedgerRow[] }[] = [];
  for (const r of rows) {
    let group = groups.at(-1);
    if (!group || group.accountId !== r.account_id) {
      group = { accountId: r.account_id, code: r.account_code, name: r.account_name, opening: r.opening_cents, rows: [] };
      groups.push(group);
    }
    group.rows.push(r);
  }
  return groups;
}
