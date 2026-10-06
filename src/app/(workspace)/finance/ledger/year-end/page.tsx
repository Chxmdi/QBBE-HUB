import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { CloseYearButton, ReopenYearForm } from "@/features/ledger/components/year-end-forms";
import { NotFiledNotice, YearPicker } from "@/features/ledger/components/year-picker";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { loadFiscalYears, pickYear, type YearStatus } from "@/features/ledger/services/year-end.queries";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledgerReports.yearEnd.title") };
}
export const dynamic = "force-dynamic";

function monthsOf(year: YearStatus): { from: string; to: string; label: string }[] {
  const months = [];
  const [y, m] = year.startsOn.split("-").map(Number);
  for (let i = 0; i < 12; i++) {
    const index = y * 12 + (m - 1) + i;
    const yy = Math.floor(index / 12);
    const mm = (index % 12) + 1;
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const prefix = `${yy}-${String(mm).padStart(2, "0")}`;
    months.push({ from: `${prefix}-01`, to: `${prefix}-${String(last).padStart(2, "0")}`, label: prefix });
  }
  return months;
}

function DownloadLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} prefetch={false} className="inline-flex items-center gap-1 text-brand-fg hover:underline">
      <Download className="size-4 shrink-0" aria-hidden />
      {children}
    </Link>
  );
}

