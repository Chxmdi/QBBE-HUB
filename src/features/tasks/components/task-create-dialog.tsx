"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { createTask } from "@/features/tasks/services/task.commands";
import { BULK_STATUSES, TASK_STATUS_LABELS } from "@/features/tasks/schemas";

export interface Option {
  id: string;
  label: string;
}

/** A milestone belongs to one project, so it is only offerable with it. */
export interface MilestoneOption extends Option {
  projectId: string;
}

export function TaskCreateDialog({
  projects,
  people,
  milestones = [],
  defaultProjectId,
  defaultOpen = false,
  triggerLabel = "New task",
}: {
  projects: Option[];
  people: Option[];
  milestones?: MilestoneOption[];
  defaultProjectId?: string;
  defaultOpen?: boolean;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");

  // Milestones are a property of the chosen project. Offering all of them and
  // rejecting the mismatch at the database would be a worse way to say so.
  const projectMilestones = milestones.filter((m) => m.projectId === projectId);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await createTask({
      title: form.get("title"),
      description: (form.get("description") as string) || undefined,
      projectId: (form.get("projectId") as string) || undefined,
      milestoneId: (form.get("milestoneId") as string) || undefined,
      assigneeId: (form.get("assigneeId") as string) || undefined,
      priority: form.get("priority"),
      status: (form.get("status") as string) || undefined,
      dueAt: (form.get("dueAt") as string) || undefined,
      completionCriteria: (form.get("completionCriteria") as string) || undefined,
      reviewerId: (form.get("reviewerId") as string) || undefined,
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
              <Select
                id="task-project"
                name="projectId"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="task-milestone">
                Milestone <span className="font-normal text-muted">(optional)</span>
              </Label>
              <Select
                id="task-milestone"
                name="milestoneId"
                defaultValue=""
                disabled={projectMilestones.length === 0}
              >
                <option value="">
                  {projectId
                    ? projectMilestones.length === 0
                      ? "No milestones on this project"
                      : "No milestone"
                    : "Choose a project first"}
                </option>
                {projectMilestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
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
            <div>
              <Label htmlFor="task-status">Status</Label>
              <Select id="task-status" name="status" defaultValue="not_started">
                {BULK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[12.5px] text-muted">
                Blocked needs a reason, so it is set on the task itself.
              </p>
            </div>
            <div>
              <Label htmlFor="task-reviewer">
                Reviewer <span className="font-normal text-muted">(optional)</span>
              </Label>
              <Select id="task-reviewer" name="reviewerId" defaultValue="">
                <option value="">No reviewer</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="task-criteria">
              Completion criteria{" "}
              <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Textarea
              id="task-criteria"
              name="completionCriteria"
              maxLength={2000}
              rows={2}
            />
            <p className="mt-1 text-[12.5px] text-muted">
              What has to be true before this counts as done.
            </p>
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
