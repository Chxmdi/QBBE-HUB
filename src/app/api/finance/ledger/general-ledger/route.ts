import { dateParam, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";
import { generalLedger, generalLedgerCsv } from "@/features/ledger/services/ledger.reports";
import { getT } from "@/lib/i18n/server";

/** General ledger as CSV for the accountant (#148). Row-level security decides what is included. */

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
  const to = dateParam(url.searchParams.get("to") ?? undefined, todayIn(session.timeZone));
  const from = dateParam(url.searchParams.get("from") ?? undefined, `${to.slice(0, 7)}-01`);
  const accountId = uuidParam(url.searchParams.get("account") ?? undefined);
  const fundId = uuidParam(url.searchParams.get("fund") ?? undefined);
  const { rows, error, truncated } = await generalLedger(supabase, session.organizationId, from, to, accountId, fundId);
  if (error) return new Response(t("finance.ledgerReports.api.generalLedgerFailed"), { status: 500 });
  if (truncated) {
    return new Response(t("finance.ledgerReports.api.tooManyLines"), { status: 413 });
  }
  return csvResponse(
    supabase,
    session,
    "general_ledger_exported",
    generalLedgerCsv(rows, from, to, await fundTitle(supabase, fundId, t), t),
    `general-ledger-${from}-to-${to}.csv`,
    { from, to, account_id: accountId, fund_id: fundId, rows: rows.length },
  );
}
