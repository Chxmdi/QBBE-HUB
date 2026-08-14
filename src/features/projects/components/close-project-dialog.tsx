"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  closeProject,
  getUnresolvedWork,
  type UnresolvedWork,
} from "@/features/projects/services/project.commands";

/**
 * Closure flow that surfaces unresolved work before confirmation
 * (§10.5 acceptance, P0-PRJ-08).
 */
export function CloseProjectDialog({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [unresolved, setUnresolved] = useState<UnresolvedWork | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    setUnresolved(null);
    const work = await getUnresolvedWork(projectId);
    setUnresolved(work);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await closeProject({
      projectId,
      results: form.get("results"),
      lessons: (form.get("lessons") as string) || undefined,
      archiveOpenTasks: archiveOpen,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not close the project.");
      return;
    }
    toast(`“${projectName}” is closed.`);
    setOpen(false);
    router.refresh();
  }

  const hasOpenWork =
    unresolved !== null &&
    (unresolved.openTasks > 0 || unresolved.openMilestones > 0);

  return (
    <>
      <Button variant="secondary" onClick={openDialog}>
        Close project
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Close “${projectName}”`}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Unresolved work, surfaced before the decision */}
          {unresolved === null ? (
            <p className="text-[13.5px] text-muted">Checking for open work…</p>
          ) : hasOpenWork ? (
            <div className="rounded-(--radius-sm) border border-warning/30 bg-warning/10 p-3">
              <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-warning-fg">
                <AlertTriangle className="size-4" aria-hidden />
                This project still has open work
              </p>
              <ul className="mt-1.5 space-y-0.5 text-[13px]">
                {unresolved.openTasks > 0 ? (
                  <li>
                    {unresolved.openTasks} open{" "}
                    {unresolved.openTasks === 1 ? "task" : "tasks"}
                    {unresolved.blockedTasks > 0
                      ? ` (${unresolved.blockedTasks} blocked)`
                      : ""}
                  </li>
                ) : null}
                {unresolved.openMilestones > 0 ? (
                  <li>
                    {unresolved.openMilestones} incomplete{" "}
                    {unresolved.openMilestones === 1 ? "milestone" : "milestones"}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 rounded-(--radius-sm) bg-success/10 px-3 py-2 text-[13.5px] text-success-fg">
              <CheckCircle2 className="size-4" aria-hidden />
              No open tasks or milestones remain.
            </p>
          )}

          <div>
            <Label htmlFor="close-results">What did this project deliver?</Label>
            <Textarea
              id="close-results"
              name="results"
              required
              rows={3}
              maxLength={5000}
              placeholder="Outcomes achieved, numbers reached, what changed."
            />
          </div>
          <div>
            <Label htmlFor="close-lessons">
              Lessons learned{" "}
              <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Textarea id="close-lessons" name="lessons" rows={2} maxLength={5000} />
          </div>

          {hasOpenWork ? (
            <label className="flex items-start gap-2.5 text-[13.5px]">
              <input
                type="checkbox"
                checked={archiveOpen}
                onChange={(e) => setArchiveOpen(e.target.checked)}
                className="mt-0.5 size-4 accent-(--color-brand)"
              />
              <span>
                Archive the {unresolved?.openTasks ?? 0} remaining open{" "}
                {unresolved?.openTasks === 1 ? "task" : "tasks"}
                <span className="block text-muted">
                  History and attribution are preserved. Leave unchecked to keep
                  them active elsewhere.
                </span>
              </span>
            </label>
          ) : null}

          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={unresolved === null}>
              Close project
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
