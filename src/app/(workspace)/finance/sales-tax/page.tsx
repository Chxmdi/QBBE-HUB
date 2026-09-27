import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { formatCents } from "@/features/ledger/money";
import { getLedgerAccess } from "@/features/ledger/services/ledger.access";
import { TaxPeriodForm, TaxSettingsForm } from "@/features/sales-tax/components/tax-forms";
import { TaxTabs } from "@/features/sales-tax/components/tax-tabs";
import { suggestNextPeriod } from "@/features/sales-tax/periods";
import { FILING_FREQUENCY_LABEL } from "@/features/sales-tax/return-lines";
import { getTaxSettings, listTaxPeriods } from "@/features/sales-tax/services/sales-tax.queries";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.salesTax.title") };
}
export const dynamic = "force-dynamic";

function netLabel(t: TranslateFn, locale: Locale, collected: number | null, claimed: number | null): string {
  if (collected === null || claimed === null) return "";
  const net = collected - claimed;
  return net < 0
    ? t("finance.salesTax.overview.netRefund", { amount: formatCents(-net, locale) })
    : t("finance.salesTax.overview.netOwing", { amount: formatCents(net, locale) });
}

export default async function SalesTaxPage() {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const header = (
    <PageHeader
      eyebrow={t("finance.common.title")}
      title={t("finance.salesTax.title")}
      description={t("finance.salesTax.overview.description")}
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

  const [settings, periods] = await Promise.all([
    getTaxSettings(supabase, session.organizationId),
    listTaxPeriods(supabase, session.organizationId),
  ]);
  const frequency = settings?.filing_frequency ?? "annual";
  const next = suggestNextPeriod(periods[0]?.ends_on ?? null, frequency);
  const claimPercent = ((settings?.itc_claim_bp ?? 10000) / 100).toString();
  const range = (from: string, to: string) => t("finance.salesTax.periodRange", { from, to });

  return (
    <div>
      {header}
      <TaxTabs />

      <section aria-labelledby="tax-settings" className="card mb-6 p-4">
        <h2 id="tax-settings" className="mb-3 text-[15px] font-semibold">
          {t("finance.salesTax.overview.settingsHeading")}
        </h2>
        {canManage ? (
          <TaxSettingsForm
            initial={{
              gstRegistered: settings?.gst_registered ?? false,
              gstNumber: settings?.gst_number ?? "",
              qstRegistered: settings?.qst_registered ?? false,
              qstNumber: settings?.qst_number ?? "",
              filingFrequency: frequency,
              claimPercent,
              showPsbRebate: settings?.show_psb_rebate ?? false,
            }}
          />
        ) : (
          <dl className="grid gap-2 text-[13.5px] sm:grid-cols-2">
            <div>
              <dt className="meta">{t("finance.common.gst")}</dt>
              <dd>
                {settings?.gst_registered
                  ? t("finance.salesTax.overview.registered", { number: settings.gst_number ?? "" })
                  : t("finance.salesTax.overview.notRegistered")}
              </dd>
            </div>
            <div>
              <dt className="meta">{t("finance.common.qst")}</dt>
              <dd>
                {settings?.qst_registered
                  ? t("finance.salesTax.overview.registered", { number: settings.qst_number ?? "" })
                  : t("finance.salesTax.overview.notRegistered")}
              </dd>
            </div>
            <div>
              <dt className="meta">{t("finance.salesTax.overview.filingFrequency")}</dt>
              <dd>{t(FILING_FREQUENCY_LABEL[frequency])}</dd>
            </div>
            <div>
              <dt className="meta">{t("finance.salesTax.overview.claimShare")}</dt>
              <dd>
                {t("finance.salesTax.overview.percentValue", {
                  percent: formatNumber((settings?.itc_claim_bp ?? 10000) / 100, locale),
                })}
              </dd>
            </div>
          </dl>
        )}
        <p className="meta mt-3">{t("finance.salesTax.overview.settingsNote")}</p>
      </section>

      <section aria-labelledby="tax-periods">
        <h2 id="tax-periods" className="mb-3 text-[15px] font-semibold">
          {t("finance.salesTax.overview.periodsHeading")}
        </h2>
        {canManage ? (
          <div className="card mb-4 p-4">
            <TaxPeriodForm defaultStart={next.startsOn} defaultEnd={next.endsOn} />
          </div>
        ) : null}
        {periods.length === 0 ? (
          <EmptyState
            icon={<CalendarRange />}
            title={t("finance.salesTax.overview.noPeriodsTitle")}
            description={t("finance.salesTax.overview.noPeriodsDescription")}
          />
        ) : (
          <DataTable minWidth="640px">
            <TableHead>
              <TableHeader>{t("finance.salesTax.overview.colPeriod")}</TableHeader>
              <TableHeader>{t("finance.common.status")}</TableHeader>
              <TableHeader>{t("finance.salesTax.overview.colNetGst")}</TableHeader>
              <TableHeader>{t("finance.salesTax.overview.colNetQst")}</TableHeader>
              <TableHeader className="text-right">
                <span className="sr-only">{t("finance.salesTax.overview.colLinks")}</span>
              </TableHeader>
            </TableHead>
            <tbody>
              {periods.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium tabular-nums">
                    {range(p.starts_on, p.ends_on)}
                  </TableCell>
                  <TableCell>
                    {p.status === "open" ? (
                      <Badge tone="success">{t("finance.salesTax.open")}</Badge>
                    ) : (
                      <Badge>{t("finance.salesTax.closed")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{netLabel(t, locale, p.gst_collected_cents, p.gst_claimed_cents)}</TableCell>
                  <TableCell className="tabular-nums">{netLabel(t, locale, p.qst_collected_cents, p.qst_claimed_cents)}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      className="underline"
                      href={`/finance/sales-tax/worksheet?period=${p.id}`}
                      aria-label={t("finance.salesTax.overview.worksheetFor", { from: p.starts_on, to: p.ends_on })}
                    >
                      {t("finance.salesTax.overview.worksheet")}
                    </Link>
                    {p.closing_entry_id ? (
                      <>
                        {" · "}
                        <Link
                          className="underline"
                          href={`/finance/ledger/journal/${p.closing_entry_id}`}
                          aria-label={t("finance.salesTax.overview.closingEntryFor", {
                            from: p.starts_on,
                            to: p.ends_on,
                          })}
                        >
                          {t("finance.salesTax.overview.closingEntry")}
                        </Link>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}