export default async function YearEndPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const params = await searchParams;
  const t = await getT();
  const header = (
    <PageHeader
      eyebrow={t("finance.ledgerReports.eyebrow")}
      title={t("finance.ledgerReports.yearEnd.title")}
      description={t("finance.ledgerReports.yearEnd.description")}
      actions={
        canManage ? (
          <Link href="/finance/ledger/accountant" className="text-[13.5px] font-medium text-brand-fg hover:underline">
            {t("finance.ledgerReports.yearEnd.accountantAccess")}
          </Link>
        ) : undefined
      }
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
          icon={<CalendarCheck />}
          title={t("finance.ledgerReports.noFiscalYearTitle")}
          description={t("finance.ledgerReports.addFiscalYearFirst")}
        />
      </div>
    );
  }
  const oldestOpen = [...years].reverse().find((y) => !y.close);
  const q = `from=${year.startsOn}&to=${year.endsOn}`;

  return (
    <div>
      {header}
      <LedgerTabs />

      <h2 className="mb-2 text-base font-semibold">{t("finance.ledgerReports.yearEnd.fiscalYears")}</h2>
      <DataTable minWidth="680px">
        <TableHead>
          <TableHeader>{t("finance.ledgerReports.yearEnd.fiscalYear")}</TableHeader>
          <TableHeader>{t("finance.ledgerReports.yearEnd.periods")}</TableHeader>
          <TableHeader>{t("finance.common.status")}</TableHeader>
          <TableHeader>{t("finance.ledgerReports.yearEnd.closingEntry")}</TableHeader>
          {canManage ? (
            <TableHeader className="text-right">
              <span className="sr-only">{t("finance.common.actions")}</span>
            </TableHeader>
          ) : null}
        </TableHead>
        <tbody>
          {years.map((y) => (
            <TableRow key={y.startsOn}>
              <TableCell className="font-medium tabular-nums">
                <Link className="text-brand-fg hover:underline" href={`/finance/ledger/year-end?year=${y.startsOn}`}>
                  {t("finance.ledgerReports.dateRange", { from: y.startsOn, to: y.endsOn })}
                </Link>
              </TableCell>
              <TableCell className="text-[13px]">
                {y.openPeriods
                  ? t("finance.ledgerReports.yearEnd.periodsOfOpen", { count: y.periods, open: y.openPeriods })
                  : t("finance.ledgerReports.yearEnd.periodsOf", { count: y.periods })}
              </TableCell>
              <TableCell>
                {y.close ? (
                  <span>
                    <Badge tone="success">{t("finance.ledgerReports.yearEnd.closed")}</Badge>
                    <span className="meta block">
                      {y.close.closed_at.slice(0, 10)}
                      {y.close.closer ? t("finance.ledgerReports.yearEnd.closedBy", { name: y.close.closer.full_name }) : ""}
                    </span>
                  </span>
                ) : (
                  <Badge>{t("finance.ledgerReports.yearEnd.open")}</Badge>
                )}
              </TableCell>
              <TableCell className="text-[13px]">
                {y.close?.closing_entry_id ? (
                  <Link className="text-brand-fg hover:underline" href={`/finance/ledger/journal/${y.close.closing_entry_id}`}>
                    {t("finance.ledgerReports.yearEnd.viewClosingEntry")}
                  </Link>
                ) : y.close ? (
                  t("finance.ledgerReports.yearEnd.noneNeeded")
                ) : (
                  "—"
                )}
              </TableCell>
              {canManage ? (
                <TableCell className="text-right">
                  {y.close ? (
                    <ReopenYearForm startsOn={y.startsOn} label={t("finance.ledgerReports.dateRange", { from: y.startsOn, to: y.endsOn })} />
                  ) : y.periods === 12 && oldestOpen?.startsOn === y.startsOn ? (
                    <CloseYearButton startsOn={y.startsOn} label={t("finance.ledgerReports.dateRange", { from: y.startsOn, to: y.endsOn })} />
                  ) : (
                    <span className="text-[13px] text-muted">
                      {t(y.periods < 12 ? "finance.ledgerReports.yearEnd.periodsMissing" : "finance.ledgerReports.yearEnd.closeEarlierFirst")}
                    </span>
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </tbody>
      </DataTable>
      <p className="meta mt-2">
        {t("finance.ledgerReports.yearEnd.closingNote")}
      </p>

      <h2 className="mt-8 mb-2 text-base font-semibold" id="package">
        {t("finance.ledgerReports.yearEnd.package")}
      </h2>
      <NotFiledNotice />
      <div className="card mb-4 p-4">
        <YearPicker years={years} selected={year.startsOn} />
      </div>
      <div className="card grid gap-6 p-4 text-[13.5px] md:grid-cols-2">
        <section aria-labelledby="pkg-statements">
          <h3 id="pkg-statements" className="mb-2 font-semibold">
            {t("finance.ledgerReports.yearEnd.statementsAndBalances")}
          </h3>
          <ul className="space-y-2">
            <li>
              <Link className="text-brand-fg hover:underline" href={`/finance/ledger/statements?year=${year.startsOn}`}>
                {t("finance.ledgerReports.yearEnd.statementsPrintable")}
              </Link>
            </li>
            <li>
              <DownloadLink href={`/api/finance/ledger/statements?year=${year.startsOn}&statement=position`}>
                {t("finance.ledgerReports.yearEnd.positionCsv")}
              </DownloadLink>
            </li>
            <li>
              <DownloadLink href={`/api/finance/ledger/statements?year=${year.startsOn}&statement=operations`}>
                {t("finance.ledgerReports.yearEnd.operationsCsv")}
              </DownloadLink>
            </li>
            <li>
              <DownloadLink href={`/api/finance/ledger/export/trial-balance?as_of=${year.endsOn}`}>
                {t("finance.ledgerReports.yearEnd.trialBalanceImport", { date: year.endsOn })}
              </DownloadLink>
            </li>
            <li>
              <DownloadLink href={`/api/finance/ledger/export/journal?${q}`}>
                {t("finance.ledgerReports.yearEnd.generalLedgerImport")}
              </DownloadLink>
            </li>
            <li>
              <DownloadLink href={`/api/finance/ledger/export/receipts?${q}`}>{t("finance.ledgerReports.yearEnd.receiptsCsv")}</DownloadLink>
            </li>
            <li>
              <Link className="text-brand-fg hover:underline" href={`/finance/ledger/returns?year=${year.startsOn}`}>
                {t("finance.ledgerReports.yearEnd.returnsChecklist")}
              </Link>
            </li>
          </ul>
        </section>
        <section aria-labelledby="pkg-periods">
          <h3 id="pkg-periods" className="mb-2 font-semibold">
            {t("finance.ledgerReports.yearEnd.byPeriod")}
          </h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {monthsOf(year).map((m) => (
              <li key={m.label}>
                <DownloadLink href={`/api/finance/ledger/export/journal?from=${m.from}&to=${m.to}`}>{m.label}</DownloadLink>
              </li>
            ))}
          </ul>
          <p className="meta mt-3">
            {t("finance.ledgerReports.yearEnd.columnsNote")}
          </p>
        </section>
      </div>

      {year.history.some((c) => c.reopened_at) ? (
        <>
          <h2 className="mt-8 mb-2 text-base font-semibold">{t("finance.ledgerReports.yearEnd.reopenings")}</h2>
          <ul className="card divide-y divide-line text-[13.5px]">
            {year.history
              .filter((c) => c.reopened_at)
              .map((c) => (
                <li key={c.id} className="px-4 py-2">
                  {c.reopener
                    ? t("finance.ledgerReports.yearEnd.reopenedBy", {
                        date: c.reopened_at?.slice(0, 10) ?? "",
                        name: c.reopener.full_name,
                        reason: c.reopen_reason ?? "",
                      })
                    : t("finance.ledgerReports.yearEnd.reopened", { date: c.reopened_at?.slice(0, 10) ?? "", reason: c.reopen_reason ?? "" })}
                  {c.reopening_entry_id ? (
                    <>
                      {" "}
                      <Link className="text-brand-fg hover:underline" href={`/finance/ledger/journal/${c.reopening_entry_id}`}>
                        {t("finance.ledgerReports.yearEnd.reopeningEntry")}
                      </Link>
                    </>
                  ) : null}
                </li>
              ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
