"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createProjectFromTemplate } from "@/features/admin/services/workflow.commands";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";

/**
 * Choosing a template only selects it; Create makes the project. The select
 * used to create one on every change, so arrow keys (which change a closed
 * select in Chrome and Edge) or a second choice made several projects with
 * all their tasks.
 */
export function CreateFromTemplateButton({
  templates,
}: {
  templates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const t = useT();
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // State updates land after the next render; a double click arrives before.
  const running = useRef(false);

  if (templates.length === 0) return null;

  async function create() {
    if (!templateId || running.current) return;
    running.current = true;
    const result = await runServerAction(() => createProjectFromTemplate(templateId), {
      setBusy,
      setError,
      t,
      reload: () => window.location.reload(),
    });
    running.current = false;
    if (!result) return;
    if (!result.ok) {
      setError(result.error ?? t("projects.fromTemplate.error"));
      return;
    }
    if (result.id) router.push(`/projects/${result.id}`);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor="project-template">
          {t("projects.fromTemplate.label")}
        </label>
        <Select
          id="project-template"
          className="h-9 w-auto px-2 text-[13px]"
          value={templateId}
          disabled={busy}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">{t("projects.fromTemplate.placeholder")}</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void create()}
          disabled={!templateId}
          loading={busy}
          aria-label={t("projects.fromTemplate.createLabel")}
        >
          {t("projects.fromTemplate.create")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
