"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/input";
import { TASK_STATUS_META } from "@/components/shared/status-badges";
import { updateTaskStatus } from "@/features/tasks/services/task.commands";
import type { TaskStatus } from "@/types/entities";

/**
 * Keyboard-accessible status control — the non-drag alternative required by
 * P0-TSK-03 / A11Y-002. Optimistic with rollback on failure.
 */
export function StatusSelect({
  taskId,
  status,
  className,
}: {
  taskId: string;
  status: TaskStatus;
  className?: string;
}) {
  const [value, setValue] = useState<TaskStatus>(status);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleChange(next: TaskStatus) {
    let blockedReason: string | undefined;
    if (next === "blocked") {
      const reason = window.prompt(
        "What is blocking this task? A reason is required.",
      );
      if (!reason?.trim()) return;
      blockedReason = reason.trim();
    }
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await updateTaskStatus(taskId, next, blockedReason);
      if (!result.ok) {
        setValue(previous); // rollback — never display success the server rejected
        setError(result.error ?? "Update failed.");
      }
    });
  }

  return (
    <div className={className}>
      <Select
        aria-label="Task status"
        value={value}
        onChange={(e) => handleChange(e.target.value as TaskStatus)}
        className="h-8 w-36 text-[12.5px]"
      >
        {(Object.keys(TASK_STATUS_META) as TaskStatus[]).map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_META[s].label}
          </option>
        ))}
      </Select>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
