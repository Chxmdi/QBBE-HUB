import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";
import {
  buildWorksheet,
  getTaxSettings,
  listTaxLines,
  taxTotals,
  worksheetCsv,
} from "@/features/sales-tax/services/sales-tax.queries";

/** GST/QST return worksheet and its lines as CSV for the accountant (#152). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeLedgerExport();
  if (!access) return new Response("You do not have access to the ledger.", { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const to = dateParam(url.searchParams.get("to") ?? undefined, todayIn(session.timeZone));
  const from = dateParam(url.searchParams.get("from") ?? undefined, `${to.slice(0, 7)}-01`);
  try {
    const [rows, settings, { lines, truncated }] = await Promise.all([
      taxTotals(supabase, session.organizationId, from, to),
      getTaxSettings(supabase, session.organizationId),
      listTaxLines(supabase, session.organizationId, { from, to }),
    ]);
    if (truncated) {
      return new Response("Too many lines for one file. Export a shorter range.", { status: 413 });
    }
    const worksheet = buildWorksheet(rows);
    return csvResponse(
      supabase,
      session,
      "sales_tax_worksheet_exported",
      worksheetCsv(from, to, worksheet, lines, settings?.show_psb_rebate ?? false),
      `gst-qst-worksheet-${from}-${to}.csv`,
      { from, to, lines: lines.length },
    );
  } catch {
    return new Response("Could not export the worksheet. Try again.", { status: 500 });
  }
}
