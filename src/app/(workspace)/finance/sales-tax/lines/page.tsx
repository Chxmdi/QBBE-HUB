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
  lineValues,
} from "@/features/sales-tax/components/tax-forms";
import { TaxTabs } from "@/features/sales-tax/components/tax-tabs";
import { TAX_CODES, TAX_CODE_LABEL, type Direction, type TaxCode } from "@/features/sales-tax/return-lines";
import {
  DIRECTION_LABEL,
  LINE_LIMIT,
  listTaxLines,
  listTaxPeriods,
} from "@/features/sales-tax/services/sales-tax.queries";

export const metadata: Metadata = { title: "Tax lines" };
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
  const header = (
    <PageHeader
      eyebrow="GST and QST"
      title="Tax lines"
      description="Every sale and purchase that counts on the returns, with the tax charged, paid and claimed back."
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
      <form method="get" className="card mb-4 grid grid-cols-2 items-end gap-3 p-4 lg:grid-cols-5" aria-label="Tax line filters">
        <div>
          <Label htmlFor="tl-from">From</Label>
          <Input id="tl-from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="tl-to">To</Label>
          <Input id="tl-to" name="to" type="date" defaultValue={to} />
        </div>
        <div>
          <Label htmlFor="tl-direction">Sales or purchases</Label>
          <Select id="tl-direction" name="direction" defaultValue={direction ?? ""}>
            <option value="">Both</option>
            <option value="sale">Sales</option>
            <option value="purchase">Purchases</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="tl-codes">Tax code</Label>
          <Select id="tl-codes" name="codes" defaultValue={codes.join(",")}>
            <option value="">All codes</option>
            {codes.length > 1 ? <option value={codes.join(",")}>{codes.map((c) => TAX_CODE_LABEL[c]).join(" and ")}</option> : null}
            {TAX_CODES.map((c) => (
              <option key={c} value={c}>
                {TAX_CODE_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Show lines
        </Button>
      </form>

      {canManage ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <ImportReceiptsForm from={from} to={to} />
          <TaxLineDialog
            trigger={{ label: "Add tax line" }}
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
          title="No tax lines in this range"
          description="Sales and purchases appear here once they are recorded or brought in from receipts."
        />
      ) : (
        <DataTable minWidth="980px">
          <TableHead>
            <TableHeader>Date</TableHeader>
            <TableHeader>Type</TableHeader>
            <TableHeader>Code</TableHeader>
            <TableHeader>Counterparty</TableHeader>
            <TableHeader className="text-right">Before tax</TableHeader>
            <TableHeader className="text-right">GST</TableHeader>
            <TableHeader className="text-right">QST</TableHeader>
            <TableHeader className="text-right">ITC</TableHeader>
            <TableHeader className="text-right">ITR</TableHeader>
            {canManage ? (
              <TableHeader className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeader>
            ) : null}
          </TableHead>
          <tbody>
            {lines.map((l) => {
              const label = `${DIRECTION_LABEL[l.direction].toLowerCase()} ${l.counterparty} on ${l.transaction_date}`;
              return (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums">{l.transaction_date}</TableCell>
                  <TableCell>{DIRECTION_LABEL[l.direction]}</TableCell>
                  <TableCell>{TAX_CODE_LABEL[l.tax_code]}</TableCell>
                  <TableCell>
                    <span className="font-medium">{l.counterparty}</span>
                    {l.reference ? <span className="meta"> · {l.reference}</span> : null}
                    {l.source_type === "finance_receipt" ? (
                      <span className="meta">
                        {" · "}
                        <Link className="underline" href="/finance/receipts">
                          from a receipt
                        </Link>
                      </span>
                    ) : null}
                    {l.description ? <div className="meta">{l.description}</div> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(l.amount_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(l.gst_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(l.qst_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(l.itc_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(l.itr_cents)}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right whitespace-nowrap">
                      {isClosed(l.transaction_date) ? (
                        <span className="meta">Period closed</span>
                      ) : (
                        <span className="inline-flex gap-1">
                          <TaxLineDialog trigger={{ label: "Edit", variant: "ghost" }} initial={lineValues(l)} />
                          <DeleteTaxLineButton lineId={l.id} label={label} />
                        </span>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell>{null}</TableCell>
              <TableCell>{null}</TableCell>
              <TableCell className="meta">
                {lines.length} line{lines.length === 1 ? "" : "s"}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatCents(total((l) => l.amount_cents))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatCents(total((l) => l.gst_cents))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatCents(total((l) => l.qst_cents))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatCents(total((l) => l.itc_cents))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatCents(total((l) => l.itr_cents))}</TableCell>
              {canManage ? <TableCell>{null}</TableCell> : null}
            </TableRow>
          </tbody>
        </DataTable>
      )}
      {truncated ? (
        <p className="meta mt-3">
          Showing the first {LINE_LIMIT} lines. Narrow the dates, or download the worksheet CSV for all of them.
        </p>
      ) : null}
    </div>
  );
}
