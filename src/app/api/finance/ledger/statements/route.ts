import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";
import { loadFiscalYears, pickYear, yearFundChanges, yearStatements } from "@/features/ledger/services/year-end.queries";
import { fundChangesCsv } from "@/features/ledger/fund-changes";
import { operationsCsv, positionCsv } from "@/features/ledger/year-end";

/**
 * Financial statements as CSV for the accountant (#154), and the statement of
 * changes in fund balances (#149). Row-level security decides what is summed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATEMENTS = ["position", "operations", "fund-changes"] as const;
type Statement = (typeof STATEMENTS)[number];

export async function GET(request: Request) {
  const access = await authorizeLedgerExport();
  if (!access) return new Response("You do not have access to the ledger.", { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const requested = url.searchParams.get("statement");
  const statement: Statement = STATEMENTS.includes(requested as Statement) ? (requested as Statement) : "position";
  const years = await loadFiscalYears(supabase, session.organizationId);
  const year = pickYear(years, dateParam(url.searchParams.get("year") ?? undefined, ""), todayIn(session.timeZone));
  if (!year) return new Response("There is no fiscal year yet.", { status: 404 });

  if (statement === "fund-changes") {
    const { changes, error } = await yearFundChanges(supabase, session.organizationId, year);
    if (error) return new Response("Could not export the statement. Try again.", { status: 500 });
    return csvResponse(
      supabase,
      session,
      "statement_of_changes_in_fund_balances_exported",
      fundChangesCsv(changes),
      `statement-of-changes-in-fund-balances-${year.startsOn}-to-${year.endsOn}.csv`,
      { starts_on: year.startsOn, ends_on: year.endsOn },
    );
  }

  const { current, prior, error } = await yearStatements(supabase, session.organizationId, year);
  if (error) return new Response("Could not export the statements. Try again.", { status: 500 });
  return csvResponse(
    supabase,
    session,
    statement === "operations" ? "statement_of_operations_exported" : "statement_of_financial_position_exported",
    statement === "operations" ? operationsCsv(current, prior) : positionCsv(current, prior),
    `${statement === "operations" ? "statement-of-operations" : "statement-of-financial-position"}-${year.startsOn}-to-${year.endsOn}.csv`,
    { starts_on: year.startsOn, ends_on: year.endsOn, comparative: prior !== null },
  );
}
