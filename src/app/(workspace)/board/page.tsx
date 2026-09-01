import type { Metadata } from "next";
import { Suspense } from "react";
import { KanbanSquare } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TaskBoard } from "@/features/tasks/components/board";
import { TaskCreateDialog } from "@/features/tasks/components/task-create-dialog";
import { TaskDrawer } from "@/features/tasks/components/task-drawer";
import {
  getBoardTasks,
  getPickerOptions,
} from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Board" };
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [tasks, options] = await Promise.all([
    getBoardTasks(params.project),
    getPickerOptions(),
  ]);

  const projectName = params.project
    ? options.projects.find((p) => p.id === params.project)?.label
    : null;

  return (
    <div>
      <PageHeader
        eyebrow={projectName ? "Project board" : "Organization board"}
        title={projectName ?? "Board"}
        description="Drag cards between columns, or use the status control on any card — both act on the same durable records."
        actions={
          <TaskCreateDialog
            projects={options.projects}
            people={options.people}
            defaultProjectId={params.project}
          />
        }
      />
      {tasks.length === 0 ? (
        <EmptyState
          icon={<KanbanSquare />}
          title={
            projectName
              ? "No tasks on this project board yet"
              : "No tasks on the board yet"
          }
          description="Cards appear here as soon as tasks exist. Create one with New task above, or from a project, meeting, or message."
        />
      ) : (
        <TaskBoard tasks={tasks} />
      )}
      <Suspense fallback={null}>
        <TaskDrawer people={options.people} isStaff={session.isStaff} />
      </Suspense>
    </div>
  );
}
