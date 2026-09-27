import { dateParam, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";
import { trialBalance, trialBalanceCsv } from "@/features/ledger/services/ledger.reports";
import { getT } from "@/lib/i18n/server";

/** Trial balance as CSV for the accountant (#148). Row-level security decides what is summed. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The fund named in the file's title row, in the reader's language. */
async function fundTitle(
  supabase: NonNullable<Awaited<ReturnType<typeof authorizeLedgerExport>>>["supabase"],
  fundId: string | null,
  t: Awaited<ReturnType<typeof getT>>,
): Promise<string> {
  if (!fundId) return t("finance.ledgerReports.allFunds");
  const { data } = await supabase.from("ledger_fund").select("code, name").eq("id", fundId).maybeSingle();
  return data ? t("finance.ledgerReports.fundLabel", { code: data.code, name: data.name }) : t("finance.ledgerReports.unknownFund");
}

export async function GET(request: Request) {
  const access = await authorizeLedgerExport();
  const t = await getT();
  if (!access) return new Response(t("finance.ledgerReports.api.noAccess"), { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const asOf = dateParam(url.searchParams.get("as_of") ?? undefined, todayIn(session.timeZone));
  const fundId = uuidParam(url.searchParams.get("fund") ?? undefined);
  const { rows, error } = await trialBalance(supabase, session.organizationId, asOf, fundId);
  if (error) return new Response(t("finance.ledgerReports.api.trialBalanceFailed"), { status: 500 });
  const shown = rows.filter((r) => r.balance_cents !== 0);
  return csvResponse(
    supabase,
    session,
    "trial_balance_exported",
    trialBalanceCsv(shown, asOf, await fundTitle(supabase, fundId, t), t),
    `trial-balance-${asOf}.csv`,
    { as_of: asOf, fund_id: fundId, rows: shown.length },
  );
}
