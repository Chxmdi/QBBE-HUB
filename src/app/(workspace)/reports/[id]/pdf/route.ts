import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getReportSnapshot } from "@/features/reports/services/report.queries";
import { buildSimplePdf, type PdfSection } from "@/lib/simple-pdf";

function list(
  title: string,
  rows: { primary: string; secondary?: string }[],
): PdfSection {
  return {
    heading: title,
    lines:
      rows.length === 0
        ? ["None in this snapshot."]
        : rows.map((r) => (r.secondary ? `${r.primary} — ${r.secondary}` : r.primary)),
  };
}

/**
 * PDF export of a frozen report snapshot (P0-RPT-04). Access is RLS
 * (staff-only on report_instance). Content is taken from the stored
 * snapshot, never recomputed from live rows.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: report } = await supabase
    .from("report_instance")
    .select("id, title, snapshot, created_at, organization_id")
    .eq("id", id)
    .maybeSingle();

  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Same rule as the screen and the CSV: the approved version wins.
  const chosen = await getReportSnapshot(id);
  const snapshot = (chosen?.snapshot ?? report.snapshot) as Record<string, unknown>;
  const metrics = (snapshot.metrics ?? {}) as Record<string, number>;
  const sections: PdfSection[] = [
    {
      heading: "Metrics",
      lines: Object.entries(metrics).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`),
    },
    list(
      "Delivered work",
      ((snapshot.delivered_work ?? snapshot.tasks ?? []) as { title?: string; completed_at?: string }[]).map(
        (w) => ({ primary: String(w.title ?? ""), secondary: w.completed_at }),
      ),
    ),
    list(
      "Milestones",
      ((snapshot.milestones ?? []) as { name?: string; due_date?: string }[]).map((m) => ({
        primary: String(m.name ?? ""),
        secondary: m.due_date,
      })),
    ),
    list(
      "Blockers",
      ((snapshot.blockers ?? []) as { title?: string; reason?: string }[]).map((b) => ({
        primary: String(b.title ?? ""),
        secondary: b.reason,
      })),
    ),
  ];

  const bytes = buildSimplePdf(
    String(report.title),
    String(report.created_at),
    sections,
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("audit_event").insert({
    organization_id: report.organization_id,
    actor_id: user?.id ?? null,
    event_type: "reporting",
    action: "report_exported_pdf",
    object_type: "report_instance",
    object_id: report.id,
  });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="qbbe-report-${report.id}.pdf"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
