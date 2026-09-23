"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  removeEventChecklistItem,
  toggleEventChecklistItem,
} from "@/features/events/services/event-checklist.commands";

type ChecklistItem = {
  id: string;
  title: string;
  completed_at: string | null;
};

/**
 * The preparation checklist on an event (P0-EVT-01).
 *
 * Ticking a box is optimistic, because the round trip is long enough to feel
 * like the click was lost otherwise — which is the same class of problem as
 * #80, just felt by a person rather than by a test. The optimistic state is
 * reverted by the server's own re-render if the command fails, and the error
 * is shown rather than swallowed.
 */
export function EventChecklist({
  items,
  canManage,
}: {
  items: ChecklistItem[];
  canManage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [optimisticItems, applyToggle] = useOptimistic(
    items,
    (current, change: { id: string; completed: boolean }) =>
      current.map((item) =>
        item.id === change.id
          ? { ...item, completed_at: change.completed ? new Date().toISOString() : null }
          : item,
      ),
  );

  const done = optimisticItems.filter((item) => item.completed_at).length;

  function toggle(item: ChecklistItem) {
    const completed = !item.completed_at;
    setError(null);
    startTransition(async () => {
      applyToggle({ id: item.id, completed });
      const result = await toggleEventChecklistItem(item.id, completed);
      if (!result.ok) setError(result.error ?? "Could not update the checklist item.");
    });
  }

  function remove(item: ChecklistItem) {
    setError(null);
    startTransition(async () => {
      const result = await removeEventChecklistItem(item.id);
      if (!result.ok) setError(result.error ?? "Could not remove the checklist item.");
    });
  }

  if (optimisticItems.length === 0) {
    return (
      <p className="card px-4 py-6 text-center text-[13px] text-muted">
        Nothing to prepare yet. Add what has to be ready before the day.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="card divide-y divide-line">
        {optimisticItems.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
            <input
              type="checkbox"
              id={`event-checklist-${item.id}`}
              checked={Boolean(item.completed_at)}
              onChange={() => toggle(item)}
              disabled={!canManage || isPending}
              className="size-4 shrink-0"
            />
            <label
              htmlFor={`event-checklist-${item.id}`}
              className={
                item.completed_at
                  ? "flex-1 text-[13.5px] text-muted line-through"
                  : "flex-1 text-[13.5px]"
              }
            >
              {item.title}
            </label>
            {canManage ? (
              <button
                type="button"
                onClick={() => remove(item)}
                disabled={isPending}
                className="text-[12px] text-muted underline underline-offset-2"
                aria-label={`Remove ${item.title}`}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted" aria-live="polite">
        {done} of {optimisticItems.length} ready
      </p>
      {error ? (
        <p role="alert" className="text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
