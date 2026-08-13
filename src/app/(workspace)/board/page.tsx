import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { TaskBoard } from "@/features/tasks/components/board";
import { TaskCreateDialog } from "@/features/tasks/components/task-create-dialog";
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
  await requireSession();
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
      <TaskBoard tasks={tasks} />
    </div>
  );
}
