"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Select } from "@/components/ui/input";
import { taskStatusLabel } from "@/components/shared/status-badges";
import { TASK_STATUSES } from "@/features/tasks/schemas";
import { useT } from "@/lib/i18n/client";
import { BlockedReasonDialog } from "@/features/tasks/components/blocked-reason-dialog";
import { updateTaskStatus } from "@/features/tasks/services/task.commands";
import type { TaskStatus } from "@/types/entities";

/**
 * The task whose card is moving after a change made with this select. On a
 * board the card is re-rendered in its new column, which unmounts the focused
 * select; the new one takes focus when it mounts, so a keyboard user stays on
 * the card instead of landing at the top of the page. Cleared after a moment
 * so a card that does not reappear (a collapsed column) cannot grab focus
 * later.
 */
let refocusTaskId: string | null = null;
let refocusTimer: ReturnType<typeof setTimeout> | null = null;

function keepFocusOn(taskId: string) {
  refocusTaskId = taskId;
  if (refocusTimer) clearTimeout(refocusTimer);
  refocusTimer = setTimeout(() => {
    refocusTaskId = null;
  }, 10_000);
}

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
  const t = useT();
  const [value, setValue] = useState<TaskStatus>(status);
  const [error, setError] = useState<string | null>(null);
  const [askingBlocked, setAskingBlocked] = useState(false);
  const [pending, startTransition] = useTransition();
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (refocusTaskId !== taskId) return;
    // Only the instance in the card's new place takes it; the old one is gone.
    if (document.activeElement && document.activeElement !== document.body) return;
    refocusTaskId = null;
    selectRef.current?.focus();
  });

  function apply(next: TaskStatus, blockedReason?: string) {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await updateTaskStatus(taskId, next, blockedReason);
      if (!result.ok) {
        setValue(previous); // rollback — never display success the server rejected
        setError(result.error ?? t("tasks.statusSelect.updateFailed"));
      }
    });
  }

  function handleChange(next: TaskStatus) {
    if (onSelect) {
      keepFocusOn(taskId);
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
        ref={selectRef}
        // Named after its task: every card's control was just "Task status".
        aria-label={
          taskTitle ? t("tasks.statusSelect.labelFor", { title: taskTitle }) : t("tasks.statusSelect.label")
        }
        value={onSelect ? status : value}
        onChange={(e) => handleChange(e.target.value as TaskStatus)}
        className="h-8 w-36 text-[12.5px]"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {taskStatusLabel(s, t)}
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
