import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { JobHealthPanel } from "@/features/jobs/components/job-health-panel";
import { getJobHealth } from "@/features/jobs/services/jobs.queries";
import { getJobRunnerStatus } from "@/features/jobs/services/runner-status";
import { requireAdminAal2 } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.jobs.title") };
}
export const dynamic = "force-dynamic";

/** Admin → Jobs: the health of the background runtime (JOB-004, §14.2). */
export default async function AdminJobsPage() {
  await requireAdminAal2();
  const [t, health, runner] = await Promise.all([getT(), getJobHealth(), getJobRunnerStatus()]);

  return (
    <div>
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("admin.jobs.title")}
        description={t("admin.jobs.description")}
      />
      <AdminNav />
      {runner !== "ready" ? (
        <div
          role="alert"
          className="mb-5 rounded-(--radius-md) border border-danger/40 bg-danger/10 px-4 py-3"
        >
          <p className="text-[13.5px] font-semibold">{t("jobs.runner.title")}</p>
          <p className="meta">{t(`jobs.runner.fix.${runner}`)}</p>
        </div>
      ) : null}
      <JobHealthPanel {...health} />
    </div>
  );
}
