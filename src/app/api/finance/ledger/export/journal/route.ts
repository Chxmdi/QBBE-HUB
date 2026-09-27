import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";
import { exportLines } from "@/features/ledger/services/year-end.queries";
import { journalImportCsv } from "@/features/ledger/year-end";

/**
 * Every posted line between two dates as a plain CSV the accountant's
 * software can import (#154): date, entry no, account code and name, fund,
 * program, description, debit, credit. Refused, never cut short, when too big.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeLedgerExport();
  if (!access) return new Response("You do not have access to the ledger.", { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const to = dateParam(url.searchParams.get("to") ?? undefined, todayIn(session.timeZone));
  const from = dateParam(url.searchParams.get("from") ?? undefined, `${to.slice(0, 4)}-01-01`);
  if (from > to) return new Response("The start date is after the end date.", { status: 400 });
  const { lines, error, tooMany } = await exportLines(supabase, session.organizationId, from, to);
  if (error) return new Response("Could not export the general ledger. Try again.", { status: 500 });
  if (tooMany) return new Response("Too many lines for one file. Export a shorter period.", { status: 413 });
  return csvResponse(
    supabase,
    session,
    "journal_import_exported",
    journalImportCsv(lines),
    `general-ledger-import-${from}-to-${to}.csv`,
    { from, to, rows: lines.length },
  );
}
