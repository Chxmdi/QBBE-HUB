import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";
import { trialBalance } from "@/features/ledger/services/ledger.reports";
import { trialBalanceImportCsv } from "@/features/ledger/year-end";
import { getT } from "@/lib/i18n/server";

/** The trial balance as importable rows, no titles or totals (#154). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeLedgerExport();
  const t = await getT();
  if (!access) return new Response(t("finance.ledgerReports.api.noAccess"), { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const asOf = dateParam(url.searchParams.get("as_of") ?? undefined, todayIn(session.timeZone));
  const { rows, error } = await trialBalance(supabase, session.organizationId, asOf, null);
  if (error) return new Response(t("finance.ledgerReports.api.trialBalanceFailed"), { status: 500 });
  return csvResponse(
    supabase,
    session,
    "trial_balance_import_exported",
    trialBalanceImportCsv(rows),
    `trial-balance-import-${asOf}.csv`,
    { as_of: asOf, rows: rows.length },
  );
}
