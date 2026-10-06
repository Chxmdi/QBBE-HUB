import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { formatCents } from "@/features/ledger/money";
import { dateParam, getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import {
  DeleteTaxLineButton,
  ImportReceiptsForm,
  TaxLineDialog,
} from "@/features/sales-tax/components/tax-forms";
import { lineValues } from "@/features/sales-tax/line-values";
import { TaxTabs } from "@/features/sales-tax/components/tax-tabs";
import { TAX_CODES, TAX_CODE_LABEL, type Direction, type TaxCode } from "@/features/sales-tax/return-lines";
import {
  DIRECTION_LABEL,
  LINE_LIMIT,
  listTaxLines,
  listTaxPeriods,
} from "@/features/sales-tax/services/sales-tax.queries";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.salesTax.tabs.lines") };
}
export const dynamic = "force-dynamic";

function codesParam(value: string | undefined): TaxCode[] {
  if (!value) return [];
  return value.split(",").filter((c): c is TaxCode => (TAX_CODES as readonly string[]).includes(c));
}

export default async function TaxLinesPage({
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
      title={t("finance.salesTax.tabs.lines")}
      description={t("finance.salesTax.lines.description")}
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
  const to = dateParam(params.to, today);
  const from = dateParam(params.from, `${to.slice(0, 7)}-01`);
  const direction: Direction | null =
    params.direction === "sale" || params.direction === "purchase" ? params.direction : null;
  const codes = codesParam(params.codes);
  const [{ lines, truncated }, periods] = await Promise.all([
    listTaxLines(supabase, session.organizationId, { from, to, direction, codes }),
    listTaxPeriods(supabase, session.organizationId),
  ]);
  const closed = periods.filter((p) => p.status === "closed");
  const isClosed = (date: string) => closed.some((p) => p.starts_on <= date && date <= p.ends_on);
  const total = (pick: (l: (typeof lines)[number]) => number) => lines.reduce((n, l) => n + pick(l), 0);

  return (
    <div>
      {header}
      <TaxTabs />
      <form method="get" className="card mb-4 grid grid-cols-2 items-end gap-3 p-4 lg:grid-cols-5" aria-label={t("finance.salesTax.lines.filtersAria")}>
        <div>
          <Label htmlFor="tl-from">{t("finance.salesTax.from")}</Label>
          <Input id="tl-from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="tl-to">{t("finance.salesTax.to")}</Label>
          <Input id="tl-to" name="to" type="date" defaultValue={to} />
        </div>
        <div>
          <Label htmlFor="tl-direction">{t("finance.salesTax.lines.direction")}</Label>
          <Select id="tl-direction" name="direction" defaultValue={direction ?? ""}>
            <option value="">{t("finance.salesTax.lines.both")}</option>
            <option value="sale">{t("finance.salesTax.lines.sales")}</option>
            <option value="purchase">{t("finance.salesTax.lines.purchases")}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="tl-codes">{t("finance.salesTax.lineDialog.taxCode")}</Label>
          <Select id="tl-codes" name="codes" defaultValue={codes.join(",")}>
            <option value="">{t("finance.salesTax.lines.allCodes")}</option>
            {codes.length > 1 ? (
              <option value={codes.join(",")}>
                {codes.map((c) => t(TAX_CODE_LABEL[c])).join(t("finance.salesTax.lines.codesJoiner"))}
              </option>
            ) : null}
            {TAX_CODES.map((c) => (
              <option key={c} value={c}>
                {t(TAX_CODE_LABEL[c])}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          {t("finance.salesTax.lines.show")}
        </Button>
      </form>

      {canManage ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <ImportReceiptsForm from={from} to={to} />
          <TaxLineDialog
            trigger={{ label: t("finance.salesTax.lines.add") }}
            initial={{
              direction: "sale",
              taxCode: "standard",
              transactionDate: to,
              counterparty: "",
              reference: "",
              description: "",
              amount: "",
              gst: "",
              qst: "",
              itc: "",
              itr: "",
            }}
          />
        </div>
      ) : null}

      {lines.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title={t("finance.salesTax.lines.emptyTitle")}
          description={t("finance.salesTax.lines.emptyDescription")}
        />
      ) : (
        <DataTable minWidth="980px">
          <TableHead>
            <TableHeader>{t("finance.common.date")}</TableHeader>
            <TableHeader>{t("finance.salesTax.lines.colType")}</TableHeader>
            <TableHeader>{t("finance.salesTax.lines.colCode")}</TableHeader>
            <TableHeader>{t("finance.salesTax.lines.colCounterparty")}</TableHeader>
            <TableHeader className="text-right">{t("finance.salesTax.lines.colBeforeTax")}</TableHeader>
            <TableHeader className="text-right">{t("finance.common.gst")}</TableHeader>
            <TableHeader className="text-right">{t("finance.common.qst")}</TableHeader>
            <TableHeader className="text-right">{t("finance.salesTax.lines.colItc")}</TableHeader>
            <TableHeader className="text-right">{t("finance.salesTax.lines.colItr")}</TableHeader>
            {canManage ? (
              <TableHeader className="text-right">
                <span className="sr-only">{t("finance.common.actions")}</span>
              </TableHeader>
            ) : null}
          </TableHead>
          <tbody>
            {lines.map((l) => {
              const label = t(
                l.direction === "sale" ? "finance.salesTax.lines.labelSale" : "finance.salesTax.lines.labelPurchase",
                { counterparty: l.counterparty, date: l.transaction_date },
              );
              return (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums">{l.transaction_date}</TableCell>
                  <TableCell>{t(DIRECTION_LABEL[l.direction])}</TableCell>
                  <TableCell>{t(TAX_CODE_LABEL[l.tax_code])}</TableCell>
                  <TableCell>
                    <span className="font-medium">{l.counterparty}</span>
                    {l.reference ? <span className="meta"> · {l.reference}</span> : null}
                    {l.source_type === "finance_receipt" ? (
                      <span className="meta">
                        {" · "}
                        <Link className="underline" href="/finance/receipts">
                          {t("finance.salesTax.lines.fromReceipt")}
                        </Link>
                      </span>
                    ) : null}
                    {l.description ? <div className="meta">{l.description}</div> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.amount_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.gst_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.qst_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.itc_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.itr_cents)}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right whitespace-nowrap">
                      {isClosed(l.transaction_date) ? (
                        <span className="meta">{t("finance.salesTax.lines.periodClosed")}</span>
                      ) : (
                        <span className="inline-flex gap-1">
                          <TaxLineDialog trigger={{ label: t("finance.salesTax.lines.edit"), variant: "ghost" }} initial={lineValues(l)} />
                          <DeleteTaxLineButton lineId={l.id} label={label} />
                        </span>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell className="font-semibold">{t("finance.common.total")}</TableCell>
              <TableCell>{null}</TableCell>
              <TableCell>{null}</TableCell>
              <TableCell className="meta">
                {t(lines.length === 1 ? "finance.salesTax.lineCountOne" : "finance.salesTax.lineCountOther", {
                  count: lines.length,
                })}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(total((l) => l.amount_cents))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(total((l) => l.gst_cents))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(total((l) => l.qst_cents))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(total((l) => l.itc_cents))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(total((l) => l.itr_cents))}</TableCell>
              {canManage ? <TableCell>{null}</TableCell> : null}
            </TableRow>
          </tbody>
        </DataTable>
      )}
      {truncated ? (
        <p className="meta mt-3">{t("finance.salesTax.lines.truncated", { limit: LINE_LIMIT })}</p>
      ) : null}
    </div>
  );
}
