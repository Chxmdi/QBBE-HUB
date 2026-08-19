import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { JobHealthPanel } from "@/features/jobs/components/job-health-panel";
import { getJobHealth } from "@/features/jobs/services/jobs.queries";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

/** Admin → Jobs: the health of the background runtime (JOB-004, §14.2). */
export default async function AdminJobsPage() {
  await requireAdmin();
  const health = await getJobHealth();

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Jobs"
        description="Scheduled work, queue depth, and every run the runtime has recorded."
      />
      <AdminNav />
      <JobHealthPanel {...health} />
    </div>
  );
}
