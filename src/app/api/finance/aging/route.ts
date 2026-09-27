import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { agingCsv, type AgingRow } from "@/features/payables/model";
import { getT } from "@/lib/i18n/server";

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
  const { data, error } = await supabase.rpc("finance_aging", {
    p_organization: session.organizationId,
    p_kind: kind,
    p_as_of: asOf,
  });
  if (error) return new Response(t("finance.payables.csv.exportFailed"), { status: 500 });
  const rows = (data ?? []) as AgingRow[];
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "finance",
    action: "aging_exported",
    object_type: "organization",
    object_id: session.organizationId,
    metadata: { kind, as_of: asOf, rows: rows.length },
  });
  return new Response(agingCsv(kind, asOf, rows, t), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind === "bill" ? "payables" : "receivables"}-aging-${asOf}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
