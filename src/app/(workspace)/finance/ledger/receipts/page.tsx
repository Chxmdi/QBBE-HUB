import type { Metadata } from "next";
import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { YearPicker } from "@/features/ledger/components/year-picker";
import { formatCents } from "@/features/ledger/money";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { loadFiscalYears, pickYear } from "@/features/ledger/services/year-end.queries";

export const metadata: Metadata = { title: "Ledger receipts" };
export const dynamic = "force-dynamic";

const LIMIT = 500;

interface ReceiptRow {
  id: string;
  kind: "receipt" | "bill";
  document_date: string;
  vendor: string;
  total_cents: number;
  gst_cents: number;
  qst_cents: number;
  status: "submitted" | "reviewed";
  scan_status: "pending" | "clean" | "quarantined" | "rejected";
  file_name: string;
}

/**
 * Receipts and bills as the accountant sees them (#154): figures for every
 * receipt, the file only once it has been scanned clean. Admins with MFA see
 * the same list; row-level security decides for everyone else.
 */
export default async function LedgerReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead } = await getLedgerAccess();
  const params = await searchParams;
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="Receipts"
      description="Receipts and vendor bills behind the entries, with their taxes. Files open once they have passed the virus scan."
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
  let query = supabase
    .from("finance_receipt")
    .select("id, kind, document_date, vendor, total_cents, gst_cents, qst_cents, status, scan_status, file_name")
    .eq("organization_id", session.organizationId);
  if (year) query = query.gte("document_date", year.startsOn).lte("document_date", year.endsOn);
  const { data, error } = await query.order("document_date", { ascending: false }).limit(LIMIT);
  if (error) throw new Error(`Could not load receipts: ${error.message}`);
  const rows = (data ?? []) as ReceiptRow[];

  return (
    <div>
      {header}
      <LedgerTabs />
      {year ? (
        <div className="card mb-4 flex flex-wrap items-end justify-between gap-3 p-4">
          <YearPicker years={years} selected={year.startsOn} />
          <Link
            href={`/api/finance/ledger/export/receipts?from=${year.startsOn}&to=${year.endsOn}`}
            prefetch={false}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
          >
            <Download className="size-4" aria-hidden />
            Receipts CSV
          </Link>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={<Receipt />} title="No receipts in this period" description="Receipts submitted by staff appear here." />
      ) : (
        <>
          <DataTable minWidth="760px">
            <TableHead>
              <TableHeader className="w-28">Date</TableHeader>
              <TableHeader>Vendor</TableHeader>
              <TableHeader className="w-32 text-right">Total</TableHeader>
              <TableHeader className="w-28 text-right">GST</TableHeader>
              <TableHeader className="w-28 text-right">QST</TableHeader>
              <TableHeader className="w-28">Review</TableHeader>
              <TableHeader className="w-36">File</TableHeader>
            </TableHead>
            <tbody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.document_date}</TableCell>
                  <TableCell>
                    {r.vendor}
                    <span className="meta block">{r.kind === "bill" ? "Vendor bill" : "Receipt"}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(r.total_cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(r.gst_cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(r.qst_cents))}</TableCell>
                  <TableCell>
                    {r.status === "reviewed" ? <Badge tone="success">Reviewed</Badge> : <Badge>Submitted</Badge>}
                  </TableCell>
                  <TableCell>
                    {r.scan_status === "clean" ? (
                      <a
                        className="text-brand-fg hover:underline"
                        href={`/api/finance/ledger/receipts/${r.id}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open file
                      </a>
                    ) : (
                      <span className="text-[13px] text-muted">
                        {r.scan_status === "pending" ? "Being checked" : "Not available"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
          {rows.length === LIMIT ? (
            <p className="meta mt-3">Showing the latest {LIMIT}. The CSV lists every receipt of the year.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
