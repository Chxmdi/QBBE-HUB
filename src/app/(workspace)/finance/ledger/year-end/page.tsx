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

export const metadata: Metadata = { title: "Year-end" };
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
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="Year-end"
      description="Close a fiscal year, and hand the accountant everything they need for the financial statements and returns."
      actions={
        canManage ? (
          <Link href="/finance/ledger/accountant" className="text-[13.5px] font-medium text-brand-fg hover:underline">
            Accountant access
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
          title="No fiscal year yet"
          description="Add a fiscal year on the Periods tab first."
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

      <h2 className="mb-2 text-base font-semibold">Fiscal years</h2>
      <DataTable minWidth="680px">
        <TableHead>
          <TableHeader>Fiscal year</TableHeader>
          <TableHeader>Periods</TableHeader>
          <TableHeader>Status</TableHeader>
          <TableHeader>Closing entry</TableHeader>
          {canManage ? (
            <TableHeader className="text-right">
              <span className="sr-only">Actions</span>
            </TableHeader>
          ) : null}
        </TableHead>
        <tbody>
          {years.map((y) => (
            <TableRow key={y.startsOn}>
              <TableCell className="font-medium tabular-nums">
                <Link className="text-brand-fg hover:underline" href={`/finance/ledger/year-end?year=${y.startsOn}`}>
                  {y.startsOn} to {y.endsOn}
                </Link>
              </TableCell>
              <TableCell className="text-[13px]">
                {y.periods} of 12{y.openPeriods ? `, ${y.openPeriods} open` : ""}
              </TableCell>
              <TableCell>
                {y.close ? (
                  <span>
                    <Badge tone="success">Closed</Badge>
                    <span className="meta block">
                      {y.close.closed_at.slice(0, 10)}
                      {y.close.closer ? ` by ${y.close.closer.full_name}` : ""}
                    </span>
                  </span>
                ) : (
                  <Badge>Open</Badge>
                )}
              </TableCell>
              <TableCell className="text-[13px]">
                {y.close?.closing_entry_id ? (
                  <Link className="text-brand-fg hover:underline" href={`/finance/ledger/journal/${y.close.closing_entry_id}`}>
                    View closing entry
                  </Link>
                ) : y.close ? (
                  "None needed (no revenue or expenses)"
                ) : (
                  "—"
                )}
              </TableCell>
              {canManage ? (
                <TableCell className="text-right">
                  {y.close ? (
                    <ReopenYearForm startsOn={y.startsOn} label={`${y.startsOn} to ${y.endsOn}`} />
                  ) : y.periods === 12 && oldestOpen?.startsOn === y.startsOn ? (
                    <CloseYearButton startsOn={y.startsOn} label={`${y.startsOn} to ${y.endsOn}`} />
                  ) : (
                    <span className="text-[13px] text-muted">
                      {y.periods < 12 ? "Periods missing" : "Close earlier years first"}
                    </span>
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </tbody>
      </DataTable>
      <p className="meta mt-2">
        Closing posts one entry on the last day of the year that moves every revenue and expense balance into the
        fund&apos;s net assets (3000 unrestricted, 3100 internally restricted, 3200 externally restricted), then
        closes all twelve periods. It is undone only by reopening the year, which posts a reopening entry. Both
        steps are recorded in the audit log.
      </p>

      <h2 className="mt-8 mb-2 text-base font-semibold" id="package">
        Year-end package
      </h2>
      <NotFiledNotice />
      <div className="card mb-4 p-4">
        <YearPicker years={years} selected={year.startsOn} />
      </div>
      <div className="card grid gap-6 p-4 text-[13.5px] md:grid-cols-2">
        <section aria-labelledby="pkg-statements">
          <h3 id="pkg-statements" className="mb-2 font-semibold">
            Statements and balances
          </h3>
          <ul className="space-y-2">
            <li>
              <Link className="text-brand-fg hover:underline" href={`/finance/ledger/statements?year=${year.startsOn}`}>
                Financial statements (printable)
              </Link>
            </li>
            <li>
              <DownloadLink href={`/api/finance/ledger/statements?year=${year.startsOn}&statement=position`}>
                Statement of financial position CSV
              </DownloadLink>
            </li>
            <li>
              <DownloadLink href={`/api/finance/ledger/statements?year=${year.startsOn}&statement=operations`}>
                Statement of operations CSV
              </DownloadLink>
            </li>
            <li>
              <DownloadLink href={`/api/finance/ledger/export/trial-balance?as_of=${year.endsOn}`}>
                Trial balance at {year.endsOn} (import CSV)
              </DownloadLink>
            </li>
            <li>
              <DownloadLink href={`/api/finance/ledger/export/journal?${q}`}>
                General ledger for the year (import CSV)
              </DownloadLink>
            </li>
            <li>
              <DownloadLink href={`/api/finance/ledger/export/receipts?${q}`}>Receipts and bills CSV</DownloadLink>
            </li>
            <li>
              <Link className="text-brand-fg hover:underline" href={`/finance/ledger/returns?year=${year.startsOn}`}>
                Annual returns checklist
              </Link>
            </li>
          </ul>
        </section>
        <section aria-labelledby="pkg-periods">
          <h3 id="pkg-periods" className="mb-2 font-semibold">
            General ledger by period (import CSV)
          </h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {monthsOf(year).map((m) => (
              <li key={m.label}>
                <DownloadLink href={`/api/finance/ledger/export/journal?from=${m.from}&to=${m.to}`}>{m.label}</DownloadLink>
              </li>
            ))}
          </ul>
          <p className="meta mt-3">
            Columns: date, entry no, account code, account name, fund, program, description, debit, credit. Each
            entry&apos;s receipt and trail are on its page in the Journal.
          </p>
        </section>
      </div>

      {year.history.some((c) => c.reopened_at) ? (
        <>
          <h2 className="mt-8 mb-2 text-base font-semibold">Reopenings of this year</h2>
          <ul className="card divide-y divide-line text-[13.5px]">
            {year.history
              .filter((c) => c.reopened_at)
              .map((c) => (
                <li key={c.id} className="px-4 py-2">
                  Reopened {c.reopened_at?.slice(0, 10)}
                  {c.reopener ? ` by ${c.reopener.full_name}` : ""}: {c.reopen_reason}
                  {c.reopening_entry_id ? (
                    <>
                      {" "}
                      <Link className="text-brand-fg hover:underline" href={`/finance/ledger/journal/${c.reopening_entry_id}`}>
                        Reopening entry
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
