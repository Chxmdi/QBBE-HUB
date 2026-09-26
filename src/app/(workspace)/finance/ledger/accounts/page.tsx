import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountDialog, type AccountFormValue } from "@/features/ledger/components/account-dialog";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, type AccountType } from "@/features/ledger/money";
import { getLedgerAccess } from "@/features/ledger/services/ledger.access";

export const metadata: Metadata = { title: "Chart of accounts" };
export const dynamic = "force-dynamic";

export default async function LedgerAccountsPage() {
  const { session, supabase, canRead, canManage, settings } = await getLedgerAccess();
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="Chart of accounts"
      description="A starting chart for a Quebec nonprofit reporting under the accounting standards for not-for-profit organizations. The accountant reviews it before anything is posted."
      actions={canRead && canManage ? <AccountDialog /> : undefined}
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

  const [{ data: accounts }, { data: used }] = await Promise.all([
    supabase
      .from("ledger_account")
      .select("id, code, name, account_type, description, is_active")
      .eq("organization_id", session.organizationId)
      .order("code"),
    supabase.rpc("ledger_trial_balance", {
      p_organization: session.organizationId,
      p_as_of: "9999-12-31",
    }).throwOnError(),
  ]);
  // Posted lines are what fix an account's code and type; drafts can be
  // re-saved, so they do not count here and the database has the last word.
  const usedIds = new Set(((used ?? []) as { account_id: string }[]).map((r) => r.account_id));
  const rows = ((accounts ?? []) as Omit<AccountFormValue, "used">[]).map((a) => ({
    ...a,
    used: usedIds.has(a.id),
  }));

  return (
    <div>
      {header}
      <LedgerTabs />
      <p className="meta mb-3">
        {settings?.chart_approved_on
          ? `Approved by ${settings.chart_approved_by_name} on ${settings.chart_approved_on}.`
          : "Not yet approved by the accountant."}{" "}
        {rows.length} accounts.
      </p>
      {ACCOUNT_TYPES.map((type: AccountType) => {
        const group = rows.filter((r) => r.account_type === type);
        if (group.length === 0) return null;
        return (
          <section key={type} aria-labelledby={`type-${type}`} className="mb-6">
            <h2 id={`type-${type}`} className="mb-2 text-[15px] font-semibold">
              {ACCOUNT_TYPE_LABEL[type]}
            </h2>
            <DataTable minWidth="520px">
              <TableHead>
                <TableHeader className="w-24">Code</TableHeader>
                <TableHeader>Name</TableHeader>
                <TableHeader className="w-28">Status</TableHeader>
                {canManage ? (
                  <TableHeader className="w-16">
                    <span className="sr-only">Edit</span>
                  </TableHeader>
                ) : null}
              </TableHead>
              <tbody>
                {group.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono tabular-nums">{a.code}</TableCell>
                    <TableCell>
                      {a.name}
                      {a.description ? <p className="meta">{a.description}</p> : null}
                    </TableCell>
                    <TableCell>
                      {a.is_active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <AccountDialog account={a} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </tbody>
            </DataTable>
          </section>
        );
      })}
    </div>
  );
}
