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
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledgerReports.receipts.metaTitle") };
}
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
  const t = await getT();
  const locale = await getLocale();
  const header = (
    <PageHeader
      eyebrow={t("finance.ledgerReports.eyebrow")}
      title={t("finance.ledgerReports.receipts.title")}
      description={t("finance.ledgerReports.receipts.description")}
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
            {t("finance.ledgerReports.receipts.csv")}
          </Link>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title={t("finance.ledgerReports.receipts.emptyTitle")}
          description={t("finance.ledgerReports.receipts.emptyDescription")}
        />
      ) : (
        <>
          <DataTable minWidth="760px">
            <TableHead>
              <TableHeader className="w-28">{t("finance.common.date")}</TableHeader>
              <TableHeader>{t("finance.common.vendor")}</TableHeader>
              <TableHeader className="w-32 text-right">{t("finance.common.total")}</TableHeader>
              <TableHeader className="w-28 text-right">{t("finance.common.gst")}</TableHeader>
              <TableHeader className="w-28 text-right">{t("finance.common.qst")}</TableHeader>
              <TableHeader className="w-28">{t("finance.ledgerReports.receipts.review")}</TableHeader>
              <TableHeader className="w-36">{t("finance.ledgerReports.receipts.file")}</TableHeader>
            </TableHead>
            <tbody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.document_date}</TableCell>
                  <TableCell>
                    {r.vendor}
                    <span className="meta block">{t(r.kind === "bill" ? "finance.ledgerReports.receipts.vendorBill" : "finance.ledgerReports.receipts.receipt")}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(r.total_cents), locale)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(r.gst_cents), locale)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(r.qst_cents), locale)}</TableCell>
                  <TableCell>
                    {r.status === "reviewed" ? (
                      <Badge tone="success">{t("finance.ledgerReports.receipts.reviewed")}</Badge>
                    ) : (
                      <Badge>{t("finance.ledgerReports.receipts.submitted")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.scan_status === "clean" ? (
                      <a
                        className="text-brand-fg hover:underline"
                        href={`/api/finance/ledger/receipts/${r.id}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("finance.ledgerReports.receipts.openFile")}
                      </a>
                    ) : (
                      <span className="text-[13px] text-muted">
                        {t(r.scan_status === "pending" ? "finance.ledgerReports.receipts.beingChecked" : "finance.ledgerReports.receipts.notAvailable")}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
          {rows.length === LIMIT ? (
            <p className="meta mt-3">{t("finance.ledgerReports.receipts.limitNote", { count: LIMIT })}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
