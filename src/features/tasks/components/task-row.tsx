import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  PriorityBadge,
  TaskStatusBadge,
} from "@/components/shared/status-badges";
import { StatusSelect } from "@/features/tasks/components/status-select";
import { cn, dueLabel } from "@/lib/utils";
import type { Task } from "@/types/entities";

/** Dense, scan-friendly task row shared by My Work and project views. */
export function TaskRow({
  task,
  showStatusControl = true,
}: {
  task: Task;
  showStatusControl?: boolean;
}) {
  const due = dueLabel(task.due_at);
  return (
    <div className="interactive-row flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1 basis-52">
        <p className="truncate text-[14px] font-medium">{task.title}</p>
        <p className="meta flex flex-wrap items-center gap-x-2">
          {task.project ? (
            <Link
              href={`/projects/${task.project.id}`}
              className="truncate hover:text-brand hover:underline"
            >
              {task.project.name}
            </Link>
          ) : (
            <span>No project</span>
          )}
          {task.blocked_reason ? (
            <span className="text-danger">Blocked: {task.blocked_reason}</span>
          ) : null}
        </p>
      </div>
      <span
        className={cn(
          "text-[12.5px] whitespace-nowrap",
          due.tone === "danger"
            ? "font-medium text-danger"
            : due.tone === "warning"
              ? "font-medium text-warning"
              : "text-muted",
        )}
      >
        {due.label}
      </span>
      <PriorityBadge priority={task.priority} />
      {task.assignee ? (
        <Avatar name={task.assignee.full_name} src={task.assignee.avatar_url} size="sm" />
      ) : (
        <Badge tone="neutral">Unassigned</Badge>
      )}
      {showStatusControl ? (
        <StatusSelect taskId={task.id} status={task.status} />
      ) : (
        <TaskStatusBadge status={task.status} />
      )}
    </div>
  );
}
