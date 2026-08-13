import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { generateReport } from "@/features/reports/services/report.commands";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, relativeTime } from "@/lib/utils";
import type { ReportInstance } from "@/types/entities";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await requireSession();
  if (!session.isStaff) redirect("/");
  const supabase = await createSupabaseServerClient();

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
        eyebrow="Reporting & evaluation"
        title="Reports"
        description="Reports are generated from versioned snapshots of live records — approved versions stay reproducible."
        actions={
          <EntityFormDialog
            triggerLabel="Generate report"
            title="Generate report"
            submitLabel="Generate"
            action={generateReport}
            fields={[
              {
                name: "reportType",
                label: "Type",
                type: "select",
                required: true,
                defaultValue: "program_quarterly",
                options: [
                  { value: "program_quarterly", label: "Program quarterly report" },
                  { value: "project", label: "Project report" },
                ],
              },
              {
                name: "programId",
                label: "Program (for quarterly)",
                type: "select",
                colSpan: 1,
                options: (programs ?? []).map((p) => ({ value: p.id, label: p.name })),
              },
              {
                name: "projectId",
                label: "Project (for project report)",
                type: "select",
                colSpan: 1,
                options: (projects ?? []).map((p) => ({ value: p.id, label: p.name })),
              },
              { name: "periodStart", label: "Period start", type: "date", required: true, colSpan: 1 },
              { name: "periodEnd", label: "Period end", type: "date", required: true, colSpan: 1 },
            ]}
          />
        }
      />

      {reportList.length === 0 ? (
        <EmptyState
          icon={<BarChart3 />}
          title="No reports generated yet"
          description="Generate a quarterly program report or project report from live operational data."
        />
      ) : (
        <ul className="card divide-y divide-line">
          {reportList.map((report) => (
            <li key={report.id} className="interactive-row flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <Link
                  href={`/reports/${report.id}`}
                  className="text-[14px] font-medium hover:text-brand"
                >
                  {report.title}
                </Link>
                <p className="meta">
                  {formatDate(report.period_start)} → {formatDate(report.period_end)} ·
                  generated {relativeTime(report.created_at)}
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
                {report.status.replace(/_/g, " ")}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
