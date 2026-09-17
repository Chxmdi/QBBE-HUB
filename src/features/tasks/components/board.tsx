"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge, TASK_STATUS_META } from "@/components/shared/status-badges";
import { StatusSelect } from "@/features/tasks/components/status-select";
import { updateTaskStatus } from "@/features/tasks/services/task.commands";
import { cn, dueLabel } from "@/lib/utils";
import type { Task, TaskStatus } from "@/types/entities";
import { BOARD_COLUMNS } from "@/features/tasks/schemas";

const COLUMN_TONES: Record<TaskStatus, string> = {
  not_started: "border-t-muted/45",
  ready: "border-t-info",
  in_progress: "border-t-brand",
  waiting: "border-t-warning",
  blocked: "border-t-danger",
  in_review: "border-t-brand-light",
  completed: "border-t-success",
  cancelled: "border-t-muted/45",
};

const COLUMN_DOTS: Record<TaskStatus, string> = {
  not_started: "bg-muted",
  ready: "bg-info",
  in_progress: "bg-brand",
  waiting: "bg-warning",
  blocked: "bg-danger",
  in_review: "bg-brand-light",
  completed: "bg-success",
  cancelled: "bg-muted",
};

/**
 * Kanban board — a projection of the same durable task records as the list
 * view (WORK-003). Pointer drag has a keyboard alternative via the status
 * select on every card (A11Y-002). Visual changes here do not alter the
 * existing updateTaskStatus persistence path.
 */
export function TaskBoard({ tasks }: { tasks: Task[] }) {
  const [optimisticTasks, applyMove] = useOptimistic(
    tasks,
    (state, move: { id: string; status: TaskStatus }) =>
      state.map((t) => (t.id === move.id ? { ...t, status: move.status } : t)),
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();

  function openTask(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("task", id);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function moveTask(id: string, status: TaskStatus) {
    const task = optimisticTasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    if (status === "blocked") {
      const reason = window.prompt(
        "What is blocking this task? A reason is required.",
      );
      if (!reason?.trim()) return;
      startTransition(async () => {
        applyMove({ id, status });
        const result = await updateTaskStatus(id, status, reason.trim());
        if (!result.ok) setError(result.error ?? "Move failed.");
      });
      return;
    }
    startTransition(async () => {
      applyMove({ id, status });
      const result = await updateTaskStatus(id, status);
      if (!result.ok) setError(result.error ?? "Move failed.");
    });
  }

  return (
    <div>
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-(--radius-sm) border border-danger/20 bg-danger/10 px-3 py-2 text-[13px] text-danger-fg"
        >
          {error}
        </p>
      ) : null}
      <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        <div className="flex min-w-max gap-3.5">
          {BOARD_COLUMNS.map((column) => {
            const columnTasks = optimisticTasks.filter(
              (t) => t.status === column,
            );
            return (
              <section
                key={column}
                aria-label={`${TASK_STATUS_META[column].label} column`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTarget(column);
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTarget(null);
                  if (dragId) moveTask(dragId, column);
                  setDragId(null);
                }}
                className={cn(
                  "w-72 shrink-0 rounded-(--radius-md) border border-line border-t-[3px] bg-surface-soft/48 p-2.5 transition-colors",
                  COLUMN_TONES[column],
                  dropTarget === column && "bg-brand-soft/60 ring-2 ring-brand/35",
                )}
              >
                <header className="mb-1 flex items-center justify-between px-1.5 py-1.5">
                  <h2 className="flex items-center gap-2 text-[12.5px] font-bold tracking-[0.06em] text-ink uppercase">
                    <span
                      aria-hidden
                      className={cn("size-2 rounded-full", COLUMN_DOTS[column])}
                    />
                    {TASK_STATUS_META[column].label}
                  </h2>
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-bold text-muted">
                    {columnTasks.length}
                  </span>
                </header>
                <div className="space-y-2.5">
                  {columnTasks.map((task) => {
                    const due = dueLabel(task.due_at);
                    return (
                      <article
                        key={task.id}
                        draggable
                        onDragStart={() => setDragId(task.id)}
                        onDragEnd={() => setDragId(null)}
                        className={cn(
                          "card cursor-grab space-y-2.5 p-3.5 shadow-(--shadow-raise) transition-[border-color,box-shadow,transform] duration-(--duration-fast) hover:-translate-y-px hover:border-brand/25 hover:shadow-(--shadow-pop) active:cursor-grabbing",
                          dragId === task.id && "opacity-50",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => openTask(task.id)}
                          className="block w-full text-left text-[13.5px] leading-snug font-semibold text-ink transition-colors hover:text-brand-fg"
                        >
                          {task.title}
                        </button>
                        {task.project ? (
                          <p className="truncate text-[11.5px] font-medium text-brand-fg/80">
                            {task.project.name}
                          </p>
                        ) : null}
                        {task.blocked_reason ? (
                          <p className="rounded-(--radius-sm) border border-danger/15 bg-danger/8 px-2 py-1.5 text-[12px] text-danger-fg">
                            <span className="font-semibold">Blocked:</span>{" "}
                            {task.blocked_reason}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-1.5 border-t border-line/70 pt-2.5">
                          <PriorityBadge priority={task.priority} />
                          {task.due_at ? (
                            <span
                              className={cn(
                                "text-[11.5px]",
                                due.tone === "danger"
                                  ? "font-semibold text-danger-fg"
                                  : due.tone === "warning"
                                    ? "font-semibold text-warning-fg"
                                    : "text-muted",
                              )}
                            >
                              {due.label}
                            </span>
                          ) : null}
                          <span className="ml-auto">
                            {task.assignee ? (
                              <span className="rounded-full ring-1 ring-brand/12">
                                <Avatar
                                  name={task.assignee.full_name}
                                  src={task.assignee.avatar_url}
                                  size="xs"
                                />
                              </span>
                            ) : (
                              <Badge tone="neutral">Unassigned</Badge>
                            )}
                          </span>
                        </div>
                        <StatusSelect taskId={task.id} status={task.status} />
                      </article>
                    );
                  })}
                  {columnTasks.length === 0 ? (
                    <p className="rounded-(--radius-sm) border border-dashed border-line bg-surface/45 px-1.5 py-5 text-center text-[12px] text-muted/80">
                      No tasks
                    </p>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
