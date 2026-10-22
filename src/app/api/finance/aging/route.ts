import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { agingCsv } from "@/features/payables/model";
import { AGING_LIMIT, readAging } from "@/features/payables/services/aging.queries";
import { getT } from "@/lib/i18n/server";
import { auditUnavailableResponse, recordAudit } from "@/lib/audit-write";

/** Accounts payable or receivable aging as CSV (#150). Row-level security decides what is included. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireStaff();
  const t = await getT();
  const supabase = await createSupabaseServerClient();
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "invoice" ? "invoice" : "bill";
  const asOf = dateParam(url.searchParams.get("as_of") ?? undefined, todayIn(session.timeZone));
  // Every open document, a page at a time; above the ceiling the file is refused, never cut short.
  const { rows, error, truncated } = await readAging(supabase, session.organizationId, kind, asOf);
  if (error) return new Response(t("finance.payables.csv.exportFailed"), { status: 500 });
  if (truncated) return new Response(t("finance.payables.csv.tooMany", { max: AGING_LIMIT }), { status: 413 });
  const audited = await recordAudit(supabase, {
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "finance",
    action: "aging_exported",
    object_type: "organization",
    object_id: session.organizationId,
    metadata: { kind, as_of: asOf, rows: rows.length },
  });
  // No file without a record of who took it.
  if (!audited) return auditUnavailableResponse();
  return new Response(agingCsv(kind, asOf, rows, t), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind === "bill" ? "payables" : "receivables"}-aging-${asOf}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
