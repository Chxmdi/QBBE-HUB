import type { Metadata } from "next";
import Link from "next/link";
import { Download, Hourglass } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCents } from "@/features/ledger/money";
import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { PayablesTabs } from "@/features/payables/components/payables-tabs";
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABEL,
  invoiceLabel,
  summarizeAging,
  type AgingRow,
  type DocumentKind,
} from "@/features/payables/model";
import { getPayablesAccess } from "@/features/payables/services/payables.queries";

export const metadata: Metadata = { title: "Aging" };
export const dynamic = "force-dynamic";

export default async function AgingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { session, supabase } = await getPayablesAccess();
  const params = await searchParams;
  const kind: DocumentKind = params.kind === "invoice" ? "invoice" : "bill";
  const asOf = dateParam(params.as_of, todayIn(session.timeZone));
  const org = session.organizationId;

  const { data } = await supabase.rpc("finance_aging", { p_organization: org, p_kind: kind, p_as_of: asOf });
  const rows = ((data ?? []) as AgingRow[]).map((r) => ({
    ...r,
    total_cents: Number(r.total_cents),
    open_cents: Number(r.open_cents),
  }));
  const { totals, contacts } = summarizeAging(rows);

  // The same total from the ledger, for those who may read it: the balance
  // of the payable (or receivable) accounts these documents post to.
  const [{ data: tb }, { data: controls }] = await Promise.all([
    supabase.rpc("ledger_trial_balance", { p_organization: org, p_as_of: asOf }),
    kind === "bill"
      ? supabase.from("finance_bill").select("payable_account_id").eq("organization_id", org).not("payable_account_id", "is", null)
      : supabase.from("finance_invoice").select("receivable_account_id").eq("organization_id", org).not("receivable_account_id", "is", null),
  ]);
  const controlIds = new Set(
    ((controls ?? []) as Record<string, string>[]).map((c) => c.payable_account_id ?? c.receivable_account_id),
  );
  const ledgerRows = (tb ?? []) as { account_id: string; code: string; name: string; balance_cents: number }[];
  const ledgerVisible = ledgerRows.length > 0;
  const ledgerTotal =
    ledgerRows.filter((r) => controlIds.has(r.account_id)).reduce((s, r) => s + Number(r.balance_cents), 0) *
    (kind === "bill" ? -1 : 1);

  const isBill = kind === "bill";
  const csvHref = `/api/finance/aging?kind=${kind}&as_of=${asOf}`;

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Bills and invoices"
        description="What is still owed on each date, by how long past due. Built from the same dates as the ledger entries, so it adds up to the payable and receivable account balances."
      />
      <PayablesTabs />
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label="Aging options">
        <div>
          <Label htmlFor="aging-kind">Report</Label>
          <Select id="aging-kind" name="kind" defaultValue={kind}>
            <option value="bill">Accounts payable (bills)</option>
            <option value="invoice">Accounts receivable (invoices)</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="aging-as-of">As at</Label>
          <Input id="aging-as-of" name="as_of" type="date" defaultValue={asOf} />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <a
          href={csvHref}
          className="inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-soft"
        >
          <Download className="size-4" aria-hidden />
          Download CSV
        </a>
      </form>

      <h2 className="mb-2 text-[15px] font-semibold">
        {isBill ? "Accounts payable aging" : "Accounts receivable aging"} as at {asOf}
      </h2>
      {rows.length === 0 ? (
        <EmptyState icon={<Hourglass />} title="Nothing owing on this date" description={isBill ? "Every posted bill was paid by then." : "Every posted invoice was paid by then."} />
      ) : (
        <>
          <DataTable minWidth="820px">
            <TableHead>
              <TableHeader>{isBill ? "Vendor" : "Customer"}</TableHeader>
              {AGING_BUCKETS.map((b) => (
                <TableHeader key={b} className="w-28 text-right">
                  {AGING_BUCKET_LABEL[b]}
                </TableHeader>
              ))}
              <TableHeader className="w-32 text-right">Total</TableHeader>
            </TableHead>
            <tbody>
              {contacts.map((c) => (
                <TableRow key={c.contactId}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  {AGING_BUCKETS.map((b) => (
                    <TableCell key={b} className="text-right tabular-nums">
                      {c.totals[b] ? formatCents(c.totals[b]) : "—"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold tabular-nums">{formatCents(c.totals.total)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                {AGING_BUCKETS.map((b) => (
                  <TableCell key={b} className="text-right font-semibold tabular-nums">
                    {formatCents(totals[b])}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold tabular-nums">{formatCents(totals.total)}</TableCell>
              </TableRow>
            </tbody>
          </DataTable>

          <h2 className="mt-6 mb-2 text-[15px] font-semibold">Open {isBill ? "bills" : "invoices"}</h2>
          <DataTable minWidth="760px">
            <TableHead>
              <TableHeader>{isBill ? "Vendor" : "Customer"}</TableHeader>
              <TableHeader className="w-32">{isBill ? "Vendor no." : "Invoice"}</TableHeader>
              <TableHeader className="w-28">Due</TableHeader>
              <TableHeader className="w-28 text-right">Days past due</TableHeader>
              <TableHeader className="w-32 text-right">Total</TableHeader>
              <TableHeader className="w-32 text-right">Open</TableHeader>
            </TableHead>
            <tbody>
              {rows.map((r) => (
                <TableRow key={r.document_id}>
                  <TableCell>
                    <Link
                      href={`/finance/payables/${isBill ? "bills" : "invoices"}/${r.document_id}`}
                      className="font-medium text-brand-fg hover:underline"
                    >
                      {r.contact_name}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {isBill ? (r.reference ?? "—") : invoiceLabel(r.reference === null ? null : Number(r.reference))}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.due_date}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.days_past_due}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(r.total_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(r.open_cents)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        </>
      )}

      {ledgerVisible ? (
        <p className="mt-4 text-[13.5px]" data-testid="aging-ledger-check">
          Ledger balance of the {isBill ? "payable" : "receivable"} accounts on {asOf}:{" "}
          <strong className="tabular-nums">{formatCents(ledgerTotal)}</strong>.{" "}
          {ledgerTotal === totals.total
            ? "It matches the aging total."
            : "It differs from the aging total: an entry posted directly to one of these accounts in the journal is not tied to a bill or invoice."}
        </p>
      ) : null}
    </div>
  );
}
