"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProgramFromTemplate } from "@/features/programs/services/program-template.commands";
import { Select } from "@/components/ui/input";

export function CreateProgramFromTemplateButton({
  templates,
}: {
  templates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (templates.length === 0) return null;

  async function handleChange(templateId: string) {
    if (!templateId) return;
    setBusy(true);
    setError(null);
    // Expanding a template writes a program, its projects, their milestones and
    // their tasks, so this is slower than it looks and must not be double-fired.
    const result = await createProgramFromTemplate(templateId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not use the template.");
      return;
    }
    if (result.id) router.push(`/programs/${result.id}`);
    router.refresh();
  }

  return (
    <div>
      <label className="sr-only" htmlFor="program-template">
        Create program from template
      </label>
      <Select
        id="program-template"
        className="h-9 w-auto px-2 text-[13px]"
        defaultValue=""
        disabled={busy}
        onChange={(e) => void handleChange(e.target.value)}
      >
        <option value="">{busy ? "Creating…" : "From template…"}</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      {error ? (
        <p role="alert" className="text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
