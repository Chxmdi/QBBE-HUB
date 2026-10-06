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
import type { Locale } from "@/lib/i18n/config";
import { getLocale, getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.salesTax.tabs.worksheet") };
}
export const dynamic = "force-dynamic";

function ReturnTable({
  title,
  lines,
  from,
  to,
  t,
  locale,
}: {
  title: string;
  lines: ReturnLine[];
  from: string;
  to: string;
  t: TranslateFn;
  locale: Locale;
}) {
  return (
    <section aria-label={title} className="mb-6">
      <h2 className="mb-2 text-[15px] font-semibold">{title}</h2>
      <DataTable minWidth="520px">
        <TableHead>
          <TableHeader className="w-16">{t("finance.salesTax.worksheet.colLine")}</TableHeader>
          <TableHeader>{t("finance.common.description")}</TableHeader>
          <TableHeader className="text-right">{t("finance.common.amount")}</TableHeader>
        </TableHead>
        <tbody>
          {lines.map((l) => {
            const query = l.source
              ? new URLSearchParams({ from, to, direction: l.source.direction, codes: l.source.codes.join(",") }).toString()
              : null;
            return (
              <TableRow key={l.line}>
                <TableCell className="font-medium tabular-nums">{l.line}</TableCell>
                <TableCell className={l.isTotal ? "font-semibold" : undefined}>{t(l.label)}</TableCell>
                <TableCell className={`text-right tabular-nums ${l.isTotal ? "font-semibold" : ""}`}>
                  {query ? (
                    <Link
                      className="underline"
                      href={`/finance/sales-tax/lines?${query}`}
                      aria-label={t("finance.salesTax.worksheet.drillDown", {
                        amount: formatCents(l.cents, locale),
                        line: l.line,
                      })}
                    >
                      {formatCents(l.cents, locale)}
                    </Link>
                  ) : (
                    formatCents(l.cents, locale)
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
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const money = (cents: number) => formatCents(cents, locale);
  const header = (
    <PageHeader
      eyebrow={t("finance.salesTax.title")}
      title={t("finance.salesTax.tabs.worksheet")}
      description={t("finance.salesTax.worksheet.description")}
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
  const periodLabel = t("finance.salesTax.periodRange", { from, to });

  return (
    <div>
      {header}
      <TaxTabs />
      <form method="get" className="card mb-4 grid grid-cols-2 items-end gap-3 p-4 lg:grid-cols-4" aria-label={t("finance.salesTax.worksheet.periodAria")}>
        <div className="col-span-2 lg:col-span-1">
          <Label htmlFor="ws-period">{t("finance.salesTax.worksheet.taxPeriod")}</Label>
          <Select id="ws-period" name="period" defaultValue={period?.id ?? ""}>
            <option value="">{t("finance.salesTax.worksheet.customDates")}</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {t("finance.salesTax.periodRange", { from: p.starts_on, to: p.ends_on })}{" "}
                {p.status === "closed" ? t("finance.salesTax.worksheet.closedSuffix") : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ws-from">{t("finance.salesTax.from")}</Label>
          <Input id="ws-from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="ws-to">{t("finance.salesTax.to")}</Label>
          <Input id="ws-to" name="to" type="date" defaultValue={to} />
        </div>
        <Button type="submit" variant="secondary">
          {t("finance.salesTax.worksheet.show")}
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px]">
          <span className="font-medium">{periodLabel}</span>
          {period ? (
            <>
              {" "}
              {period.status === "open" ? (
                <Badge tone="success">{t("finance.salesTax.open")}</Badge>
              ) : (
                <Badge>{t("finance.salesTax.closed")}</Badge>
              )}
            </>
          ) : null}
          <span className="meta">
            {" · "}
            {t(worksheet.lineCount === 1 ? "finance.salesTax.lineCountOne" : "finance.salesTax.lineCountOther", {
              count: worksheet.lineCount,
            })}
          </span>
        </p>
        <a
          href={`/api/finance/sales-tax/worksheet?${exportQuery}`}
          className="inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-soft"
        >
          <Download className="size-4" aria-hidden />
          {t("finance.common.downloadCsv")}
        </a>
      </div>

      {!settings?.gst_registered && !settings?.qst_registered ? (
        <p className="card mb-4 p-3 text-[13.5px]">{t("finance.salesTax.worksheet.notRegistered")}</p>
      ) : null}

      <ReturnTable
        title={t("finance.salesTax.worksheet.gstTitle")}
        lines={worksheet.gst}
        from={from}
        to={to}
        t={t}
        locale={locale}
      />
      <ReturnTable
        title={t("finance.salesTax.worksheet.qstTitle")}
        lines={worksheet.qst}
        from={from}
        to={to}
        t={t}
        locale={locale}
      />
      <p className="meta mb-6">{t("finance.salesTax.worksheet.reviewNote")}</p>

      {showRebate ? (
        <section aria-labelledby="psb-rebate" className="card mb-6 border-warning p-4">
          <h2 id="psb-rebate" className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
            <TriangleAlert className="size-4 text-warning-fg" aria-hidden />
            {t("finance.salesTax.worksheet.rebateHeading")}
          </h2>
          <p className="mb-3 text-[13.5px] text-muted">
            {t("finance.salesTax.worksheet.rebateExplanation", {
              gst: PSB_REBATE_BP.gst / 100,
              qst: PSB_REBATE_BP.qst / 100,
            })}
          </p>
          <dl className="grid gap-2 text-[13.5px] sm:grid-cols-2">
            <div>
              <dt className="meta">{t("finance.salesTax.worksheet.gstPaidNotClaimed")}</dt>
              <dd className="tabular-nums">{money(worksheet.rebate.gstPaidNotClaimed)}</dd>
            </div>
            <div>
              <dt className="meta">{t("finance.salesTax.worksheet.gstRebate")}</dt>
              <dd className="font-semibold tabular-nums">{money(worksheet.rebate.gstRebate)}</dd>
            </div>
            <div>
              <dt className="meta">{t("finance.salesTax.worksheet.qstPaidNotClaimed")}</dt>
              <dd className="tabular-nums">{money(worksheet.rebate.qstPaidNotClaimed)}</dd>
            </div>
            <div>
              <dt className="meta">{t("finance.salesTax.worksheet.qstRebate")}</dt>
              <dd className="font-semibold tabular-nums">{money(worksheet.rebate.qstRebate)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {period ? (
        <section aria-labelledby="closing" className="card p-4">
          <h2 id="closing" className="mb-2 text-[15px] font-semibold">
            {t("finance.salesTax.worksheet.closingHeading")}
          </h2>
          {period.status === "open" ? (
            <>
              <p className="mb-3 text-[13.5px] text-muted">
                {t("finance.salesTax.worksheet.closingExplanation", {
                  date: period.ends_on,
                  gstCollected: money(worksheet.closing.gstCollected),
                  qstCollected: money(worksheet.closing.qstCollected),
                  gstClaimed: money(worksheet.closing.gstClaimed),
                  qstClaimed: money(worksheet.closing.qstClaimed),
                })}
              </p>
              {canManage ? (
                <CloseTaxPeriodButton periodId={period.id} label={periodLabel} />
              ) : (
                <p className="meta">{t("finance.salesTax.worksheet.adminCloses")}</p>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13.5px]">
                {t("finance.salesTax.worksheet.closedSummary", {
                  gst: money((period.gst_collected_cents ?? 0) - (period.gst_claimed_cents ?? 0)),
                  qst: money((period.qst_collected_cents ?? 0) - (period.qst_claimed_cents ?? 0)),
                })}{" "}
                {period.closing_entry_id ? (
                  <Link className="underline" href={`/finance/ledger/journal/${period.closing_entry_id}`}>
                    {t("finance.salesTax.worksheet.viewClosingEntry")}
                  </Link>
                ) : (
                  t("finance.salesTax.worksheet.noEntryPosted")
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
