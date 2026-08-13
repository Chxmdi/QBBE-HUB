import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TaskCreateDialog } from "@/features/tasks/components/task-create-dialog";
import { TaskRow } from "@/features/tasks/components/task-row";
import { getMyTasks, getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { myWorkBucket } from "@/lib/utils";
import type { Task } from "@/types/entities";

export const metadata: Metadata = { title: "My Work" };
export const dynamic = "force-dynamic";

const BUCKETS: { key: ReturnType<typeof myWorkBucket>; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "this_week", label: "This week" },
  { key: "later", label: "Later / unscheduled" },
];

export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [tasks, options] = await Promise.all([
    getMyTasks(session.userId),
    getPickerOptions(),
  ]);

  const grouped = new Map<string, Task[]>();
  for (const bucket of BUCKETS) grouped.set(bucket.key, []);
  for (const task of tasks) {
    grouped.get(myWorkBucket(task.due_at))!.push(task);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Command center"
        title="My Work"
        description="Everything you own, grouped by urgency. Status changes save immediately."
        actions={
          <TaskCreateDialog
            projects={options.projects}
            people={options.people}
            defaultOpen={params.create === "task"}
          />
        }
      />

      {tasks.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="No open work assigned to you"
          description="When tasks are assigned to you — from projects, meetings, or conversations — they appear here grouped by due date."
        />
      ) : (
        <div className="space-y-7">
          {BUCKETS.map((bucket) => {
            const bucketTasks = grouped.get(bucket.key)!;
            if (bucketTasks.length === 0) return null;
            return (
              <section key={bucket.key} aria-labelledby={`bucket-${bucket.key}`}>
                <h2
                  id={`bucket-${bucket.key}`}
                  className="section-heading mb-2 flex items-center gap-2"
                >
                  {bucket.label}
                  <span className="meta font-normal">{bucketTasks.length}</span>
                </h2>
                <div className="card overflow-hidden">
                  {bucketTasks.map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
