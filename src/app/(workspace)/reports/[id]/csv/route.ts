import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getReportSnapshot } from "@/features/reports/services/report.queries";

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

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

  const { data: report } = await supabase
    .from("report_instance")
    .select("id, title, report_type, snapshot, created_at, organization_id")
    .eq("id", id)
    .maybeSingle();

  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The approved version if there is one, so an export cannot quietly differ
  // from what was signed off. Falls back to the report's own snapshot for
  // anything generated before versioning existed.
  const chosen = await getReportSnapshot(id);
  const snapshot = (chosen?.snapshot ?? report.snapshot) as Record<string, unknown>;
  const rows: string[] = [];
  rows.push(`# ${report.title}`);
  rows.push(
    `# Exported from version ${chosen?.version ?? 1}, generated ${report.created_at}`,
  );
  rows.push("");

  const metrics = (snapshot.metrics ?? {}) as Record<string, number>;
  rows.push("section,key,value,extra");
  for (const [key, value] of Object.entries(metrics)) {
    rows.push(["metric", csvEscape(key), csvEscape(value), ""].join(","));
  }

  const tasks = (snapshot.tasks ?? snapshot.delivered_work ?? []) as Record<string, unknown>[];
  for (const task of tasks) {
    rows.push(
      [
        "task",
        csvEscape(task.title),
        csvEscape(task.status ?? "completed"),
        csvEscape(task.due_at ?? task.completed_at ?? ""),
      ].join(","),
    );
  }

  const decisions = (snapshot.decisions ?? []) as Record<string, unknown>[];
  for (const decision of decisions) {
    rows.push(
      ["decision", csvEscape(decision.title), "", csvEscape(decision.decided_at ?? "")].join(","),
    );
  }

  // Audit the export (SEC-005).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("audit_event").insert({
    organization_id: report.organization_id,
    actor_id: user?.id ?? null,
    event_type: "reporting",
    action: "report_exported_csv",
    object_type: "report_instance",
    object_id: report.id,
  });

  return new NextResponse(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="qbbe-report-${report.id}.csv"`,
    },
  });
}
