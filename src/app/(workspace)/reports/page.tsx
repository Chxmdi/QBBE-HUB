import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { generateReport } from "@/features/reports/services/report.commands";
import { requireSession, NO_ACCESS_REDIRECT } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { codeLabel, formatStoredDate } from "@/features/reports/snapshot-view";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { ReportInstance } from "@/types/entities";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("reports.title") };
}
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await requireSession();
  // Reports are staff-only, the same as Relationships. The navigation already
  // treats them that way — config/navigation.ts marks this entry `staff` — but
  // hiding a link is not a boundary. Anyone who typed the address reached the
  // page and was offered Generate report on it.
  if (!session.isStaff) redirect(NO_ACCESS_REDIRECT);
  const supabase = await createSupabasePageClient();
  const [t, format] = await Promise.all([getT(), getFormatters()]);

  const [{ data: reports }, { data: programs }, { data: projects }] =
    await Promise.all([
      supabase
        .from("report_instance")
        .select(
          "id, report_type, title, program_id, project_id, period_start, period_end, status, generated_by, created_at, snapshot",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("program").select("id, name").order("name"),
      supabase
        .from("project")
        .select("id, name")
        .is("archived_at", null)
        .order("name"),
    ]);

  const reportList = (reports ?? []) as unknown as ReportInstance[];

  return (
    <div>
      <PageHeader
        eyebrow={t("reports.eyebrow")}
        title={t("reports.title")}
        description={t("reports.description")}
        actions={
          <EntityFormDialog
            triggerLabel={t("reports.generate.trigger")}
            title={t("reports.generate.title")}
            submitLabel={t("reports.generate.submit")}
            action={generateReport}
            fields={[
              {
                name: "reportType",
                label: t("reports.generate.type"),
                type: "select",
                required: true,
                defaultValue: "program_quarterly",
                options: [
                  { value: "program_quarterly", label: t("reports.generate.typeProgram") },
                  { value: "project", label: t("reports.generate.typeProject") },
                ],
              },
              {
                name: "programId",
                label: t("reports.generate.program"),
                type: "select",
                colSpan: 1,
                options: (programs ?? []).map((p) => ({ value: p.id, label: p.name })),
              },
              {
                name: "projectId",
                label: t("reports.generate.project"),
                type: "select",
                colSpan: 1,
                options: (projects ?? []).map((p) => ({ value: p.id, label: p.name })),
              },
              { name: "periodStart", label: t("reports.generate.periodStart"), type: "date", required: true, colSpan: 1 },
              { name: "periodEnd", label: t("reports.generate.periodEnd"), type: "date", required: true, colSpan: 1 },
            ]}
          />
        }
      />

      {reportList.length === 0 ? (
        <EmptyState
          icon={<BarChart3 />}
          title={t("reports.emptyTitle")}
          description={t("reports.emptyDescription")}
        />
      ) : (
        <ul className="card divide-y divide-line">
          {reportList.map((report) => (
            <li key={report.id} className="interactive-row flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <Link
                  href={`/reports/${report.id}`}
                  className="text-[14px] font-medium hover:text-brand-fg"
                >
                  {report.title}
                </Link>
                <p className="meta">
                  {t("reports.listMeta", {
                    start: formatStoredDate(format, report.period_start),
                    end: formatStoredDate(format, report.period_end),
                    when: format.relative(report.created_at),
                  })}
                </p>
              </div>
              <Badge
                tone={
                  report.status === "approved"
                    ? "success"
                    : report.status === "in_review"
                      ? "warning"
                      : "neutral"
                }
              >
                {codeLabel(t, "reports.status", report.status)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
