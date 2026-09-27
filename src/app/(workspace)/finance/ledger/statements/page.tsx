import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileBarChart } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { FundChangesTable, OperationsTable, PositionTable } from "@/features/ledger/components/statement-tables";
import { PrintButton } from "@/features/ledger/components/year-end-forms";
import { NotFiledNotice, YearPicker } from "@/features/ledger/components/year-picker";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { loadFiscalYears, pickYear, yearFundChanges, yearStatements } from "@/features/ledger/services/year-end.queries";

export const metadata: Metadata = { title: "Financial statements" };
export const dynamic = "force-dynamic";

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead } = await getLedgerAccess();
  const params = await searchParams;
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="Financial statements"
      description="Statement of financial position, statement of operations and statement of changes in fund balances from posted entries, with the prior year when there is one."
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
          title="No fiscal year yet"
          description="Statements appear once a fiscal year's periods exist and entries are posted."
        />
      </div>
    );
  }
  const [{ current, prior, error }, fundChanges] = await Promise.all([
    yearStatements(supabase, session.organizationId, year),
    yearFundChanges(supabase, session.organizationId, year),
  ]);
  if (error ?? fundChanges.error) throw new Error(`Could not load the statements: ${error ?? fundChanges.error}`);
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
            Financial position CSV
          </Link>
          <Link
            href={csv("operations")}
            prefetch={false}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
          >
            <Download className="size-4" aria-hidden />
            Operations CSV
          </Link>
          <Link
            href={csv("fund-changes")}
            prefetch={false}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
          >
            <Download className="size-4" aria-hidden />
            Changes in fund balances CSV
          </Link>
          <PrintButton />
        </div>
      </div>
      {current.empty ? (
        <EmptyState
          icon={<FileBarChart />}
          title="Nothing posted in this fiscal year"
          description="The statements fill in as entries are posted."
        />
      ) : (
        <div className="space-y-6">
          <section aria-labelledby="position-heading">
            <h2 id="position-heading" className="mb-2 text-base font-semibold">
              Statement of financial position as at {current.to}
            </h2>
            <PositionTable current={current} prior={prior} />
          </section>
          <section aria-labelledby="operations-heading">
            <h2 id="operations-heading" className="mb-2 text-base font-semibold">
              Statement of operations, {current.from} to {current.to}
            </h2>
            <OperationsTable current={current} prior={prior} />
          </section>
          <section aria-labelledby="fund-changes-heading">
            <h2 id="fund-changes-heading" className="mb-2 text-base font-semibold">
              Statement of changes in fund balances, {current.from} to {current.to}
            </h2>
            <FundChangesTable changes={fundChanges.changes} />
            <p className="meta mt-2">
              Each fund&apos;s balance at the end is its balance on the Funds page for {current.to}. Transfers and
              releases move net assets between funds, so across all funds they add up to zero.
            </p>
          </section>
          <p className="meta">
            Presented by fund class (unrestricted, internally restricted, externally restricted) from the ledger&apos;s
            funds. Closing entries are left out of operations. Notes, cash flows and any reclassification to the
            accountant&apos;s presentation are prepared by the accountant.
            {prior ? "" : " No prior-year column: nothing was posted in the previous fiscal year."}
          </p>
        </div>
      )}
    </div>
  );
}
