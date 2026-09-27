import type { Metadata } from "next";
import Link from "next/link";
import { Download, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { formatCents } from "@/features/ledger/money";
import { dateParam, getLedgerAccess, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { CloseTaxPeriodButton, ReopenTaxPeriodButton } from "@/features/sales-tax/components/tax-forms";
import { TaxTabs } from "@/features/sales-tax/components/tax-tabs";
import { PSB_REBATE_BP, type ReturnLine } from "@/features/sales-tax/return-lines";
import {
  buildWorksheet,
  getTaxSettings,
  listTaxPeriods,
  taxTotals,
} from "@/features/sales-tax/services/sales-tax.queries";

export const metadata: Metadata = { title: "Return worksheet" };
export const dynamic = "force-dynamic";

function ReturnTable({ title, lines, from, to }: { title: string; lines: ReturnLine[]; from: string; to: string }) {
  return (
    <section aria-label={title} className="mb-6">
      <h2 className="mb-2 text-[15px] font-semibold">{title}</h2>
      <DataTable minWidth="520px">
        <TableHead>
          <TableHeader className="w-16">Line</TableHeader>
          <TableHeader>Description</TableHeader>
          <TableHeader className="text-right">Amount</TableHeader>
        </TableHead>
        <tbody>
          {lines.map((l) => {
            const query = l.source
              ? new URLSearchParams({ from, to, direction: l.source.direction, codes: l.source.codes.join(",") }).toString()
              : null;
            return (
              <TableRow key={l.line}>
                <TableCell className="font-medium tabular-nums">{l.line}</TableCell>
                <TableCell className={l.isTotal ? "font-semibold" : undefined}>{l.label}</TableCell>
                <TableCell className={`text-right tabular-nums ${l.isTotal ? "font-semibold" : ""}`}>
                  {query ? (
                    <Link
                      className="underline"
                      href={`/finance/sales-tax/lines?${query}`}
                      aria-label={`${formatCents(l.cents)}, show the lines behind line ${l.line}`}
                    >
                      {formatCents(l.cents)}
                    </Link>
                  ) : (
                    formatCents(l.cents)
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </tbody>
      </DataTable>
    </section>
  );
}

export default async function TaxWorksheetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const params = await searchParams;
  const header = (
    <PageHeader
      eyebrow="GST and QST"
      title="Return worksheet"
      description="The figures for the GST and QST return lines of a period, each traced to the lines behind it. Prepared for the accountant; nothing is filed from the app."
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

  const today = todayIn(session.timeZone);
  const [settings, periods] = await Promise.all([
    getTaxSettings(supabase, session.organizationId),
    listTaxPeriods(supabase, session.organizationId),
  ]);
  const periodId = uuidParam(params.period);
  // A chosen period, else explicit dates, else the latest open period.
  const period =
    (periodId ? periods.find((p) => p.id === periodId) : undefined) ??
    (params.from || params.to ? undefined : periods.find((p) => p.status === "open"));
  const to = period?.ends_on ?? dateParam(params.to, today);
  const from = period?.starts_on ?? dateParam(params.from, `${to.slice(0, 7)}-01`);
  const worksheet = buildWorksheet(await taxTotals(supabase, session.organizationId, from, to));
  const showRebate = settings?.show_psb_rebate ?? false;
  const exportQuery = new URLSearchParams({ from, to }).toString();
  const periodLabel = `${from} to ${to}`;

  return (
    <div>
      {header}
      <TaxTabs />
      <form method="get" className="card mb-4 grid grid-cols-2 items-end gap-3 p-4 lg:grid-cols-4" aria-label="Worksheet period">
        <div className="col-span-2 lg:col-span-1">
          <Label htmlFor="ws-period">Tax period</Label>
          <Select id="ws-period" name="period" defaultValue={period?.id ?? ""}>
            <option value="">Custom dates</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.starts_on} to {p.ends_on} {p.status === "closed" ? "(closed)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ws-from">From</Label>
          <Input id="ws-from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="ws-to">To</Label>
          <Input id="ws-to" name="to" type="date" defaultValue={to} />
        </div>
        <Button type="submit" variant="secondary">
          Show worksheet
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px]">
          <span className="font-medium">{periodLabel}</span>
          {period ? (
            <>
              {" "}
              {period.status === "open" ? <Badge tone="success">Open</Badge> : <Badge>Closed</Badge>}
            </>
          ) : null}
          <span className="meta"> · {worksheet.lineCount} line{worksheet.lineCount === 1 ? "" : "s"}</span>
        </p>
        <a
          href={`/api/finance/sales-tax/worksheet?${exportQuery}`}
          className="inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-soft"
        >
          <Download className="size-4" aria-hidden />
          Download CSV
        </a>
      </div>

      {!settings?.gst_registered && !settings?.qst_registered ? (
        <p className="card mb-4 p-3 text-[13.5px]">
          The organization is recorded as not registered for GST or QST, so no tax is collected or claimed back. Change
          this on the overview once the accountant confirms the registration.
        </p>
      ) : null}

      <ReturnTable title="GST (federal lines)" lines={worksheet.gst} from={from} to={to} />
      <ReturnTable title="QST (Quebec lines)" lines={worksheet.qst} from={from} to={to} />
      <p className="meta mb-6">
        Line numbers and what feeds each line need accountant review before the first filing. Adjustments (lines 104,
        107, 204, 207) are entered by the accountant on the return and show as zero here.
      </p>

      {showRebate ? (
        <section aria-labelledby="psb-rebate" className="card mb-6 border-warning p-4">
          <h2 id="psb-rebate" className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
            <TriangleAlert className="size-4 text-warning-fg" aria-hidden />
            Public service body rebate: confirm eligibility with your accountant
          </h2>
          <p className="mb-3 text-[13.5px] text-muted">
            QBBE is a non-profit organization, not a registered charity. It qualifies only if the accountant confirms it
            meets the government-funding test. The rebate is {PSB_REBATE_BP.gst / 100} % of GST and{" "}
            {PSB_REBATE_BP.qst / 100} % of QST paid and not claimed back. These figures are an estimate, not a claim.
          </p>
          <dl className="grid gap-2 text-[13.5px] sm:grid-cols-2">
            <div>
              <dt className="meta">GST paid and not claimed back</dt>
              <dd className="tabular-nums">{formatCents(worksheet.rebate.gstPaidNotClaimed)}</dd>
            </div>
            <div>
              <dt className="meta">Estimated GST rebate</dt>
              <dd className="font-semibold tabular-nums">{formatCents(worksheet.rebate.gstRebate)}</dd>
            </div>
            <div>
              <dt className="meta">QST paid and not claimed back</dt>
              <dd className="tabular-nums">{formatCents(worksheet.rebate.qstPaidNotClaimed)}</dd>
            </div>
            <div>
              <dt className="meta">Estimated QST rebate</dt>
              <dd className="font-semibold tabular-nums">{formatCents(worksheet.rebate.qstRebate)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {period ? (
        <section aria-labelledby="closing" className="card p-4">
          <h2 id="closing" className="mb-2 text-[15px] font-semibold">
            Closing entry
          </h2>
          {period.status === "open" ? (
            <>
              <p className="mb-3 text-[13.5px] text-muted">
                Closing freezes this period&apos;s lines and posts one journal entry dated {period.ends_on}: GST collected
                ({formatCents(worksheet.closing.gstCollected)}) and QST collected (
                {formatCents(worksheet.closing.qstCollected)}) leave the payable accounts, amounts claimed back (
                {formatCents(worksheet.closing.gstClaimed)} GST, {formatCents(worksheet.closing.qstClaimed)} QST) leave
                the receivable accounts, and the difference goes to net GST (2220) and net QST (2230) owing.
              </p>
              {canManage ? (
                <CloseTaxPeriodButton periodId={period.id} label={periodLabel} />
              ) : (
                <p className="meta">An administrator with MFA closes the period.</p>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13.5px]">
                Closed. Net GST {formatCents((period.gst_collected_cents ?? 0) - (period.gst_claimed_cents ?? 0))}, net QST{" "}
                {formatCents((period.qst_collected_cents ?? 0) - (period.qst_claimed_cents ?? 0))} (negative is a refund).{" "}
                {period.closing_entry_id ? (
                  <Link className="underline" href={`/finance/ledger/journal/${period.closing_entry_id}`}>
                    View the closing entry
                  </Link>
                ) : (
                  "No tax, so no entry was posted."
                )}
              </p>
              {canManage ? (
                <ReopenTaxPeriodButton
                  periodId={period.id}
                  label={periodLabel}
                  defaultDate={today < period.ends_on ? period.ends_on : today}
                  minDate={period.ends_on}
                />
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
