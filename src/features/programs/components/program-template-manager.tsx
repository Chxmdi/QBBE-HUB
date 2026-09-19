"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import {
  addProjectTemplateToProgram,
  removeProjectTemplateFromProgram,
  setProgramTemplateApproval,
} from "@/features/programs/services/program-template.commands";

type ProgramTemplate = {
  id: string;
  name: string;
  description: string | null;
  approved_at: string | null;
  projects: { project_template: { id: string; name: string } | null }[];
};

/**
 * Administrator maintenance for the approved program structures.
 *
 * Approval is the gate the requirement cares about: a template that has not
 * been approved is drafted here but is not offered as something to build a
 * program from.
 */
export function ProgramTemplateManager({
  templates,
  projectTemplates,
}: {
  templates: ProgramTemplate[];
  projectTemplates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, work: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(key);
    setError(null);
    const result = await work();
    setPending(null);
    if (!result.ok) {
      setError(result.error ?? "Could not update the template.");
      return;
    }
    router.refresh();
  }

  if (templates.length === 0) {
    return (
      <p className="card px-4 py-6 text-center text-[13px] text-muted">
        No program templates yet. Save one to define a reusable structure.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <ul className="card divide-y divide-line">
        {templates.map((template) => {
          const contained = template.projects
            .map((row) => row.project_template)
            .filter((value): value is { id: string; name: string } => Boolean(value));
          const available = projectTemplates.filter(
            (candidate) => !contained.some((held) => held.id === candidate.id),
          );
          return (
            <li key={template.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium">{template.name}</span>
                <span
                  className={
                    template.approved_at
                      ? "text-[12px] text-success-fg"
                      : "text-[12px] text-muted"
                  }
                >
                  {template.approved_at ? "Approved" : "Not approved"}
                </span>
                <Button
                  variant="secondary"
                  className="ml-auto"
                  disabled={pending === template.id}
                  onClick={() =>
                    void run(template.id, () =>
                      setProgramTemplateApproval(template.id, !template.approved_at),
                    )
                  }
                >
                  {template.approved_at ? "Withdraw approval" : "Approve"}
                </Button>
              </div>

              {contained.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {contained.map((project) => (
                    <li
                      key={project.id}
                      className="flex items-center gap-1.5 rounded-(--radius-sm) border border-line px-2 py-1 text-[12.5px]"
                    >
                      {project.name}
                      <button
                        type="button"
                        className="text-muted hover:text-danger-fg"
                        aria-label={`Remove ${project.name} from ${template.name}`}
                        disabled={pending === template.id}
                        onClick={() =>
                          void run(template.id, () =>
                            removeProjectTemplateFromProgram({
                              programTemplateId: template.id,
                              projectTemplateId: project.id,
                            }),
                          )
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta">
                  No project templates yet: this would create an empty program.
                </p>
              )}

              {available.length > 0 ? (
                <div>
                  <Label htmlFor={`add-${template.id}`} className="sr-only">
                    Add a project template to {template.name}
                  </Label>
                  <Select
                    id={`add-${template.id}`}
                    defaultValue=""
                    disabled={pending === template.id}
                    onChange={(event) => {
                      const projectTemplateId = event.target.value;
                      if (!projectTemplateId) return;
                      event.target.value = "";
                      void run(template.id, () =>
                        addProjectTemplateToProgram({
                          programTemplateId: template.id,
                          projectTemplateId,
                        }),
                      );
                    }}
                  >
                    <option value="">Add a project template…</option>
                    {available.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
