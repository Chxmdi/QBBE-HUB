"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProjectFromTemplate } from "@/features/admin/services/workflow.commands";
import { Select } from "@/components/ui/input";

export function CreateFromTemplateButton({
  templates,
}: {
  templates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (templates.length === 0) return null;

  async function handleChange(templateId: string) {
    if (!templateId) return;
    const result = await createProjectFromTemplate(templateId);
    if (!result.ok) {
      setError(result.error ?? "Could not use the template.");
      return;
    }
    if (result.id) router.push(`/projects/${result.id}`);
    router.refresh();
  }

  return (
    <div>
      <label className="sr-only" htmlFor="project-template">
        Create from template
      </label>
      <Select
        id="project-template"
        className="h-9 w-auto px-2 text-[13px]"
        defaultValue=""
        onChange={(e) => void handleChange(e.target.value)}
      >
        <option value="">From template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      {error ? <p className="text-[12px] text-danger-fg">{error}</p> : null}
    </div>
  );
}
