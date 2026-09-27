import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BankAccountDialog, INSTITUTION_LABEL } from "@/features/banking/components/bank-forms";
import { loadBankAccounts, loadCashAccountChoices } from "@/features/banking/services/bank.queries";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { getLedgerAccess } from "@/features/ledger/services/ledger.access";
import { loadEntryChoices } from "@/features/ledger/services/ledger.queries";

export const metadata: Metadata = { title: "Bank accounts" };
export const dynamic = "force-dynamic";

export default async function BankAccountsPage() {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const header = (
    <PageHeader
      eyebrow="Bookkeeping"
      title="Bank"
      description="Import bank statements, match each line to the ledger, and reconcile every account month by month."
    />
  );
  if (!canRead) {
    return (
      <div>
        {header}
        <NoLedgerAccess isAdmin={session.isAdmin} />
      </div>
    );
  }

  const [accounts, cashAccounts, choices, { data: open }] = await Promise.all([
    loadBankAccounts(supabase, session.organizationId),
    canManage ? loadCashAccountChoices(supabase, session.organizationId) : Promise.resolve([]),
    canManage ? loadEntryChoices(supabase, session.organizationId) : Promise.resolve(null),
    supabase
      .from("bank_reconciliation")
      .select("bank_account_id, statement_end, status")
      .eq("organization_id", session.organizationId)
      .order("statement_end", { ascending: false }),
  ]);
  const recs = (open ?? []) as { bank_account_id: string; statement_end: string; status: string }[];
  const lastReconciled = new Map<string, string>();
  for (const r of recs) {
    if (r.status === "reconciled" && !lastReconciled.has(r.bank_account_id)) {
      lastReconciled.set(r.bank_account_id, r.statement_end);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Bookkeeping"
        title="Bank"
        description="Import bank statements, match each line to the ledger, and reconcile every account month by month."
        actions={
          canManage && choices ? (
            <BankAccountDialog cashAccounts={cashAccounts} funds={choices.funds} defaultFundId={choices.defaultFundId} />
          ) : null
        }
      />
      {accounts.length === 0 ? (
        <EmptyState
          icon={<Landmark />}
          title="No bank accounts yet"
          description="Add each bank account and the ledger cash account it feeds, then import its statements."
        />
      ) : (
        <DataTable minWidth="640px">
          <TableHead>
            <TableHeader>Account</TableHeader>
            <TableHeader>Bank</TableHeader>
            <TableHeader>Ledger account</TableHeader>
            <TableHeader>Reconciled to</TableHeader>
          </TableHead>
          <tbody>
            {accounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">
                  <Link href={`/finance/bank/${a.id}`} className="underline-offset-2 hover:underline">
                    {a.name}
                    {a.account_last4 ? ` ···${a.account_last4}` : ""}
                  </Link>{" "}
                  {a.is_active ? null : <Badge>Inactive</Badge>}
                </TableCell>
                <TableCell>{INSTITUTION_LABEL[a.institution] ?? a.institution}</TableCell>
                <TableCell>
                  {a.ledger_account ? `${a.ledger_account.code} ${a.ledger_account.name}` : "—"}
                </TableCell>
                <TableCell className="tabular-nums">
                  {lastReconciled.get(a.id) ?? <span className="text-muted">Not yet</span>}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </DataTable>
      )}
      <p className="meta mt-3">
        Statements are uploaded as CSV, OFX or QFX files downloaded from online banking. No bank password or live
        connection is ever stored.
      </p>
    </div>
  );
}
