import { dateParam, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse, fundLabel } from "@/features/ledger/services/ledger.export";
import { trialBalance, trialBalanceCsv } from "@/features/ledger/services/ledger.reports";

/** Trial balance as CSV for the accountant (#148). Row-level security decides what is summed. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeLedgerExport();
  if (!access) return new Response("You do not have access to the ledger.", { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const asOf = dateParam(url.searchParams.get("as_of") ?? undefined, todayIn(session.timeZone));
  const fundId = uuidParam(url.searchParams.get("fund") ?? undefined);
  const { rows, error } = await trialBalance(supabase, session.organizationId, asOf, fundId);
  if (error) return new Response("Could not export the trial balance. Try again.", { status: 500 });
  const shown = rows.filter((r) => r.balance_cents !== 0);
  return csvResponse(
    supabase,
    session,
    "trial_balance_exported",
    trialBalanceCsv(shown, asOf, await fundLabel(supabase, fundId)),
    `trial-balance-${asOf}.csv`,
    { as_of: asOf, fund_id: fundId, rows: shown.length },
  );
}
