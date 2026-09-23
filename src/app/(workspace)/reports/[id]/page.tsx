import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { ReportDecisionControls } from "@/features/reports/components/report-decision-controls";
import { VersionHistory } from "@/features/reports/components/version-history";
import {
  getReportVersions,
  versionToShow,
} from "@/features/reports/services/report.queries";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/utils";
import { snapshotSections } from "@/features/reports/snapshot-view";

export const metadata: Metadata = { title: "Report" };
export const dynamic = "force-dynamic";

type Snapshot = Record<string, unknown>;

function MetricGrid({ metrics }: { metrics: Record<string, number> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Object.entries(metrics).map(([key, value]) => (
        <div key={key} className="card p-3.5">
          <p className="text-[24px] leading-none font-semibold">{value}</p>
          <p className="mt-1 text-[12px] text-muted capitalize">
            {key.replace(/_/g, " ")}
          </p>
        </div>
      ))}
    </div>
  );
}

function SnapshotList({
  title,
  rows,
}: {
  title: string;
  rows: { primary: string; secondary?: string }[];
}) {
  return (
    <section className="mt-6">
      <h2 className="section-heading mb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="card px-4 py-3 text-[13px] text-muted">None in this snapshot.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map((row, i) => (
            <li key={i} className="px-4 py-2.5">
              <p className="text-[13.5px] font-medium">{row.primary}</p>
              {row.secondary ? <p className="meta">{row.secondary}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: reportRow } = await supabase
    .from("report_instance")
    .select(
      "id, report_type, title, period_start, period_end, snapshot, status, created_at, approved_at, " +
        "generator:generated_by(full_name), approver:approved_by(full_name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!reportRow) notFound();

  // The approved version if there is one, otherwise the latest. Without this,
  // regenerating a report would silently change what a funder was sent.
  const versions = await getReportVersions(id);
  const shown = versionToShow(versions);
  const report = reportRow as unknown as {
    id: string;
    title: string;
    period_start: string | null;
    period_end: string | null;
    snapshot: Snapshot;
    status: string;
    created_at: string;
    generator: { full_name: string } | null;
    approver: { full_name: string } | null;
  };
  // report_instance.snapshot mirrors the latest version and is the fallback
  // for any report generated before versioning existed.
  const snapshot = (shown?.snapshot ?? report.snapshot) as Snapshot;
  const metrics = (snapshot.metrics ?? {}) as Record<string, number>;
  const generator = report.generator;
  const approver = report.approver;

  const sections = snapshotSections(snapshot);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-2">
        <Link href="/reports" className="meta hover:text-brand-fg hover:underline">
          ← Reports
        </Link>
      </div>
      <PageHeader
        eyebrow={`${formatDate(report.period_start)} → ${formatDate(report.period_end)}`}
        title={report.title as string}
        description={`Generated ${formatDateTime(report.created_at)} by ${generator?.full_name ?? "unknown"} from a permission-filtered snapshot.`}
        actions={
          <div className="no-print flex items-center gap-2">
            <Badge
              tone={report.status === "approved" ? "success" : "neutral"}
            >
              {(report.status as string).replace(/_/g, " ")}
              {approver ? ` by ${approver.full_name}` : ""}
            </Badge>
            <a
              href={`/reports/${report.id}/csv`}
              className="inline-flex h-9 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-soft"
            >
              <Download className="size-4" aria-hidden />
              CSV
            </a>
            <a
              href={`/reports/${report.id}/pdf`}
              className="inline-flex h-9 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-soft"
            >
              <Download className="size-4" aria-hidden />
              PDF
            </a>
            <PrintHint />
            <ReportDecisionControls
              reportId={report.id as string}
              canDecide={session.isAdmin}
              isApproved={report.status === "approved"}
            />
          </div>
        }
      />

      {Object.keys(metrics).length > 0 ? <MetricGrid metrics={metrics} /> : null}

      {sections.map((section) => (
        <SnapshotList key={section.title} title={section.title} rows={section.rows} />
      ))}

      <VersionHistory
        versions={versions}
        shownVersion={shown?.version_number ?? null}
      />

      <p className="meta mt-8">
        Each version is frozen at the moment it was generated (RPT-001), and an
        approved report shows the version that was approved. Regenerating adds
        a version rather than replacing one, so a sign-off always names the
        figures it was given.
      </p>
    </div>
  );
}

function PrintHint() {
  return (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-3 text-[13px] font-medium text-muted">
      <Printer className="size-4" aria-hidden />
      Print / Save as PDF via browser
    </span>
  );
}
