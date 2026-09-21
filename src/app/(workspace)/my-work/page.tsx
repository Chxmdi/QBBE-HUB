import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { CalendarClock, ClipboardList, OctagonAlert } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ListSkeleton } from "@/components/ui/skeleton";
import { SaveViewButton } from "@/features/tasks/components/save-view-button";
import { TaskCreateDialog } from "@/features/tasks/components/task-create-dialog";
import { TaskDrawer } from "@/features/tasks/components/task-drawer";
import { FilterConflictNotice } from "@/features/tasks/components/filter-conflict-notice";
import { TaskFilterBar } from "@/features/tasks/components/task-filter-bar";
import { TaskList } from "@/features/tasks/components/task-list";
import {
  describeFilterConflicts,
  hasActiveFilters,
  parseTaskFilters,
  type TaskFilters,
} from "@/features/tasks/filters";
import { TASK_STATUS_LABELS } from "@/features/tasks/schemas";
import { getMyWork, getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { calendarDateInZone, formatInZone } from "@/lib/time";
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const filters = parseTaskFilters(params);
  const today = calendarDateInZone(new Date(), session.timeZone) ?? "";

  const [work, options] = await Promise.all([
    getMyWork(session.userId, filters, today),
    getPickerOptions(),
  ]);

  // Group in the organization's zone — the same zone each row prints its due
  // date in. Reading the ambient clock here is what let a task sit under
  // "Overdue" while its own row said "Due today".
  const grouped = new Map<string, Task[]>();
  for (const bucket of BUCKETS) grouped.set(bucket.key, []);
  for (const task of work.owned) {
    grouped.get(myWorkBucket(task.due_at, session.timeZone))!.push(task);
  }
  const groups = BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    tasks: grouped.get(bucket.key)!,
  }));

  const filtersActive = hasActiveFilters(filters);
  const nothingAtAll =
    work.owned.length === 0 &&
    work.reviewing.length === 0 &&
    work.meetings.length === 0;

  return (
    <div>
      <PageHeader
        eyebrow="Command center"
        title="My Work"
        description="Everything you own or must review, grouped by urgency. Select rows for bulk changes, or open a task for full detail."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Suspense fallback={null}>
              <SaveViewButton path="/my-work" />
            </Suspense>
            <TaskCreateDialog
              projects={options.projects}
              people={options.people}
              milestones={options.milestones}
              defaultOpen={params.create === "task"}
            />
          </div>
        }
      />

      <Suspense fallback={<div className="mb-5 h-9" />}>
        <TaskFilterBar
          filters={filters}
          options={options}
          basePath="/my-work"
          showOwner={false}
        />
      </Suspense>

      <FilterConflictNotice
        conflicts={describeFilterConflicts(filters, {
          // My Work is one person's list by definition, so an owner filter
          // naming anybody else arrives from a pasted link or a saved view
          // built on the board. It is not a mistake in the filters; it is a
          // filter that cannot apply here.
          scopedToUserId: session.userId,
          statusLabel: (status) => TASK_STATUS_LABELS[status],
        })}
      />

      {work.failed ? (
        <div
          role="alert"
          className="mb-5 rounded-(--radius-md) border border-danger/25 bg-danger/10 px-4 py-3"
        >
          <p className="text-[13.5px] font-medium text-danger-fg">
            Your work could not be loaded.
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            This is a loading failure, not an empty workload — nothing has been
            changed or lost.
          </p>
          <RetryLink filters={filters} />
        </div>
      ) : null}

      {work.reviewing.length > 0 ? (
        <section aria-labelledby="review-queue" className="mb-8">
          <h2
            id="review-queue"
            className="section-heading mb-2 flex items-center gap-2"
          >
            Waiting for your review
            <span className="meta font-normal">{work.reviewing.length}</span>
          </h2>
          <Suspense fallback={<ListSkeleton rows={2} />}>
            <TaskList
              groups={[
                { key: "review", label: "Review queue", tasks: work.reviewing },
              ]}
              people={options.people}
              timeZone={session.timeZone}
              showGroupHeadings={false}
            />
          </Suspense>
        </section>
      ) : null}

      {work.blocked.length > 0 ? (
        <section aria-labelledby="blocked-work" className="mb-8">
          <h2
            id="blocked-work"
            className="section-heading mb-2 flex items-center gap-2"
          >
            <OctagonAlert className="size-4 text-danger-fg" aria-hidden />
            Blocked
            <span className="meta font-normal">{work.blocked.length}</span>
          </h2>
          <ul className="card divide-y divide-line">
            {work.blocked.map((task) => (
              <li key={task.id} className="px-3 py-2.5">
                <Link
                  href={`/my-work?task=${task.id}`}
                  className="text-[14px] font-medium hover:text-brand-fg"
                >
                  {task.title}
                </Link>
                {task.blocked_reason ? (
                  <p className="text-[12.5px] text-danger-fg">
                    {task.blocked_reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {work.owned.length === 0 && !work.failed ? (
        filtersActive ? (
          <EmptyState
            icon={<ClipboardList />}
            title="No tasks match these filters"
            description="Try widening a filter — or clear them to see all of your open work."
          />
        ) : nothingAtAll ? (
          <EmptyState
            icon={<ClipboardList />}
            title="Your workload is clear"
            description="When tasks are assigned to you — from projects, meetings, or conversations — they appear here grouped by due date."
          />
        ) : null
      ) : (
        <Suspense fallback={<ListSkeleton rows={6} />}>
          <TaskList
            groups={groups}
            people={options.people}
            timeZone={session.timeZone}
          />
        </Suspense>
      )}

      {work.meetings.length > 0 ? (
        <section aria-labelledby="upcoming-meetings" className="mt-8">
          <h2
            id="upcoming-meetings"
            className="section-heading mb-2 flex items-center gap-2"
          >
            <CalendarClock className="size-4" aria-hidden />
            Upcoming meetings
          </h2>
          <ul className="card divide-y divide-line">
            {work.meetings.map((meeting) => (
              <li
                key={meeting.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
              >
                <Link
                  href={`/meetings/${meeting.id}`}
                  className="text-[14px] font-medium hover:text-brand-fg"
                >
                  {meeting.title}
                </Link>
                <span className="meta">
                  {formatInZone(meeting.starts_at, session.timeZone, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                {meeting.project ? (
                  <span className="meta ml-auto truncate">
                    {meeting.project.name}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Suspense fallback={null}>
        <TaskDrawer people={options.people} isStaff={session.isStaff} />
      </Suspense>
    </div>
  );
}

/** Retry the same view, filters intact — a reload is the whole remedy. */
function RetryLink({ filters }: { filters: TaskFilters }) {
  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  ).toString();
  return (
    <Link
      href={query ? `/my-work?${query}` : "/my-work"}
      className="mt-2 inline-block text-[13px] font-medium text-brand-fg hover:underline"
    >
      Try again
    </Link>
  );
}
