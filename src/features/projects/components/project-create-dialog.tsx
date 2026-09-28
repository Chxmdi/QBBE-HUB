"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { Option } from "@/features/tasks/components/task-create-dialog";
import { createProject } from "@/features/projects/services/project.commands";
import { priorityLabel, stageLabel } from "@/components/shared/status-badges";
import { useT } from "@/lib/i18n/client";

export function ProjectCreateDialog({
  programs,
  people,
  funders = [],
  defaultOpen = false,
}: {
  programs: Option[];
  people: Option[];
  funders?: Option[];
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const t = useT();
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
      description: (form.get("description") as string) || undefined,
      programId: (form.get("programId") as string) || undefined,
      ownerId: (form.get("ownerId") as string) || undefined,
      sponsorId: (form.get("sponsorId") as string) || undefined,
      startDate: (form.get("startDate") as string) || undefined,
      targetDate: (form.get("targetDate") as string) || undefined,
      priority: form.get("priority"),
      reportingCadence: form.get("reportingCadence"),
      fundingSourceId: (form.get("fundingSourceId") as string) || undefined,
      stage: form.get("stage"),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("projects.create.error"));
      return;
    }
    setOpen(false);
    if (result.id) {
      router.push(`/projects/${result.id}`);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {t("projects.create.open")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("projects.create.title")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="project-name">{t("projects.create.name")}</Label>
            <Input id="project-name" name="name" required maxLength={200} autoFocus />
          </div>
          <div>
            <Label htmlFor="project-outcome">{t("projects.create.outcome")}</Label>
            <Textarea
              id="project-outcome"
              name="outcome"
              maxLength={2000}
              placeholder={t("projects.create.outcomePlaceholder")}
            />
          </div>
          <div>
            <Label htmlFor="project-description">{t("projects.create.description")}</Label>
            <Textarea
              id="project-description"
              name="description"
              maxLength={5000}
              placeholder={t("projects.create.descriptionPlaceholder")}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="project-program">{t("projects.create.program")}</Label>
              <Select id="project-program" name="programId" defaultValue="">
                <option value="">{t("projects.create.noProgram")}</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="project-owner">{t("projects.create.owner")}</Label>
              <Select id="project-owner" name="ownerId" defaultValue="">
                <option value="">{t("projects.create.me")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="project-sponsor">{t("projects.create.sponsor")}</Label>
              <Select id="project-sponsor" name="sponsorId" defaultValue="">
                <option value="">{t("projects.create.noSponsor")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="project-priority">{t("projects.create.priority")}</Label>
              <Select id="project-priority" name="priority" defaultValue="medium">
                {(["low", "medium", "high", "critical"] as const).map((value) => (
                  <option key={value} value={value}>
                    {priorityLabel(value, t)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="project-start">{t("projects.create.startDate")}</Label>
              <Input id="project-start" name="startDate" type="date" />
            </div>
            <div>
              <Label htmlFor="project-target">{t("projects.create.targetDate")}</Label>
              <Input id="project-target" name="targetDate" type="date" />
            </div>
            <div>
              <Label htmlFor="project-cadence">{t("projects.create.cadence")}</Label>
              <Select id="project-cadence" name="reportingCadence" defaultValue="none">
                <option value="none">{t("projects.create.asNeeded")}</option>
                <option value="weekly">{t("projects.create.weekly")}</option>
                <option value="monthly">{t("projects.create.monthly")}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="project-funding">{t("projects.create.funding")}</Label>
              <Select id="project-funding" name="fundingSourceId" defaultValue="">
                <option value="">{t("projects.create.none")}</option>
                {funders.map((funder) => (
                  <option key={funder.id} value={funder.id}>
                    {funder.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="project-stage">{t("projects.create.stage")}</Label>
              <Select id="project-stage" name="stage" defaultValue="planning">
                {(["proposed", "approved", "planning", "active"] as const).map((value) => (
                  <option key={value} value={value}>
                    {stageLabel(value, t)}
                  </option>
                ))}
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
              {t("projects.create.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("projects.create.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
