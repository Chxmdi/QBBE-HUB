"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { Option } from "@/features/tasks/components/task-create-dialog";
import { createProject } from "@/features/projects/services/project.commands";

export function ProjectCreateDialog({
  programs,
  people,
  defaultOpen = false,
}: {
  programs: Option[];
  people: Option[];
  defaultOpen?: boolean;
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
    const result = await createProject({
      name: form.get("name"),
      outcome: (form.get("outcome") as string) || undefined,
      programId: (form.get("programId") as string) || undefined,
      ownerId: (form.get("ownerId") as string) || undefined,
      startDate: (form.get("startDate") as string) || undefined,
      targetDate: (form.get("targetDate") as string) || undefined,
      stage: form.get("stage"),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setOpen(false);
    if (result.id) router.push(`/projects/${result.id}`);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        New project
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Create project">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" name="name" required maxLength={200} autoFocus />
          </div>
          <div>
            <Label htmlFor="project-outcome">Intended outcome</Label>
            <Textarea
              id="project-outcome"
              name="outcome"
              maxLength={2000}
              placeholder="What clear result should this project deliver?"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="project-program">Program</Label>
              <Select id="project-program" name="programId" defaultValue="">
                <option value="">No program</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="project-owner">Accountable owner</Label>
              <Select id="project-owner" name="ownerId" defaultValue="">
                <option value="">Me</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="project-start">Start date</Label>
              <Input id="project-start" name="startDate" type="date" />
            </div>
            <div>
              <Label htmlFor="project-target">Target date</Label>
              <Input id="project-target" name="targetDate" type="date" />
            </div>
            <div>
              <Label htmlFor="project-stage">Stage</Label>
              <Select id="project-stage" name="stage" defaultValue="planning">
                <option value="proposed">Proposed</option>
                <option value="approved">Approved</option>
                <option value="planning">Planning</option>
                <option value="active">Active</option>
              </Select>
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
              Create project
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
