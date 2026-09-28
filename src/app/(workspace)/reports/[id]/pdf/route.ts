import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getReportSnapshot } from "@/features/reports/services/report.queries";
import { buildSimplePdf, type PdfSection } from "@/lib/simple-pdf";
import {
  codeLabel,
  formatStoredDate,
  snapshotSections,
} from "@/features/reports/snapshot-view";
import { getFormatters, getT } from "@/lib/i18n/server";

function list(
  title: string,
  rows: { primary: string; secondary?: string }[],
  emptyText: string,
): PdfSection {
  return {
    heading: title,
    lines:
      rows.length === 0
        ? [emptyText]
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
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  const { data: report } = await supabase
    .from("report_instance")
    .select("id, title, snapshot, created_at, organization_id")
    .eq("id", id)
    .maybeSingle();

  if (!report) {
    return NextResponse.json({ error: t("reports.errors.notFound") }, { status: 404 });
  }

  // Same rule as the screen and the CSV: the approved version wins.
  const chosen = await getReportSnapshot(id);
  const snapshot = (chosen?.snapshot ?? report.snapshot) as Record<string, unknown>;
  const metrics = (snapshot.metrics ?? {}) as Record<string, number>;
  const sections: PdfSection[] = [
    {
      heading: t("reports.sections.metrics"),
      lines: Object.entries(metrics).map(([k, v]) =>
        t("reports.pdfMetric", {
          label: codeLabel(t, "reports.metrics", k),
          value: typeof v === "number" ? format.number(v) : String(v),
        }),
      ),
    },
    ...snapshotSections(snapshot, {
      t,
      date: (value) => formatStoredDate(format, value),
    }).map((section) => list(section.title, section.rows, t("reports.noneInSnapshot"))),
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
