"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  addProjectTemplateItem,
  removeProjectTemplateItem,
} from "@/features/admin/services/workflow.commands";

type TemplateItem = {
  id: string;
  kind: "milestone" | "task";
  name: string;
  day_offset: number | null;
  sort_key: number;
};

type ProjectTemplate = {
  id: string;
  name: string;
  outcome: string | null;
  default_stage: string;
  items: TemplateItem[];
};

/**
 * The structure a project template reproduces (P1-PRJ-09).
 *
 * Until this existed a template carried a name, an outcome and a stage, so
 * "create from template" saved one form field and nothing else. The work a
 * repeated project actually repeats is its milestones and its standard tasks,
 * and those are what this edits.
 *
 * Dates are day offsets, never dates: a template is used more than once, so a
 * stored date would be the date of whoever used it first.
 */
export function ProjectTemplateManager({
  templates,
}: {
  templates: ProjectTemplate[];
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
      return false;
    }
    router.refresh();
    return true;
  }

  if (templates.length === 0) return null;

  return (
    <section aria-labelledby="project-template-structure" className="mt-8">
      <h2 id="project-template-structure" className="section-heading mb-3">
        Template structure
      </h2>
      {error ? (
        <p role="alert" className="mb-2 text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <ul className="card divide-y divide-line">
        {templates.map((template) => {
          const items = [...template.items].sort(
            (a, b) => a.sort_key - b.sort_key || a.name.localeCompare(b.name),
          );
          return (
            <li key={template.id} className="space-y-2 px-4 py-3">
              <p className="text-[13.5px] font-medium">{template.name}</p>

              {items.length === 0 ? (
                <p className="meta">
                  Nothing yet: a project built from this arrives empty.
                </p>
              ) : (
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-2 text-[13px]"
                    >
                      <span className="rounded-(--radius-sm) border border-line px-1.5 py-0.5 text-[12px] text-muted">
                        {item.kind === "milestone" ? "Milestone" : "Task"}
                      </span>
                      <span>{item.name}</span>
                      <span className="text-muted">
                        {item.day_offset === null
                          ? "no date"
                          : item.day_offset === 0
                            ? "on the start day"
                            : `day ${item.day_offset}`}
                      </span>
                      <button
                        type="button"
                        className="ml-auto text-muted hover:text-danger-fg"
                        aria-label={`Remove ${item.name} from ${template.name}`}
                        disabled={pending === template.id}
                        onClick={() =>
                          void run(template.id, () =>
                            removeProjectTemplateItem(item.id),
                          )
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const data = new FormData(form);
                  const offset = String(data.get("dayOffset") ?? "").trim();
                  const added = await run(template.id, () =>
                    addProjectTemplateItem({
                      projectTemplateId: template.id,
                      kind: data.get("kind"),
                      name: String(data.get("name") ?? "").trim(),
                      dayOffset: offset === "" ? null : offset,
                      sortKey: items.length,
                    }),
                  );
                  if (added) form.reset();
                }}
              >
                <div>
                  <Label htmlFor={`kind-${template.id}`}>Kind</Label>
                  <Select id={`kind-${template.id}`} name="kind" defaultValue="task">
                    <option value="task">Task</option>
                    <option value="milestone">Milestone</option>
                  </Select>
                </div>
                <div className="min-w-48 flex-1">
                  <Label htmlFor={`item-name-${template.id}`}>Name</Label>
                  <Input
                    id={`item-name-${template.id}`}
                    name="name"
                    required
                    maxLength={200}
                  />
                </div>
                <div className="w-28">
                  <Label htmlFor={`offset-${template.id}`}>Day</Label>
                  <Input
                    id={`offset-${template.id}`}
                    name="dayOffset"
                    type="number"
                    min={0}
                    max={3650}
                    placeholder="—"
                  />
                </div>
                <Button type="submit" size="sm" disabled={pending === template.id}>
                  Add
                </Button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
