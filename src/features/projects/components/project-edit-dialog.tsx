"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { updateProject } from "@/features/projects/services/project.commands";

type Option = { id: string; label: string };

/**
 * Editing a project after creation. Everything the create dialog collects is
 * changeable here except health, which is only ever set by publishing a status
 * update — that is what keeps "adverse health requires a reason" enforceable.
 */
export function ProjectEditDialog({
  project,
  programs,
  people,
  funders = [],
}: {
  project: {
    id: string;
    name: string;
    outcome: string | null;
    description: string | null;
    program_id: string | null;
    owner_id: string | null;
    sponsor_id: string | null;
    start_date: string | null;
    target_date: string | null;
    priority: string | null;
    reporting_cadence: string | null;
    funding_source_id: string | null;
  };
  programs: Option[];
  people: Option[];
  funders?: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const result = await updateProject({
        projectId: project.id,
        name: form.get("name"),
        outcome: form.get("outcome"),
        description: form.get("description"),
        programId: form.get("programId"),
        ownerId: form.get("ownerId"),
        sponsorId: form.get("sponsorId"),
        startDate: form.get("startDate"),
        targetDate: form.get("targetDate"),
        priority: form.get("priority"),
        reportingCadence: form.get("reportingCadence"),
        fundingSourceId: form.get("fundingSourceId"),
      });
      if (!result.ok) {
        setError(result.error ?? "Could not save the project.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not save the project. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => { setError(null); setOpen(true); }}>
        Edit project
      </Button>
      <Dialog
        open={open}
        onClose={() => { if (!saving) setOpen(false); }}
        title="Edit project"
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="edit-project-name">Name</Label>
            <Input
              id="edit-project-name"
              name="name"
              defaultValue={project.name}
              required
              maxLength={200}
            />
          </div>
          <div>
            <Label htmlFor="edit-project-outcome">Outcome</Label>
            <Textarea
              id="edit-project-outcome"
              name="outcome"
              defaultValue={project.outcome ?? ""}
              maxLength={2000}
            />
          </div>
          <div>
            <Label htmlFor="edit-project-description">Description</Label>
            <Textarea
              id="edit-project-description"
              name="description"
              defaultValue={project.description ?? ""}
              maxLength={4000}
            />
          </div>
          <div>
            <Label htmlFor="edit-project-program">Program</Label>
            <Select
              id="edit-project-program"
              name="programId"
              defaultValue={project.program_id ?? ""}
            >
              <option value="">No program</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>{program.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-project-owner">Owner</Label>
            <Select
              id="edit-project-owner"
              name="ownerId"
              defaultValue={project.owner_id ?? ""}
              required
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.label}</option>
              ))}
            </Select>
            <p className="mt-1 text-[12.5px] text-muted">
              One accountable owner. They can manage this project.
            </p>
          </div>
          <div>
            <Label htmlFor="edit-project-sponsor">Sponsor</Label>
            <Select
              id="edit-project-sponsor"
              name="sponsorId"
              defaultValue={project.sponsor_id ?? ""}
            >
              <option value="">No sponsor</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.label}</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-project-start">Start date</Label>
              <Input
                id="edit-project-start"
                name="startDate"
                type="date"
                defaultValue={project.start_date ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="edit-project-target">Target date</Label>
              <Input
                id="edit-project-target"
                name="targetDate"
                type="date"
                defaultValue={project.target_date ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-project-priority">Priority</Label>
              <Select
                id="edit-project-priority"
                name="priority"
                defaultValue={project.priority ?? "medium"}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-project-cadence">Reporting cadence</Label>
              <Select
                id="edit-project-cadence"
                name="reportingCadence"
                defaultValue={project.reporting_cadence ?? "none"}
              >
                <option value="none">No set cadence</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="edit-project-funding">Funding source</Label>
            <Select
              id="edit-project-funding"
              name="fundingSourceId"
              defaultValue={project.funding_source_id ?? ""}
            >
              <option value="">None</option>
              {funders.map((funder) => (
                <option key={funder.id} value={funder.id}>{funder.label}</option>
              ))}
            </Select>
          </div>
          <p className="text-sm text-muted">
            Health is set by publishing a status update, so that marking a
            project at risk always carries a reason.
          </p>
          {error ? <p role="alert" className="text-sm text-danger-fg">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={saving}>Save project</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
