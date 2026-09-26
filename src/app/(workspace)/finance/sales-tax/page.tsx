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

export const metadata: Metadata = { title: "GST and QST" };
export const dynamic = "force-dynamic";

function netLabel(collected: number | null, claimed: number | null): string {
  if (collected === null || claimed === null) return "";
  const net = collected - claimed;
  return net < 0 ? `${formatCents(-net)} refund` : `${formatCents(net)} owing`;
}

export default async function SalesTaxPage() {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const header = (
    <PageHeader
      eyebrow="Finance"
      title="GST and QST"
      description="Tax collected on sales and paid on purchases, the figures for each return, and the net tax posted to the ledger. Nothing is filed from here."
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

  return (
    <div>
      {header}
      <TaxTabs />

      <section aria-labelledby="tax-settings" className="card mb-6 p-4">
        <h2 id="tax-settings" className="mb-3 text-[15px] font-semibold">
          Registration and filing
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
              <dt className="meta">GST</dt>
              <dd>{settings?.gst_registered ? `Registered ${settings.gst_number ?? ""}` : "Not registered"}</dd>
            </div>
            <div>
              <dt className="meta">QST</dt>
              <dd>{settings?.qst_registered ? `Registered ${settings.qst_number ?? ""}` : "Not registered"}</dd>
            </div>
            <div>
              <dt className="meta">Filing frequency</dt>
              <dd>{FILING_FREQUENCY_LABEL[frequency]}</dd>
            </div>
            <div>
              <dt className="meta">Share of tax paid claimed back</dt>
              <dd>{claimPercent} %</dd>
            </div>
          </dl>
        )}
        <p className="meta mt-3">
          Whether QBBE is registered, how often it files and what share it can claim back are the accountant&apos;s
          decisions. Rates in force: GST 5 %, QST 9.975 % (on the price before GST).
        </p>
      </section>

      <section aria-labelledby="tax-periods">
        <h2 id="tax-periods" className="mb-3 text-[15px] font-semibold">
          Tax periods
        </h2>
        {canManage ? (
          <div className="card mb-4 p-4">
            <TaxPeriodForm defaultStart={next.startsOn} defaultEnd={next.endsOn} />
          </div>
        ) : null}
        {periods.length === 0 ? (
          <EmptyState
            icon={<CalendarRange />}
            title="No tax periods yet"
            description="Add the first reporting period once the accountant confirms the filing frequency."
          />
        ) : (
          <DataTable minWidth="640px">
            <TableHead>
              <TableHeader>Period</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Net GST</TableHeader>
              <TableHeader>Net QST</TableHeader>
              <TableHeader className="text-right">
                <span className="sr-only">Links</span>
              </TableHeader>
            </TableHead>
            <tbody>
              {periods.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium tabular-nums">
                    {p.starts_on} to {p.ends_on}
                  </TableCell>
                  <TableCell>
                    {p.status === "open" ? <Badge tone="success">Open</Badge> : <Badge>Closed</Badge>}
                  </TableCell>
                  <TableCell className="tabular-nums">{netLabel(p.gst_collected_cents, p.gst_claimed_cents)}</TableCell>
                  <TableCell className="tabular-nums">{netLabel(p.qst_collected_cents, p.qst_claimed_cents)}</TableCell>
                  <TableCell className="text-right">
                    <Link className="underline" href={`/finance/sales-tax/worksheet?period=${p.id}`}>
                      Worksheet<span className="sr-only"> for {p.starts_on} to {p.ends_on}</span>
                    </Link>
                    {p.closing_entry_id ? (
                      <>
                        {" · "}
                        <Link className="underline" href={`/finance/ledger/journal/${p.closing_entry_id}`}>
                          Closing entry<span className="sr-only"> for {p.starts_on} to {p.ends_on}</span>
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
