import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { PrintButton } from "@/features/ledger/components/year-end-forms";
import { NotFiledNotice, YearPicker } from "@/features/ledger/components/year-picker";
import { formatCents } from "@/features/ledger/money";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { loadFiscalYears, pickYear, yearStatements } from "@/features/ledger/services/year-end.queries";
import { returnFigures, sixMonthsAfter, T1044_THRESHOLDS } from "@/features/ledger/year-end";

export const metadata: Metadata = { title: "Annual returns" };
export const dynamic = "force-dynamic";

function Figure({ label, cents }: { label: string; cents: number | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{cents === null ? "No prior year in the books" : formatCents(cents)}</dd>
    </div>
  );
}

function ReturnCard({
  code,
  title,
  agency,
  due,
  children,
}: {
  code: string;
  title: string;
  agency: string;
  due: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-4 text-[13.5px]" aria-labelledby={`return-${code}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id={`return-${code}`} className="text-base font-semibold">
          {code} · {title}
        </h2>
        <Badge tone="warning">Needs accountant review</Badge>
      </div>
      <p className="meta mb-3">
        {agency}. Usually due within six months of the year end: {due}. The accountant confirms the deadline and files it.
      </p>
      {children}
    </section>
  );
}

/**
 * The annual returns this non-profit may have to file (#154), with the figures
 * the statements provide. Nothing is filed from here: every figure is prepared
 * for the accountant, who decides which returns apply and how the ledger maps
 * to each form.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead } = await getLedgerAccess();
  const params = await searchParams;
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="Annual returns"
      description="A checklist of the returns a Quebec non-profit files each year, with the figures from the books."
      actions={<PrintButton />}
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
        <EmptyState icon={<ClipboardCheck />} title="No fiscal year yet" description="Add a fiscal year on the Periods tab first." />
      </div>
    );
  }
  const { current, prior, error } = await yearStatements(supabase, session.organizationId, year);
  if (error) throw new Error(`Could not load the figures: ${error}`);
  const f = returnFigures(current, prior);
  const due = sixMonthsAfter(year.endsOn);
  const common = (
    <dl className="mb-3">
      <Figure label="Total revenue" cents={f.totalRevenue} />
      <Figure label="Total expenses" cents={f.totalExpenses} />
      <Figure label="Excess (deficiency) of revenue over expenses" cents={f.excess} />
      <Figure label={`Total assets at ${year.endsOn}`} cents={f.totalAssets} />
      <Figure label={`Total liabilities at ${year.endsOn}`} cents={f.totalLiabilities} />
      <Figure label={`Net assets at ${year.endsOn}`} cents={f.netAssets} />
    </dl>
  );
  const thresholds = (
    <>
      <dl className="mb-3">
        <Figure label="Dividends, interest, rentals and royalties this year" cents={f.investmentIncome} />
        <Figure label="Total assets at the end of the preceding fiscal year" cents={f.priorYearAssets} />
      </dl>
      <p className="mb-2">It is required when any one of these is true (the accountant decides):</p>
      <ul className="mb-3 list-disc space-y-1 pl-5">
        <li>
          Dividends, interest, rentals or royalties received or receivable in the year total more than{" "}
          {formatCents(T1044_THRESHOLDS.investmentIncomeCents)}.{" "}
          <strong>{f.t1044.investmentIncomeOver ? "The books show more." : "The books show less."}</strong>
        </li>
        <li>
          Total assets at the end of the preceding fiscal year were more than{" "}
          {formatCents(T1044_THRESHOLDS.priorYearAssetsCents)}.{" "}
          <strong>
            {f.t1044.priorAssetsOver === null
              ? "The preceding year is not in the books; use the accountant's figures."
              : f.t1044.priorAssetsOver
                ? "The books show more."
                : "The books show less."}
          </strong>
        </li>
        <li>The organization had to file this return for any earlier year. The books cannot tell; the accountant knows.</li>
      </ul>
      <p className="meta">
        Investment income counted from revenue accounts named like interest, dividends, rent or royalties:{" "}
        {f.investmentAccounts.length ? f.investmentAccounts.join(", ") : "none this year"}.
      </p>
    </>
  );

  return (
    <div>
      {header}
      <div className="print:hidden">
        <LedgerTabs />
      </div>
      <NotFiledNotice />
      <div className="card mb-4 p-4 print:hidden">
        <YearPicker years={years} selected={year.startsOn} />
      </div>
      <p className="mb-4 text-[13.5px]">
        Fiscal year {year.startsOn} to {year.endsOn}. Figures come from{" "}
        <Link className="text-brand-fg hover:underline" href={`/finance/ledger/statements?year=${year.startsOn}`}>
          the financial statements
        </Link>{" "}
        (posted entries only). QBBE is a non-profit organization, not a registered charity, so the T3010 charity
        return does not apply. How each figure maps to a line of a form is for the accountant to confirm.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReturnCard code="T2" title="Corporation Income Tax Return" agency="Canada Revenue Agency" due={due}>
          <p className="mb-2">
            An incorporated non-profit files a T2 every year even when its income is exempt under paragraph 149(1)(l)
            of the Income Tax Act. The financial statement figures go on the GIFI schedules (100 balance sheet, 125
            income statement).
          </p>
          {common}
        </ReturnCard>
        <ReturnCard code="T1044" title="Non-Profit Organization Information Return" agency="Canada Revenue Agency" due={due}>
          {thresholds}
        </ReturnCard>
        <ReturnCard code="CO-17" title="Corporation Income Tax Return" agency="Revenu Québec" due={due}>
          <p className="mb-2">
            A corporation with an establishment in Quebec files a Quebec return every year. Exempt non-profits may
            file a version for tax-exempt corporations; the accountant chooses the form.
          </p>
          {common}
        </ReturnCard>
        <ReturnCard code="TP-997.1" title="Information Return for Non-Profit Organizations" agency="Revenu Québec" due={due}>
          <p className="mb-2">
            Quebec&apos;s counterpart of the T1044. Its conditions are understood to follow the federal ones below;
            the accountant confirms.
          </p>
          {thresholds}
        </ReturnCard>
      </div>
      <section className="card mt-4 p-4 text-[13.5px]" aria-labelledby="checklist-heading">
        <h2 id="checklist-heading" className="mb-2 text-base font-semibold">
          Before the accountant prepares the returns
        </h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Every month of the year is reconciled and closed (Periods tab).</li>
          <li>The year is closed and the closing entry reviewed (Year-end tab).</li>
          <li>The accountant has the year-end package: statements, trial balance, general ledger and receipts.</li>
          <li>The accountant confirms which of the four returns apply and their deadlines.</li>
          <li>The accountant files them. Nothing is filed from QBBE Hub.</li>
        </ol>
      </section>
    </div>
  );
}
