"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { createTask } from "@/features/tasks/services/task.commands";
import { createTaskSeries } from "@/features/tasks/services/planning.commands";
import { BULK_STATUSES, taskPriorityText, taskStatusText } from "@/features/tasks/schemas";
import { useT } from "@/lib/i18n/client";

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
  triggerLabel,
}: {
  projects: Option[];
  people: Option[];
  milestones?: MilestoneOption[];
  defaultProjectId?: string;
  defaultOpen?: boolean;
  triggerLabel?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  // A repeating task is still a task, so it is made here rather than behind a
  // separate "new recurring task" entry point nobody would find. Held in state
  // because it decides which command runs and whether an owner is required.
  const [repeats, setRepeats] = useState("");

  // Milestones are a property of the chosen project. Offering all of them and
  // rejecting the mismatch at the database would be a worse way to say so.
  const projectMilestones = milestones.filter((m) => m.projectId === projectId);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);

    // A recurring task is created as a series, so it has an owner who is
    // answerable for it and a switch that stops it. The series carries the
    // rest of the form onto its first occurrence rather than discarding it.
    if (repeats) {
      const ownerId = (form.get("assigneeId") as string) || "";
      if (!ownerId) {
        setSaving(false);
        setError(t("tasks.create.needsAssignee"));
        return;
      }
      const seriesResult = await createTaskSeries({
        title: form.get("title"),
        projectId: (form.get("projectId") as string) || undefined,
        milestoneId: (form.get("milestoneId") as string) || undefined,
        description: (form.get("description") as string) || undefined,
        priority: form.get("priority"),
        recurrenceRule: repeats,
        ownerId,
        startsOn: (form.get("dueAt") as string) || undefined,
      });
      setSaving(false);
      if (!seriesResult.ok) {
        setError(seriesResult.error ?? t("tasks.create.genericError"));
        return;
      }
      setRepeats("");
      closeDialog();
      router.refresh();
      return;
    }

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
      approverId: (form.get("approverId") as string) || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("tasks.create.genericError"));
      return;
    }
    closeDialog();
    router.refresh();
  }

  /**
   * The address that opened this dialog outlives the dialog. Leaving
   * `create=task` in it means a refresh — or a link someone shares after
   * creating a task — reopens an empty form over the work that is already
   * saved.
   */
  function closeDialog() {
    setOpen(false);
    const url = new URL(window.location.href);
    if (!url.searchParams.has("create")) return;
    url.searchParams.delete("create");
    // replaceState, not router.replace: dropping a parameter that only decided
    // whether this dialog started open needs no server round trip, and a
    // navigation still in flight would leave the parameter in the address if
    // the page were reloaded in the meantime — which is the exact refresh this
    // is meant to survive.
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {triggerLabel ?? t("tasks.create.trigger")}
      </Button>
      <Dialog open={open} onClose={closeDialog} title={t("tasks.create.title")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="task-title">{t("tasks.create.fieldTitle")}</Label>
            <Input id="task-title" name="title" required maxLength={300} autoFocus />
          </div>
          <div>
            <Label htmlFor="task-description">
              {t("tasks.create.description")} <span className="font-normal text-muted">{t("tasks.create.optional")}</span>
            </Label>
            <Textarea id="task-description" name="description" maxLength={5000} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="task-project">{t("tasks.create.project")}</Label>
              <Select
                id="task-project"
                name="projectId"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">{t("tasks.noProject")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="task-milestone">
                {t("tasks.create.milestone")} <span className="font-normal text-muted">{t("tasks.create.optional")}</span>
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
                      ? t("tasks.create.noMilestonesOnProject")
                      : t("tasks.create.noMilestone")
                    : t("tasks.create.chooseProjectFirst")}
                </option>
                {projectMilestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="task-assignee">{t("tasks.create.assignee")}</Label>
              <Select id="task-assignee" name="assigneeId" defaultValue="">
                <option value="">{t("tasks.unassigned")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="task-priority">{t("tasks.create.priority")}</Label>
              <Select id="task-priority" name="priority" defaultValue="medium">
                {(["low", "medium", "high", "critical"] as const).map((p) => (
                  <option key={p} value={p}>
                    {taskPriorityText(p, t)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="task-due">{repeats ? t("tasks.create.firstDue") : t("tasks.create.due")}</Label>
              <Input id="task-due" name="dueAt" type="date" />
              {repeats ? (
                <p className="mt-1 text-[12.5px] text-muted">
                  {t("tasks.create.firstDueHint")}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="task-repeats">{t("tasks.create.repeats")}</Label>
              <Select
                id="task-repeats"
                name="repeats"
                value={repeats}
                onChange={(e) => setRepeats(e.target.value)}
              >
                <option value="">{t("tasks.create.doesNotRepeat")}</option>
                <option value="weekly">{t("tasks.create.weekly")}</option>
                <option value="monthly">{t("tasks.create.monthly")}</option>
              </Select>
              {repeats ? (
                <p className="mt-1 text-[12.5px] text-muted">
                  {t("tasks.create.seriesHint")}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="task-status">{t("tasks.create.status")}</Label>
              <Select id="task-status" name="status" defaultValue="not_started">
                {BULK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {taskStatusText(s, t)}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[12.5px] text-muted">
                {t("tasks.create.statusHint")}
              </p>
            </div>
            <div>
              <Label htmlFor="task-reviewer">
                {t("tasks.create.reviewer")} <span className="font-normal text-muted">{t("tasks.create.optional")}</span>
              </Label>
              <Select id="task-reviewer" name="reviewerId" defaultValue="">
                <option value="">{t("tasks.create.noReviewer")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="task-approver">
                {t("tasks.create.approver")} <span className="font-normal text-muted">{t("tasks.create.optional")}</span>
              </Label>
              <Select id="task-approver" name="approverId" defaultValue="">
                <option value="">{t("tasks.create.noApprover")}</option>
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
              {t("tasks.create.criteria")}{" "}
              <span className="font-normal text-muted">{t("tasks.create.optional")}</span>
            </Label>
            <Textarea
              id="task-criteria"
              name="completionCriteria"
              maxLength={2000}
              rows={2}
            />
            <p className="mt-1 text-[12.5px] text-muted">
              {t("tasks.create.criteriaHint")}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={closeDialog}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {repeats ? t("tasks.create.createRecurring") : t("tasks.create.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
