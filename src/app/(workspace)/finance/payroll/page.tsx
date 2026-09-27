import type { Metadata } from "next";
import Link from "next/link";
import { Banknote } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCents } from "@/features/finance/money";
import { getLedgerAccess } from "@/features/ledger/services/ledger.access";
import { employerContributions, PROVIDER_LABEL } from "@/features/payroll/categories";
import { AccountMapDialog, PayrollImportForm } from "@/features/payroll/components/payroll-forms";
import { NoPayrollAccess } from "@/features/payroll/components/no-payroll-access";
import {
  getAccountMap,
  listRuns,
  payrollOptions,
  RUN_STATUS_LABEL,
} from "@/features/payroll/services/payroll.queries";

export const metadata: Metadata = { title: "Payroll" };
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Pay runs imported from the payroll provider's journal export, each posted to the ledger as one balanced entry. Only run totals are kept: never employee names, social insurance numbers or per-employee lines.";

const STATUS_TONE = { draft: "warning", posted: "success", reversed: "neutral" } as const;

export default async function PayrollPage() {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow="Finance" title="Payroll" description={DESCRIPTION} />
        <NoPayrollAccess isAdmin={session.isAdmin} />
      </div>
    );
  }

  const [runs, map, options] = await Promise.all([
    listRuns(supabase, session.organizationId),
    canManage ? getAccountMap(supabase, session.organizationId) : Promise.resolve([]),
    canManage ? payrollOptions(supabase, session.organizationId) : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Payroll"
        description={DESCRIPTION}
        actions={canManage && options ? <AccountMapDialog map={map} options={options} /> : undefined}
      />
      {canManage ? (
        <section aria-labelledby="import" className="mb-8">
          <h2 id="import" className="mb-2 text-[15px] font-semibold">
            Import pay runs
          </h2>
          <div className="card p-4">
            <PayrollImportForm />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="runs">
        <h2 id="runs" className="mb-2 text-[15px] font-semibold">
          Pay runs
        </h2>
        {runs.length === 0 ? (
          <EmptyState
            icon={<Banknote />}
            title="No pay runs yet"
            description={
              canManage
                ? "Export the payroll journal or register from your provider and import it above."
                : "An administrator imports pay runs from the payroll provider."
            }
          />
        ) : (
          <DataTable minWidth="760px">
            <TableHead>
              <TableHeader className="w-32">Pay date</TableHeader>
              <TableHeader>Period</TableHeader>
              <TableHeader>Provider</TableHeader>
              <TableHeader className="text-right">Gross wages</TableHeader>
              <TableHeader className="text-right">Employer contributions</TableHeader>
              <TableHeader className="text-right">Net pay</TableHeader>
              <TableHeader className="w-28">Status</TableHeader>
            </TableHead>
            <tbody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link className="text-brand-fg hover:underline" href={`/finance/payroll/${r.id}`}>
                      {r.pay_date}
                    </Link>
                    {r.run_reference ? (
                      <span className="block text-[12.5px] text-muted">Run {r.run_reference}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {r.period_start} to {r.period_end}
                  </TableCell>
                  <TableCell className="text-[13px]">{PROVIDER_LABEL[r.provider].replace(/ \(.*\)$/, "")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(r.cents.gross_wages)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(employerContributions(r.cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(r.cents.net_pay)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
      <p className="mt-6 text-[12.5px] text-muted">
        Provider presets follow each provider&rsquo;s published export layout and are not yet checked against a real
        export. See the payroll import runbook.
      </p>
    </div>
  );
}
