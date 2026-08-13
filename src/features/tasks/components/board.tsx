"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge, TASK_STATUS_META } from "@/components/shared/status-badges";
import { StatusSelect } from "@/features/tasks/components/status-select";
import { updateTaskStatus } from "@/features/tasks/services/task.commands";
import { cn, dueLabel } from "@/lib/utils";
import type { Task, TaskStatus } from "@/types/entities";

const BOARD_COLUMNS: TaskStatus[] = [
  "not_started",
  "ready",
  "in_progress",
  "blocked",
  "in_review",
  "completed",
];

/**
 * Kanban board — a projection of the same durable task records as the list
 * view (WORK-003). Pointer drag has a keyboard alternative via the status
 * select on every card (A11Y-002).
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
        <p role="alert" className="mb-3 rounded-(--radius-sm) bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        <div className="flex min-w-max gap-3">
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
                  "w-72 shrink-0 rounded-(--radius-md) bg-surface-soft/60 p-2 transition-colors",
                  dropTarget === column && "ring-2 ring-brand/50",
                )}
              >
                <header className="flex items-center justify-between px-1.5 py-1.5">
                  <h2 className="text-[12.5px] font-semibold tracking-wide uppercase">
                    {TASK_STATUS_META[column].label}
                  </h2>
                  <span className="meta">{columnTasks.length}</span>
                </header>
                <div className="space-y-2">
                  {columnTasks.map((task) => {
                    const due = dueLabel(task.due_at);
                    return (
                      <article
                        key={task.id}
                        draggable
                        onDragStart={() => setDragId(task.id)}
                        onDragEnd={() => setDragId(null)}
                        className={cn(
                          "card cursor-grab space-y-2 p-3 shadow-(--shadow-raise) active:cursor-grabbing",
                          dragId === task.id && "opacity-50",
                        )}
                      >
                        <p className="text-[13.5px] leading-snug font-medium">
                          {task.title}
                        </p>
                        {task.blocked_reason ? (
                          <p className="text-[12px] text-danger">
                            Blocked: {task.blocked_reason}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PriorityBadge priority={task.priority} />
                          {task.due_at ? (
                            <span
                              className={cn(
                                "text-[11.5px]",
                                due.tone === "danger"
                                  ? "font-medium text-danger"
                                  : due.tone === "warning"
                                    ? "font-medium text-warning"
                                    : "text-muted",
                              )}
                            >
                              {due.label}
                            </span>
                          ) : null}
                          <span className="ml-auto">
                            {task.assignee ? (
                              <Avatar
                                name={task.assignee.full_name}
                                src={task.assignee.avatar_url}
                                size="xs"
                              />
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
                    <p className="px-1.5 py-4 text-center text-[12px] text-muted/70">
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
