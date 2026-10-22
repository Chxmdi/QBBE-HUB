import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getReportSnapshot } from "@/features/reports/services/report.queries";
import { buildReportCsv } from "@/features/reports/report-csv";
import { getT } from "@/lib/i18n/server";
import { auditUnavailableResponse, recordAudit } from "@/lib/audit-write";

/**
 * CSV export of a report snapshot (P0-RPT-04). Access is enforced by RLS on
 * report_instance (staff-only); exported content comes from the frozen
 * snapshot, and the response includes a generation timestamp.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const t = await getT();

  const { data: report } = await supabase
    .from("report_instance")
    .select("id, title, report_type, snapshot, created_at, organization_id")
    .eq("id", id)
    .maybeSingle();

  if (!report) {
    return NextResponse.json({ error: t("reports.errors.notFound") }, { status: 404 });
  }

  // The approved version if there is one, so an export cannot quietly differ
  // from what was signed off. Falls back to the report's own snapshot for
  // anything generated before versioning existed.
  const chosen = await getReportSnapshot(id);
  const snapshot = (chosen?.snapshot ?? report.snapshot) as Record<string, unknown>;
  // Formula-looking text is neutralised inside the builder (SEC-028).
  const csv = buildReportCsv({
    title: report.title as string,
    version: chosen?.version ?? 1,
    generatedAt: String(report.created_at),
    snapshot,
    t,
  });

  // Audit the export (SEC-005).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const audited = await recordAudit(supabase, {
    organization_id: report.organization_id,
    actor_id: user?.id ?? null,
    event_type: "reporting",
    action: "report_exported_csv",
    object_type: "report_instance",
    object_id: report.id,
  });
  // No file without a record of who took it.
  if (!audited) return auditUnavailableResponse();

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="qbbe-report-${report.id}.csv"`,
    },
  });
}
