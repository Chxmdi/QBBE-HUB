"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { createTask } from "@/features/tasks/services/task.commands";

export interface Option {
  id: string;
  label: string;
}

export function TaskCreateDialog({
  projects,
  people,
  defaultProjectId,
  defaultOpen = false,
  triggerLabel = "New task",
}: {
  projects: Option[];
  people: Option[];
  defaultProjectId?: string;
  defaultOpen?: boolean;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await createTask({
      title: form.get("title"),
      description: (form.get("description") as string) || undefined,
      projectId: (form.get("projectId") as string) || undefined,
      assigneeId: (form.get("assigneeId") as string) || undefined,
      priority: form.get("priority"),
      dueAt: (form.get("dueAt") as string) || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {triggerLabel}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Create task">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="task-title">Title</Label>
            <Input id="task-title" name="title" required maxLength={300} autoFocus />
          </div>
          <div>
            <Label htmlFor="task-description">
              Description <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Textarea id="task-description" name="description" maxLength={5000} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="task-project">Project</Label>
              <Select id="task-project" name="projectId" defaultValue={defaultProjectId ?? ""}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="task-assignee">Assignee</Label>
              <Select id="task-assignee" name="assigneeId" defaultValue="">
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="task-priority">Priority</Label>
              <Select id="task-priority" name="priority" defaultValue="medium">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="task-due">Due date</Label>
              <Input id="task-due" name="dueAt" type="date" />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create task
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
