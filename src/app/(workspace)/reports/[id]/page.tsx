import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="section-heading mb-2">{title}</h2>
      <ul className="card divide-y divide-line">
        {rows.map((row, i) => (
          <li key={i} className="px-4 py-2.5">
            <p className="text-[13.5px] font-medium">{row.primary}</p>
            {row.secondary ? <p className="meta">{row.secondary}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (!session.isStaff) redirect("/");
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

  const deliveredWork = ((snapshot.delivered_work ?? []) as {
    title: string;
    completed_at: string;
  }[]).map((w) => ({
    primary: w.title,
    secondary: `Completed ${formatDate(w.completed_at)}`,
  }));
  const decisions = ((snapshot.decisions ?? []) as {
    title: string;
    decided_at: string;
  }[]).map((d) => ({
    primary: d.title,
    secondary: `Decided ${formatDate(d.decided_at)}`,
  }));
  const meetings = ((snapshot.meetings ?? []) as {
    title: string;
    starts_at: string;
  }[]).map((m) => ({
    primary: m.title,
    secondary: formatDateTime(m.starts_at),
  }));
  const events = ((snapshot.events ?? []) as { name: string; starts_at: string }[]).map(
    (e) => ({ primary: e.name, secondary: formatDateTime(e.starts_at) }),
  );
  const milestones = ((snapshot.milestones ?? []) as {
    name: string;
    due_date: string | null;
    completed_at: string | null;
  }[]).map((m) => ({
    primary: m.name,
    secondary: `${m.completed_at ? "Completed" : "Open"} · due ${formatDate(m.due_date)}`,
  }));
  const blockers = ((snapshot.blockers ?? []) as {
    title: string;
    reason: string | null;
  }[]).map((b) => ({ primary: b.title, secondary: b.reason ?? undefined }));
  const statusUpdates = ((snapshot.status_updates ?? []) as {
    progress_summary: string;
    health: string;
    created_at: string;
  }[]).map((u) => ({
    primary: u.progress_summary,
    secondary: `${u.health.replace(/_/g, " ")} · ${formatDate(u.created_at)}`,
  }));

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

      <SnapshotList title="Delivered work" rows={deliveredWork} />
      <SnapshotList title="Milestones" rows={milestones} />
      <SnapshotList title="Blockers" rows={blockers} />
      <SnapshotList title="Status updates" rows={statusUpdates} />
      <SnapshotList title="Meetings" rows={meetings} />
      <SnapshotList title="Decisions" rows={decisions} />
      <SnapshotList title="Events" rows={events} />

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
