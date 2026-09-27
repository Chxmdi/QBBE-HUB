import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileBarChart } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { OperationsTable, PositionTable } from "@/features/ledger/components/statement-tables";
import { PrintButton } from "@/features/ledger/components/year-end-forms";
import { NotFiledNotice, YearPicker } from "@/features/ledger/components/year-picker";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { loadFiscalYears, pickYear, yearStatements } from "@/features/ledger/services/year-end.queries";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledgerReports.statements.title") };
}
export const dynamic = "force-dynamic";

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead } = await getLedgerAccess();
  const params = await searchParams;
  const t = await getT();
  const header = (
    <PageHeader
      eyebrow={t("finance.ledgerReports.eyebrow")}
      title={t("finance.ledgerReports.statements.title")}
      description={t("finance.ledgerReports.statements.description")}
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

  const years = await loadFiscalYears(supabase, session.organizationId);
  const year = pickYear(years, params.year, todayIn(session.timeZone));
  if (!year) {
    return (
      <div>
        {header}
        <LedgerTabs />
        <EmptyState
          icon={<FileBarChart />}
          title={t("finance.ledgerReports.noFiscalYearTitle")}
          description={t("finance.ledgerReports.statements.emptyYearDescription")}
        />
      </div>
    );
  }
  const { current, prior, error } = await yearStatements(supabase, session.organizationId, year);
  if (error) throw new Error(`Could not load the statements: ${error}`);
  const csv = (statement: string) => `/api/finance/ledger/statements?year=${year.startsOn}&statement=${statement}`;

  return (
    <div>
      {header}
      <div className="print:hidden">
        <LedgerTabs />
      </div>
      <NotFiledNotice />
      <div className="card mb-4 flex flex-wrap items-end justify-between gap-3 p-4 print:hidden">
        <YearPicker years={years} selected={year.startsOn} />
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href={csv("position")}
            prefetch={false}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
          >
            <Download className="size-4" aria-hidden />
            {t("finance.ledgerReports.statements.positionCsv")}
          </Link>
          <Link
            href={csv("operations")}
            prefetch={false}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
          >
            <Download className="size-4" aria-hidden />
            {t("finance.ledgerReports.statements.operationsCsv")}
          </Link>
          <PrintButton />
        </div>
      </div>
      {current.empty ? (
        <EmptyState
          icon={<FileBarChart />}
          title={t("finance.ledgerReports.statements.nothingPostedTitle")}
          description={t("finance.ledgerReports.statements.nothingPostedDescription")}
        />
      ) : (
        <div className="space-y-6">
          <section aria-labelledby="position-heading">
            <h2 id="position-heading" className="mb-2 text-base font-semibold">
              {t("finance.ledgerReports.statements.positionHeading", { date: current.to })}
            </h2>
            <PositionTable current={current} prior={prior} />
          </section>
          <section aria-labelledby="operations-heading">
            <h2 id="operations-heading" className="mb-2 text-base font-semibold">
              {t("finance.ledgerReports.statements.operationsHeading", { from: current.from, to: current.to })}
            </h2>
            <OperationsTable current={current} prior={prior} />
          </section>
          <p className="meta">
            {t("finance.ledgerReports.statements.footnote")}
            {prior ? "" : t("finance.ledgerReports.statements.noPriorYear")}
          </p>
        </div>
      )}
    </div>
  );
}
