import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { KanbanSquare } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TaskBoard } from "@/features/tasks/components/board";
import { TaskCreateDialog } from "@/features/tasks/components/task-create-dialog";
import { TaskDrawer } from "@/features/tasks/components/task-drawer";
import { FilterConflictNotice } from "@/features/tasks/components/filter-conflict-notice";
import { TaskFilterBar } from "@/features/tasks/components/task-filter-bar";
import { SaveViewButton } from "@/features/tasks/components/save-view-button";
import { SavedViews } from "@/features/tasks/components/saved-views";
import { listSavedViews } from "@/features/tasks/services/saved-view.queries";
import {
  describeFilterConflicts,
  hasActiveFilters,
  parseTaskFilters,
} from "@/features/tasks/filters";
import { taskStatusText } from "@/features/tasks/schemas";
import {
  getPickerOptions,
  getScopedTasks,
} from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { calendarDateInZone } from "@/lib/time";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("board.title") };
}
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const t = await getT();
  const params = await searchParams;
  const filters = parseTaskFilters(params);
  const today = calendarDateInZone(new Date(), session.timeZone) ?? "";

  const [result, options, savedViews] = await Promise.all([
    getScopedTasks(filters, today),
    getPickerOptions(),
    listSavedViews("/board"),
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
        eyebrow={projectName ? t("board.projectEyebrow") : t("board.orgEyebrow")}
        title={projectName ?? t("board.title")}
        description={t("board.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={filterQuery ? `/my-work?${filterQuery}` : "/my-work"}
              className="text-[13px] font-medium text-brand-fg hover:underline"
            >
              {t("board.openAsList")}
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

      <Suspense fallback={null}>
        <SavedViews views={savedViews} />
      </Suspense>

      <Suspense fallback={<div className="mb-5 h-9" />}>
        <TaskFilterBar filters={filters} options={options} basePath="/board" />
      </Suspense>

      <FilterConflictNotice
        conflicts={describeFilterConflicts(filters, {
          statusLabel: (status) => taskStatusText(status, t),
          t,
        })}
      />

      {result.failed ? (
        <div
          role="alert"
          className="rounded-(--radius-md) border border-danger/25 bg-danger/10 px-4 py-3"
        >
          <p className="text-[13.5px] font-medium text-danger-fg">
            {t("board.loadFailed")}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {t("board.loadFailedDetail")}
          </p>
          <Link
            href="/board"
            className="mt-2 inline-block text-[13px] font-medium text-brand-fg hover:underline"
          >
            {t("common.tryAgain")}
          </Link>
        </div>
      ) : result.tasks.length === 0 ? (
        <EmptyState
          icon={<KanbanSquare />}
          title={
            hasActiveFilters(filters)
              ? t("board.noMatchTitle")
              : projectName
                ? t("board.noTasksProject")
                : t("board.noTasks")
          }
          description={
            hasActiveFilters(filters)
              ? t("board.noMatchBody")
              : t("board.emptyBody")
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
