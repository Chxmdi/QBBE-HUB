import { loadReconciliationView } from "@/features/banking/services/bank.queries";
import { reconciliationCsv } from "@/features/banking/report";
import { uuidParam } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";

/** Reconciliation report as CSV for the accountant (#151). Ledger readers only. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await authorizeLedgerExport();
  if (!access) return new Response("You do not have access to the ledger.", { status: 403 });
  const { session, supabase } = access;
  const id = uuidParam((await params).id);
  if (!id) return new Response("Reconciliation not found.", { status: 404 });
  let view;
  try {
    view = await loadReconciliationView(supabase, session.organizationId, id);
  } catch {
    return new Response("Could not export the reconciliation. Try again.", { status: 500 });
  }
  if (!view) return new Response("Reconciliation not found.", { status: 404 });
  const { data: org } = await supabase.from("organization").select("name").eq("id", session.organizationId).maybeSingle();
  const { rec, account, figures, lines, outstanding } = view;
  const body = reconciliationCsv({
    organizationName: (org as { name: string } | null)?.name ?? "",
    accountLabel: `${account.name}${account.account_last4 ? ` ending ${account.account_last4}` : ""}`,
    ledgerAccountLabel: account.ledger_account ? `${account.ledger_account.code} ${account.ledger_account.name}` : "",
    statementStart: rec.statement_start,
    statementEnd: rec.statement_end,
    status: rec.status,
    reconciledAt: rec.reconciled_at,
    openingCents: rec.opening_balance_cents,
    closingCents: rec.closing_balance_cents,
    figures,
    lines,
    outstanding,
  });
  return csvResponse(
    supabase,
    session,
    "bank_reconciliation_exported",
    body,
    `bank-reconciliation-${rec.statement_end}.csv`,
    { reconciliation_id: rec.id, statement_end: rec.statement_end },
  );
}
