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
import type { Locale } from "@/lib/i18n/config";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledgerReports.returns.title") };
}
export const dynamic = "force-dynamic";

async function Figure({ label, cents }: { label: string; cents: number | null }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{cents === null ? t("finance.ledgerReports.returns.noPriorYear") : formatCents(cents, locale)}</dd>
    </div>
  );
}

async function ReturnCard({
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
  const t = await getT();
  return (
    <section className="card p-4 text-[13.5px]" aria-labelledby={`return-${code}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id={`return-${code}`} className="text-base font-semibold">
          {code} · {title}
        </h2>
        <Badge tone="warning">{t("finance.ledgerReports.returns.needsReview")}</Badge>
      </div>
      <p className="meta mb-3">
        {t("finance.ledgerReports.returns.dueNote", { agency, due })}
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
  const t = await getT();
  const locale: Locale = await getLocale();
  const header = (
    <PageHeader
      eyebrow={t("finance.ledgerReports.eyebrow")}
      title={t("finance.ledgerReports.returns.title")}
      description={t("finance.ledgerReports.returns.description")}
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
        <EmptyState
          icon={<ClipboardCheck />}
          title={t("finance.ledgerReports.noFiscalYearTitle")}
          description={t("finance.ledgerReports.addFiscalYearFirst")}
        />
      </div>
    );
  }
  const { current, prior, error } = await yearStatements(supabase, session.organizationId, year);
  if (error) throw new Error(`Could not load the figures: ${error}`);
  const f = returnFigures(current, prior);
  const due = sixMonthsAfter(year.endsOn);
  const common = (
    <dl className="mb-3">
      <Figure label={t("finance.ledgerReports.returns.totalRevenue")} cents={f.totalRevenue} />
      <Figure label={t("finance.ledgerReports.returns.totalExpenses")} cents={f.totalExpenses} />
      <Figure label={t("finance.ledgerReports.returns.excess")} cents={f.excess} />
      <Figure label={t("finance.ledgerReports.returns.totalAssetsAt", { date: year.endsOn })} cents={f.totalAssets} />
      <Figure label={t("finance.ledgerReports.returns.totalLiabilitiesAt", { date: year.endsOn })} cents={f.totalLiabilities} />
      <Figure label={t("finance.ledgerReports.returns.netAssetsAt", { date: year.endsOn })} cents={f.netAssets} />
    </dl>
  );
  const thresholds = (
    <>
      <dl className="mb-3">
        <Figure label={t("finance.ledgerReports.returns.investmentIncome")} cents={f.investmentIncome} />
        <Figure label={t("finance.ledgerReports.returns.priorYearAssets")} cents={f.priorYearAssets} />
      </dl>
      <p className="mb-2">{t("finance.ledgerReports.returns.requiredWhen")}</p>
      <ul className="mb-3 list-disc space-y-1 pl-5">
        <li>
          {t("finance.ledgerReports.returns.investmentThreshold", { amount: formatCents(T1044_THRESHOLDS.investmentIncomeCents, locale) })}{" "}
          <strong>{t(f.t1044.investmentIncomeOver ? "finance.ledgerReports.returns.booksShowMore" : "finance.ledgerReports.returns.booksShowLess")}</strong>
        </li>
        <li>
          {t("finance.ledgerReports.returns.assetsThreshold", { amount: formatCents(T1044_THRESHOLDS.priorYearAssetsCents, locale) })}{" "}
          <strong>
            {t(
              f.t1044.priorAssetsOver === null
                ? "finance.ledgerReports.returns.precedingNotInBooks"
                : f.t1044.priorAssetsOver
                  ? "finance.ledgerReports.returns.booksShowMore"
                  : "finance.ledgerReports.returns.booksShowLess",
            )}
          </strong>
        </li>
        <li>{t("finance.ledgerReports.returns.filedEarlier")}</li>
      </ul>
      <p className="meta">
        {t("finance.ledgerReports.returns.investmentAccounts")}{" "}
        {f.investmentAccounts.length ? f.investmentAccounts.join(", ") : t("finance.ledgerReports.returns.noneThisYear")}.
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
        {t("finance.ledgerReports.returns.introBefore", { from: year.startsOn, to: year.endsOn })}{" "}
        <Link className="text-brand-fg hover:underline" href={`/finance/ledger/statements?year=${year.startsOn}`}>
          {t("finance.ledgerReports.returns.introLink")}
        </Link>{" "}
        {t("finance.ledgerReports.returns.introAfter")}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReturnCard code="T2" title={t("finance.ledgerReports.returns.t2Title")} agency={t("finance.ledgerReports.returns.cra")} due={due}>
          <p className="mb-2">{t("finance.ledgerReports.returns.t2Body")}</p>
          {common}
        </ReturnCard>
        <ReturnCard code="T1044" title={t("finance.ledgerReports.returns.t1044Title")} agency={t("finance.ledgerReports.returns.cra")} due={due}>
          {thresholds}
        </ReturnCard>
        <ReturnCard code="CO-17" title={t("finance.ledgerReports.returns.co17Title")} agency={t("finance.ledgerReports.returns.revenuQuebec")} due={due}>
          <p className="mb-2">{t("finance.ledgerReports.returns.co17Body")}</p>
          {common}
        </ReturnCard>
        <ReturnCard
          code="TP-997.1"
          title={t("finance.ledgerReports.returns.tp9971Title")}
          agency={t("finance.ledgerReports.returns.revenuQuebec")}
          due={due}
        >
          <p className="mb-2">{t("finance.ledgerReports.returns.tp9971Body")}</p>
          {thresholds}
        </ReturnCard>
      </div>
      <section className="card mt-4 p-4 text-[13.5px]" aria-labelledby="checklist-heading">
        <h2 id="checklist-heading" className="mb-2 text-base font-semibold">
          {t("finance.ledgerReports.returns.checklistHeading")}
        </h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>{t("finance.ledgerReports.returns.checklist1")}</li>
          <li>{t("finance.ledgerReports.returns.checklist2")}</li>
          <li>{t("finance.ledgerReports.returns.checklist3")}</li>
          <li>{t("finance.ledgerReports.returns.checklist4")}</li>
          <li>{t("finance.ledgerReports.returns.checklist5")}</li>
        </ol>
      </section>
    </div>
  );
}
