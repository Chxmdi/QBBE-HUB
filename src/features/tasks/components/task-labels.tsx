"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { LABEL_COLORS, type LabelColor } from "@/features/tasks/schemas";
import {
  attachTaskLabel,
  createLabel,
  detachTaskLabel,
} from "@/features/tasks/services/label.commands";

export interface TaskLabel {
  id: string;
  name: string;
  color: LabelColor;
}

const COLOR_LABELS: Record<LabelColor, string> = {
  neutral: "Grey",
  brand: "Green",
  info: "Blue",
  success: "Teal",
  warning: "Amber",
  danger: "Red",
};

/**
 * Labels on a task (P0-TSK-08).
 *
 * The filter bar has offered a label picker since #30 and it has never had
 * anything to offer: nothing in the product wrote to `label` or `task_label`.
 * This is the write path. Creating a label is staff-only and the database
 * says so; the form is shown to everyone who can tag, because hiding it would
 * turn a clear refusal into a control that is simply missing for reasons
 * nobody can see.
 */
export function TaskLabels({
  taskId,
  attached,
  available,
  canEdit,
  onChanged,
}: {
  taskId: string;
  attached: TaskLabel[];
  available: TaskLabel[];
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<LabelColor>("neutral");

  const attachedIds = new Set(attached.map((label) => label.id));
  const selectable = available.filter((label) => !attachedIds.has(label.id));

  function attach(labelId: string) {
    startTransition(async () => {
      const result = await attachTaskLabel({ taskId, labelId });
      if (!result.ok) {
        toast(result.error ?? "Could not add that label.", { tone: "error" });
        return;
      }
      setChoice("");
      setAdding(false);
      await onChanged();
    });
  }

  function detach(label: TaskLabel) {
    startTransition(async () => {
      const result = await detachTaskLabel({ taskId, labelId: label.id });
      if (!result.ok) {
        toast(result.error ?? "Could not remove that label.", { tone: "error" });
        return;
      }
      await onChanged();
    });
  }

  function createAndAttach() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const created = await createLabel({ name, color: newColor });
      if (!created.ok || !created.id) {
        toast(created.error ?? "Could not create the label.", { tone: "error" });
        return;
      }
      // Creating a label from inside a task means "put this on this task".
      // Making that two steps is how a label ends up created and unused.
      const linked = await attachTaskLabel({ taskId, labelId: created.id });
      if (!linked.ok) {
        toast(linked.error ?? "Label created, but not added to this task.", {
          tone: "error",
        });
        return;
      }
      setNewName("");
      setNewColor("neutral");
      setAdding(false);
      await onChanged();
    });
  }

  return (
    <section aria-labelledby="drawer-labels">
      <h3 id="drawer-labels" className="section-heading mb-2">
        Labels
      </h3>

      {attached.length === 0 ? (
        <p className="text-[13px] text-muted">
          No labels. A label is how this task is found from the filter bar
          alongside others like it.
        </p>
      ) : (
        <ul className="flex flex-wrap items-center gap-1.5">
          {attached.map((label) => (
            <li key={label.id}>
              <Badge tone={label.color}>
                {label.name}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => detach(label)}
                    disabled={pending}
                    aria-label={`Remove label ${label.name}`}
                    className="ml-0.5 rounded-full p-0.5 transition-opacity hover:opacity-70 disabled:opacity-50"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                ) : null}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        adding ? (
          <div className="mt-2.5 space-y-3 rounded-(--radius-sm) border border-line bg-surface-soft/50 p-3">
            {selectable.length > 0 ? (
              <div>
                <Label htmlFor="task-label-existing">Add an existing label</Label>
                <div className="flex items-center gap-2">
                  <Select
                    id="task-label-existing"
                    value={choice}
                    onChange={(event) => setChoice(event.target.value)}
                    className="h-9 text-[13px]"
                  >
                    <option value="">Choose a label…</option>
                    {selectable.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => choice && attach(choice)}
                    disabled={!choice || pending}
                  >
                    Add
                  </Button>
                </div>
              </div>
            ) : null}

            <div>
              <Label htmlFor="task-label-new">Or make a new one</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="task-label-new"
                  value={newName}
                  maxLength={40}
                  placeholder="Fundraising"
                  onChange={(event) => setNewName(event.target.value)}
                  className="h-9 text-[13px]"
                />
                <Select
                  aria-label="Label colour"
                  value={newColor}
                  onChange={(event) => setNewColor(event.target.value as LabelColor)}
                  className="h-9 w-auto text-[13px]"
                >
                  {LABEL_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {COLOR_LABELS[color]}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  size="sm"
                  onClick={createAndAttach}
                  disabled={!newName.trim() || pending}
                >
                  Create
                </Button>
              </div>
              <p className="mt-1 text-[12.5px] text-muted">
                Labels belong to the whole organization, so everyone can filter
                by this one afterwards. Creating one is a staff action.
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2.5"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add label
          </Button>
        )
      ) : null}
    </section>
  );
}
