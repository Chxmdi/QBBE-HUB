import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { JobHealthPanel } from "@/features/jobs/components/job-health-panel";
import { getJobHealth } from "@/features/jobs/services/jobs.queries";
import { requireAdminAal2 } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.jobs.title") };
}
export const dynamic = "force-dynamic";

/** Admin → Jobs: the health of the background runtime (JOB-004, §14.2). */
export default async function AdminJobsPage() {
  await requireAdminAal2();
  const t = await getT();
  const health = await getJobHealth();

  return (
    <div>
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("admin.jobs.title")}
        description={t("admin.jobs.description")}
      />
      <AdminNav />
      <JobHealthPanel {...health} />
    </div>
  );
}
