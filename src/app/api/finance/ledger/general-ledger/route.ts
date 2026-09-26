import { dateParam, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse, fundLabel } from "@/features/ledger/services/ledger.export";
import { generalLedger, generalLedgerCsv } from "@/features/ledger/services/ledger.reports";

/** General ledger as CSV for the accountant (#148). Row-level security decides what is included. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeLedgerExport();
  if (!access) return new Response("You do not have access to the ledger.", { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const to = dateParam(url.searchParams.get("to") ?? undefined, todayIn(session.timeZone));
  const from = dateParam(url.searchParams.get("from") ?? undefined, `${to.slice(0, 7)}-01`);
  const accountId = uuidParam(url.searchParams.get("account") ?? undefined);
  const fundId = uuidParam(url.searchParams.get("fund") ?? undefined);
  const { rows, error, truncated } = await generalLedger(supabase, session.organizationId, from, to, accountId, fundId);
  if (error) return new Response("Could not export the general ledger. Try again.", { status: 500 });
  if (truncated) {
    return new Response("Too many lines for one file. Narrow the dates or choose an account.", { status: 413 });
  }
  return csvResponse(
    supabase,
    session,
    "general_ledger_exported",
    generalLedgerCsv(rows, from, to, await fundLabel(supabase, fundId)),
    `general-ledger-${from}-to-${to}.csv`,
    { from, to, account_id: accountId, fund_id: fundId, rows: rows.length },
  );
}
