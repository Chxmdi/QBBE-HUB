import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { KanbanSquare } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TaskBoard } from "@/features/tasks/components/board";
import { TaskCreateDialog } from "@/features/tasks/components/task-create-dialog";
import { TaskDrawer } from "@/features/tasks/components/task-drawer";
import { TaskFilterBar } from "@/features/tasks/components/task-filter-bar";
import { SaveViewButton } from "@/features/tasks/components/save-view-button";
import { hasActiveFilters, parseTaskFilters } from "@/features/tasks/filters";
import {
  getPickerOptions,
  getScopedTasks,
} from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { calendarDateInZone } from "@/lib/time";

export const metadata: Metadata = { title: "Board" };
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const filters = parseTaskFilters(params);
  const today = calendarDateInZone(new Date(), session.timeZone) ?? "";

  const [result, options] = await Promise.all([
    getScopedTasks(filters, today),
    getPickerOptions(),
  ]);

  const projectName = filters.project
    ? options.projects.find((p) => p.id === filters.project)?.label
    : null;

  // The board and the list are two views of one set of records, so a filtered
  // board hands the list the same filters rather than a fresh start.
  const filterQuery = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  ).toString();

  return (
    <div>
      <PageHeader
        eyebrow={projectName ? "Project board" : "Organization board"}
        title={projectName ?? "Board"}
        description="Drag cards between columns, or move them with the keyboard — both act on the same durable records."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={filterQuery ? `/my-work?${filterQuery}` : "/my-work"}
              className="text-[13px] font-medium text-brand-fg hover:underline"
            >
              Open as list
            </Link>
            <Suspense fallback={null}>
              <SaveViewButton path="/board" />
            </Suspense>
            <TaskCreateDialog
              projects={options.projects}
              people={options.people}
              milestones={options.milestones}
              defaultProjectId={filters.project}
            />
          </div>
        }
      />

      <Suspense fallback={<div className="mb-5 h-9" />}>
        <TaskFilterBar filters={filters} options={options} basePath="/board" />
      </Suspense>

      {result.failed ? (
        <div
          role="alert"
          className="rounded-(--radius-md) border border-danger/25 bg-danger/10 px-4 py-3"
        >
          <p className="text-[13.5px] font-medium text-danger-fg">
            The board could not be loaded.
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            An empty board and a board that failed to load look alike, so this
            says which happened. Nothing has been changed.
          </p>
          <Link
            href="/board"
            className="mt-2 inline-block text-[13px] font-medium text-brand-fg hover:underline"
          >
            Try again
          </Link>
        </div>
      ) : result.tasks.length === 0 ? (
        <EmptyState
          icon={<KanbanSquare />}
          title={
            hasActiveFilters(filters)
              ? "No tasks match these filters"
              : projectName
                ? "No tasks on this project board yet"
                : "No tasks on the board yet"
          }
          description={
            hasActiveFilters(filters)
              ? "Try widening a filter, or clear them to see the whole board."
              : "Cards appear here as soon as tasks exist. Create one with New task above, or from a project, meeting, or message."
          }
        />
      ) : (
        <TaskBoard tasks={result.tasks} timeZone={session.timeZone} />
      )}

      <Suspense fallback={null}>
        <TaskDrawer people={options.people} isStaff={session.isStaff} />
      </Suspense>
    </div>
  );
}
