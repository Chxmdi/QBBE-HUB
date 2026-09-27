import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";
import { loadFiscalYears, pickYear, yearStatements } from "@/features/ledger/services/year-end.queries";
import { operationsCsv, positionCsv } from "@/features/ledger/year-end";
import { getT } from "@/lib/i18n/server";

/** Financial statements as CSV for the accountant (#154). Row-level security decides what is summed. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeLedgerExport();
  const t = await getT();
  if (!access) return new Response(t("finance.ledgerReports.api.noAccess"), { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const statement = url.searchParams.get("statement") === "operations" ? "operations" : "position";
  const years = await loadFiscalYears(supabase, session.organizationId);
  const year = pickYear(years, dateParam(url.searchParams.get("year") ?? undefined, ""), todayIn(session.timeZone));
  if (!year) return new Response(t("finance.ledgerReports.api.noFiscalYear"), { status: 404 });
  const { current, prior, error } = await yearStatements(supabase, session.organizationId, year);
  if (error) return new Response(t("finance.ledgerReports.api.statementsFailed"), { status: 500 });
  return csvResponse(
    supabase,
    session,
    statement === "operations" ? "statement_of_operations_exported" : "statement_of_financial_position_exported",
    statement === "operations" ? operationsCsv(current, prior, t) : positionCsv(current, prior, t),
    `${statement === "operations" ? "statement-of-operations" : "statement-of-financial-position"}-${year.startsOn}-to-${year.endsOn}.csv`,
    { starts_on: year.startsOn, ends_on: year.endsOn, comparative: prior !== null },
  );
}
