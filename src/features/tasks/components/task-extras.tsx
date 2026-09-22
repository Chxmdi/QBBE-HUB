"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  addChecklistItem,
  addTaskDependency,
  removeChecklistItem,
  reorderChecklist,
  setTaskRecurrence,
  toggleChecklistItem,
} from "@/features/tasks/services/checklist.commands";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export function TaskExtras({
  taskId,
  isStaff,
  recurrenceRule,
  checklist,
  blockers,
  peopleTasks,
  onChanged,
}: {
  taskId: string;
  isStaff: boolean;
  recurrenceRule: string | null;
  checklist: { id: string; title: string; completed_at: string | null }[];
  blockers: { blocking_task_id: string; title: string }[];
  peopleTasks: { id: string; title: string }[];
  /**
   * Re-read the drawer's own data.
   *
   * `router.refresh()` is not enough here and never was. The drawer fetches
   * its task, checklist and blockers from the browser in an effect keyed on
   * the task id; refreshing the server tree leaves that effect alone, so an
   * item added here was saved and then not shown until the drawer was closed
   * and reopened. It looked like the add had failed.
   */
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Tick the box now, reconcile when the server answers.
  //
  // A controlled checkbox bound straight to `completed_at` cannot stay ticked
  // between the click and the reload: React re-renders from the old props
  // first and the tick visibly snaps back. It is a real flicker for a person
  // and an outright failure for anything checking the box actually changed.
  const [optimisticChecklist, applyToggle] = useOptimistic(
    checklist,
    (current, change: { id: string; completed: boolean }) =>
      current.map((item) =>
        item.id === change.id
          ? {
              ...item,
              completed_at: change.completed ? new Date().toISOString() : null,
            }
          : item,
      ),
  );
  const done = optimisticChecklist.filter((item) => item.completed_at).length;

  // Send the whole arrangement, not the one item that moved. The command
  // rewrites positions as 1..n, so an order that has been nudged many times
  // never drifts into fractions, and a concurrent edit loses to a visible
  // arrangement instead of silently reshuffling a different one.
  async function move(from: number, to: number) {
    if (to < 0 || to >= optimisticChecklist.length) return;
    const ids = optimisticChecklist.map((item) => item.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    const result = await reorderChecklist({ taskId, itemIds: ids });
    if (!result.ok) setError(result.error ?? "Could not reorder the checklist.");
    else onChanged();
  }

  return (
    <div className="space-y-5">
      <section>
        <h3 className="section-heading mb-2">Checklist</h3>
        {optimisticChecklist.length === 0 ? (
          <p className="text-[13px] text-muted">No checklist items yet.</p>
        ) : (
          <>
            {/* The roll-up P1-TSK-10 asks for. Announced politely so a screen
                reader hears progress change after a box is ticked rather than
                having to hunt for it. */}
            <p className="mb-2 text-[13px] text-muted" aria-live="polite">
              {done} of {optimisticChecklist.length} done
            </p>
            <ul className="space-y-1.5" aria-label="Checklist">
              {optimisticChecklist.map((item, index) => (
                <li key={item.id} className="flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-2 text-[13.5px]">
                    <input
                      type="checkbox"
                      checked={Boolean(item.completed_at)}
                      onChange={(e) => {
                        const completed = e.target.checked;
                        startTransition(async () => {
                          applyToggle({ id: item.id, completed });
                          await toggleChecklistItem(item.id, completed);
                          onChanged();
                        });
                      }}
                      className="size-4 accent-(--color-brand)"
                    />
                    <span className={item.completed_at ? "text-muted line-through" : ""}>
                      {item.title}
                    </span>
                  </label>
                  {/* Ordinary buttons rather than a drag handle. Dragging is
                      the only way to reorder in most tools and is unusable by
                      keyboard; these are the accessible path, and there is no
                      drag alternative to fall back from. */}
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Move ${item.title} up`}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Move ${item.title} down`}
                    disabled={index === optimisticChecklist.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove ${item.title}`}
                    onClick={async () => {
                      const result = await removeChecklistItem(item.id);
                      if (!result.ok) setError(result.error ?? "Could not remove item.");
                      else onChanged();
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const title = new FormData(form).get("title") as string;
            const result = await addChecklistItem({ taskId, title });
            if (!result.ok) setError(result.error ?? "Could not add item.");
            else {
              form.reset();
              onChanged();
            }
          }}
        >
          <Input name="title" placeholder="Add a checklist item" required maxLength={300} />
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      </section>

      <section>
        <h3 className="section-heading mb-2">Dependencies</h3>
        {blockers.length === 0 ? (
          <p className="text-[13px] text-muted">No blocking tasks.</p>
        ) : (
          <ul className="text-[13.5px]">
            {blockers.map((b) => (
              <li key={b.blocking_task_id}>Blocked by {b.title}</li>
            ))}
          </ul>
        )}
        {isStaff ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const blockingTaskId = new FormData(e.currentTarget).get("blockingTaskId") as string;
              const result = await addTaskDependency({ blockingTaskId, blockedTaskId: taskId });
              if (!result.ok) setError(result.error ?? "Could not add dependency.");
              else onChanged();
            }}
          >
            <Select name="blockingTaskId" required defaultValue="">
              <option value="" disabled>
                This task is blocked by…
              </option>
              {peopleTasks
                .filter((t) => t.id !== taskId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </Select>
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
        ) : null}
      </section>

      <section>
        <Label htmlFor="recurrence">Repeats</Label>
        <Select
          id="recurrence"
          defaultValue={recurrenceRule ?? ""}
          onChange={async (e) => {
            await setTaskRecurrence({ taskId, recurrenceRule: e.target.value });
            onChanged();
          }}
        >
          <option value="">Does not repeat</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </Select>
      </section>
      {error ? <p role="alert" className="text-[13px] text-danger-fg">{error}</p> : null}
    </div>
  );
}
