import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";
import {
  buildWorksheet,
  getTaxSettings,
  listTaxLines,
  TAX_EXPORT_LINE_LIMIT,
  taxTotals,
  worksheetCsv,
} from "@/features/sales-tax/services/sales-tax.queries";
import { getT } from "@/lib/i18n/server";

/** GST/QST return worksheet and its lines as CSV for the accountant (#152). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const t = await getT();
  const access = await authorizeLedgerExport();
  if (!access) return new Response(t("finance.salesTax.noLedgerAccess"), { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const to = dateParam(url.searchParams.get("to") ?? undefined, todayIn(session.timeZone));
  const from = dateParam(url.searchParams.get("from") ?? undefined, `${to.slice(0, 7)}-01`);
  try {
    const [rows, settings, { lines, truncated }] = await Promise.all([
      taxTotals(supabase, session.organizationId, from, to),
      getTaxSettings(supabase, session.organizationId),
      // Every line, a page at a time; above the ceiling the file is refused, never cut short.
      listTaxLines(supabase, session.organizationId, { from, to }, TAX_EXPORT_LINE_LIMIT),
    ]);
    if (truncated) {
      return new Response(t("finance.salesTax.errors.tooManyLines"), { status: 413 });
    }
    const worksheet = buildWorksheet(rows);
    return csvResponse(
      supabase,
      session,
      "sales_tax_worksheet_exported",
      worksheetCsv(from, to, worksheet, lines, settings?.show_psb_rebate ?? false, t),
      `gst-qst-worksheet-${from}-${to}.csv`,
      { from, to, lines: lines.length },
    );
  } catch {
    return new Response(t("finance.salesTax.errors.exportFailed"), { status: 500 });
  }
}
