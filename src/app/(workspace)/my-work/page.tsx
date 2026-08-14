import type { Metadata } from "next";
import { Suspense } from "react";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TaskCreateDialog } from "@/features/tasks/components/task-create-dialog";
import { TaskDrawer } from "@/features/tasks/components/task-drawer";
import {
  TaskFilterBar,
  TaskList,
} from "@/features/tasks/components/task-list";
import {
  getMyTasksFiltered,
  getPickerOptions,
} from "@/features/tasks/services/task.queries";
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
  searchParams: Promise<{
    create?: string;
    status?: string;
    priority?: string;
    project?: string;
    q?: string;
  }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const filters = {
    status: params.status,
    priority: params.priority,
    project: params.project,
    q: params.q,
  };

  const [tasks, options] = await Promise.all([
    getMyTasksFiltered(session.userId, filters),
    getPickerOptions(),
  ]);

  const grouped = new Map<string, Task[]>();
  for (const bucket of BUCKETS) grouped.set(bucket.key, []);
  for (const task of tasks) {
    grouped.get(myWorkBucket(task.due_at))!.push(task);
  }

  const groups = BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    tasks: grouped.get(bucket.key)!,
  }));

  const filtersActive = Boolean(
    filters.status || filters.priority || filters.project || filters.q,
  );

  return (
    <div>
      <PageHeader
        eyebrow="Command center"
        title="My Work"
        description="Everything you own, grouped by urgency. Select rows for bulk changes, or open a task for full detail."
        actions={
          <TaskCreateDialog
            projects={options.projects}
            people={options.people}
            defaultOpen={params.create === "task"}
          />
        }
      />

      <Suspense fallback={<div className="mb-5 h-9" />}>
        <TaskFilterBar projects={options.projects} activeFilters={filters} />
      </Suspense>

      {tasks.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={<ClipboardList />}
            title="No tasks match these filters"
            description="Try widening the status, priority, or project filter — or clear them to see all your open work."
          />
        ) : (
          <EmptyState
            icon={<ClipboardList />}
            title="Your workload is clear"
            description="When tasks are assigned to you — from projects, meetings, or conversations — they appear here grouped by due date."
          />
        )
      ) : (
        <Suspense fallback={<ListSkeleton rows={6} />}>
          <TaskList groups={groups} people={options.people} />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <TaskDrawer people={options.people} />
      </Suspense>
    </div>
  );
}
