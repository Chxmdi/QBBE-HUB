import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
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
import { createSupabasePageClient } from "@/lib/supabase/page";
import {
  codeLabel,
  formatStoredDate,
  snapshotSections,
} from "@/features/reports/snapshot-view";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("reports.detailTitle") };
}
export const dynamic = "force-dynamic";

type Snapshot = Record<string, unknown>;

function MetricGrid({
  metrics,
  t,
  formatNumber,
}: {
  metrics: Record<string, number>;
  t: TranslateFn;
  formatNumber: (value: number) => string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Object.entries(metrics).map(([key, value]) => (
        <div key={key} className="card p-3.5">
          <p className="text-[24px] leading-none font-semibold">
            {typeof value === "number" ? formatNumber(value) : value}
          </p>
          <p className="mt-1 text-[12px] text-muted capitalize">
            {codeLabel(t, "reports.metrics", key)}
          </p>
        </div>
      ))}
    </div>
  );
}

function SnapshotList({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: { primary: string; secondary?: string }[];
  emptyText: string;
}) {
  return (
    <section className="mt-6">
      <h2 className="section-heading mb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="card px-4 py-3 text-[13px] text-muted">{emptyText}</p>
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
  const supabase = await createSupabasePageClient();
  const [t, format] = await Promise.all([getT(), getFormatters()]);

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

  const sections = snapshotSections(snapshot, {
    t,
    date: (value) => formatStoredDate(format, value),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print ">
        <Breadcrumbs
          items={[
            { label: t("reports.title"), href: "/reports" },
            { label: report.title as string },
          ]}
        />
      </div>
      <PageHeader
        eyebrow={t("reports.period", {
          start: formatStoredDate(format, report.period_start),
          end: formatStoredDate(format, report.period_end),
        })}
        title={report.title as string}
        description={t("reports.generatedBy", {
          when: format.dateTime(report.created_at),
          name: generator?.full_name ?? t("reports.unknownPerson"),
        })}
        actions={
          <div className="no-print flex items-center gap-2">
            <Badge
              tone={report.status === "approved" ? "success" : "neutral"}
            >
              {approver
                ? t("reports.approvedBy", {
                    status: codeLabel(t, "reports.status", report.status),
                    name: approver.full_name,
                  })
                : codeLabel(t, "reports.status", report.status)}
            </Badge>
            <a
              href={`/reports/${report.id}/csv`}
              className="inline-flex h-9 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-soft"
            >
              <Download className="size-4" aria-hidden />
              {t("reports.csv")}
            </a>
            <a
              href={`/reports/${report.id}/pdf`}
              className="inline-flex h-9 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-soft"
            >
              <Download className="size-4" aria-hidden />
              {t("reports.pdf")}
            </a>
            <PrintHint label={t("reports.printHint")} />
            <ReportDecisionControls
              reportId={report.id as string}
              canDecide={session.isAdmin}
              isApproved={report.status === "approved"}
            />
          </div>
        }
      />

      {Object.keys(metrics).length > 0 ? (
        <MetricGrid metrics={metrics} t={t} formatNumber={(value) => format.number(value)} />
      ) : null}

      {sections.map((section) => (
        <SnapshotList
          key={section.title}
          title={section.title}
          rows={section.rows}
          emptyText={t("reports.noneInSnapshot")}
        />
      ))}

      <VersionHistory
        versions={versions}
        shownVersion={shown?.version_number ?? null}
      />

      <p className="meta mt-8">{t("reports.footnote")}</p>
    </div>
  );
}

function PrintHint({ label }: { label: string }) {
  return (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-3 text-[13px] font-medium text-muted">
      <Printer className="size-4" aria-hidden />
      {label}
    </span>
  );
}
