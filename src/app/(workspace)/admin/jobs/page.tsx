import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { JobHealthPanel } from "@/features/jobs/components/job-health-panel";
import { getJobHealth } from "@/features/jobs/services/jobs.queries";
import { JOB_RUNNER_FIX, getJobRunnerStatus } from "@/features/jobs/services/runner-status";
import { requireAdminAal2 } from "@/lib/auth";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

/** Admin → Jobs: the health of the background runtime (JOB-004, §14.2). */
export default async function AdminJobsPage() {
  await requireAdminAal2();
  const [health, runner] = await Promise.all([getJobHealth(), getJobRunnerStatus()]);

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Jobs"
        description="Scheduled work, queue depth, and every run the runtime has recorded."
      />
      <AdminNav />
      {runner !== "ready" ? (
        <div
          role="alert"
          className="mb-5 rounded-(--radius-md) border border-danger/40 bg-danger/10 px-4 py-3"
        >
          <p className="text-[13.5px] font-semibold">Background jobs are not running</p>
          <p className="meta">{JOB_RUNNER_FIX[runner]}</p>
        </div>
      ) : null}
      <JobHealthPanel {...health} />
    </div>
  );
}
