"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addChecklistItem,
  addTaskDependency,
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
}: {
  taskId: string;
  isStaff: boolean;
  recurrenceRule: string | null;
  checklist: { id: string; title: string; completed_at: string | null }[];
  blockers: { blocking_task_id: string; title: string }[];
  peopleTasks: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <section>
        <h3 className="section-heading mb-2">Checklist</h3>
        {checklist.length === 0 ? (
          <p className="text-[13px] text-muted">No checklist items yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {checklist.map((item) => (
              <li key={item.id}>
                <label className="flex items-center gap-2 text-[13.5px]">
                  <input
                    type="checkbox"
                    checked={Boolean(item.completed_at)}
                    onChange={async (e) => {
                      await toggleChecklistItem(item.id, e.target.checked);
                      router.refresh();
                    }}
                    className="size-4 accent-(--color-brand)"
                  />
                  <span className={item.completed_at ? "text-muted line-through" : ""}>
                    {item.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
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
              router.refresh();
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
              else router.refresh();
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
            router.refresh();
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
