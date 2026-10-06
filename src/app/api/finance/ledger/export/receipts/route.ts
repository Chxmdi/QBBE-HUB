import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";
import { receiptsCsv, type ReceiptExportRow } from "@/features/ledger/year-end";
import { getT } from "@/lib/i18n/server";

/**
 * Receipts and bills dated between two dates, with whether each file can be
 * downloaded (#154). Row-level security decides which receipts are listed:
 * admins with MFA and the external accountant see them all.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 10000;

export async function GET(request: Request) {
  const access = await authorizeLedgerExport();
  const t = await getT();
  if (!access) return new Response(t("finance.ledgerReports.api.noAccess"), { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const to = dateParam(url.searchParams.get("to") ?? undefined, todayIn(session.timeZone));
  const from = dateParam(url.searchParams.get("from") ?? undefined, `${to.slice(0, 4)}-01-01`);
  const rows: ReceiptExportRow[] = [];
  for (let offset = 0; offset < LIMIT; offset += 1000) {
    const { data, error } = await supabase
      .from("finance_receipt")
      .select("document_date, kind, vendor, total_cents, gst_cents, qst_cents, status, scan_status, file_name")
      .eq("organization_id", session.organizationId)
      .gte("document_date", from)
      .lte("document_date", to)
      .order("document_date")
      .order("id")
      .range(offset, offset + 999);
    if (error) return new Response(t("finance.ledgerReports.api.receiptsFailed"), { status: 500 });
    const page = (data ?? []) as ReceiptExportRow[];
    rows.push(...page.map((r) => ({ ...r, total_cents: Number(r.total_cents), gst_cents: Number(r.gst_cents), qst_cents: Number(r.qst_cents) })));
    if (page.length < 1000) break;
  }
  if (rows.length >= LIMIT) return new Response(t("finance.ledgerReports.api.tooManyReceipts"), { status: 413 });
  return csvResponse(supabase, session, "receipts_list_exported", receiptsCsv(rows, t), `receipts-${from}-to-${to}.csv`, {
    from,
    to,
    rows: rows.length,
  });
}
