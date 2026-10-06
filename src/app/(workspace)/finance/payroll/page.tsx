import type { Metadata } from "next";
import Link from "next/link";
import { Banknote } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCents } from "@/features/finance/money";
import { getLedgerAccess } from "@/features/ledger/services/ledger.access";
import { employerContributions, providerShortLabel } from "@/features/payroll/categories";
import { AccountMapDialog, PayrollImportForm } from "@/features/payroll/components/payroll-forms";
import { NoPayrollAccess } from "@/features/payroll/components/no-payroll-access";
import {
  getAccountMap,
  listRuns,
  payrollOptions,
  RUN_STATUS_KEY,
} from "@/features/payroll/services/payroll.queries";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.payroll.title") };
}
export const dynamic = "force-dynamic";

const STATUS_TONE = { draft: "warning", posted: "success", reversed: "neutral" } as const;

export default async function PayrollPage() {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const title = t("finance.payroll.title");
  const eyebrow = t("finance.common.title");
  const description = t("finance.payroll.list.description");
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow={eyebrow} title={title} description={description} />
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
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={canManage && options ? <AccountMapDialog map={map} options={options} /> : undefined}
      />
      {canManage ? (
        <section aria-labelledby="import" className="mb-8">
          <h2 id="import" className="mb-2 text-[15px] font-semibold">
            {t("finance.payroll.list.importHeading")}
          </h2>
          <div className="card p-4">
            <PayrollImportForm />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="runs">
        <h2 id="runs" className="mb-2 text-[15px] font-semibold">
          {t("finance.payroll.list.runsHeading")}
        </h2>
        {runs.length === 0 ? (
          <EmptyState
            icon={<Banknote />}
            title={t("finance.payroll.list.emptyTitle")}
            description={
              canManage ? t("finance.payroll.list.emptyManager") : t("finance.payroll.list.emptyReader")
            }
          />
        ) : (
          <DataTable minWidth="760px">
            <TableHead>
              <TableHeader className="w-32">{t("finance.payroll.list.payDate")}</TableHeader>
              <TableHeader>{t("finance.payroll.list.period")}</TableHeader>
              <TableHeader>{t("finance.payroll.list.provider")}</TableHeader>
              <TableHeader className="text-right">{t("finance.payroll.list.grossWages")}</TableHeader>
              <TableHeader className="text-right">{t("finance.payroll.list.employerContributions")}</TableHeader>
              <TableHeader className="text-right">{t("finance.payroll.list.netPay")}</TableHeader>
              <TableHeader className="w-28">{t("finance.common.status")}</TableHeader>
            </TableHead>
            <tbody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link className="text-brand-fg hover:underline" href={`/finance/payroll/${r.id}`}>
                      {r.pay_date}
                    </Link>
                    {r.run_reference ? (
                      <span className="block text-[12.5px] text-muted">
                        {t("finance.payroll.list.runReference", { reference: r.run_reference })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {t("finance.payroll.list.periodRange", { start: r.period_start, end: r.period_end })}
                  </TableCell>
                  <TableCell className="text-[13px]">{providerShortLabel(r.provider, t)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(r.cents.gross_wages, locale)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(employerContributions(r.cents), locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(r.cents.net_pay, locale)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[r.status]}>{t(RUN_STATUS_KEY[r.status])}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
      <p className="mt-6 text-[12.5px] text-muted">{t("finance.payroll.list.presetsNote")}</p>
    </div>
  );
}
