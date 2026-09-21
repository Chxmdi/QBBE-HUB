"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/input";
import { TASK_STATUS_META } from "@/components/shared/status-badges";
import { BlockedReasonDialog } from "@/features/tasks/components/blocked-reason-dialog";
import { updateTaskStatus } from "@/features/tasks/services/task.commands";
import type { TaskStatus } from "@/types/entities";

/**
 * Keyboard-accessible status control — the non-drag alternative required by
 * P0-TSK-03 / A11Y-002. Optimistic with rollback on failure.
 *
 * A parent that owns the move itself — the board, where a change also moves a
 * card between columns and is announced — passes `onSelect` and takes over.
 * Without that the keyboard path and the drag path were two different code
 * paths, and only the one nobody can use with a keyboard moved the card.
 */
export function StatusSelect({
  taskId,
  taskTitle = null,
  status,
  className,
  onSelect,
}: {
  taskId: string;
  /** Named in the blocked-reason dialog so the question is unambiguous. */
  taskTitle?: string | null;
  status: TaskStatus;
  className?: string;
  onSelect?: (next: TaskStatus) => void;
}) {
  const [value, setValue] = useState<TaskStatus>(status);
  const [error, setError] = useState<string | null>(null);
  const [askingBlocked, setAskingBlocked] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply(next: TaskStatus, blockedReason?: string) {
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

  function handleChange(next: TaskStatus) {
    if (onSelect) {
      onSelect(next);
      return;
    }
    // Blocking needs a reason, so the select cannot complete the change on its
    // own. The value stays where it was until the dialog is answered — moving
    // it first would show a status the server has not accepted.
    if (next === "blocked") {
      setAskingBlocked(true);
      return;
    }
    apply(next);
  }

  return (
    <div className={className}>
      <Select
        aria-label="Task status"
        value={onSelect ? status : value}
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
      <BlockedReasonDialog
        open={askingBlocked}
        taskTitle={taskTitle}
        busy={pending}
        onCancel={() => setAskingBlocked(false)}
        onConfirm={(reason) => {
          setAskingBlocked(false);
          apply("blocked", reason);
        }}
      />
    </div>
  );
}
