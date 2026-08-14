"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Select } from "@/components/ui/input";
import { STAGE_LABELS } from "@/components/shared/status-badges";
import { updateProjectStage } from "@/features/projects/services/project.commands";
import type { ProjectStage } from "@/types/entities";

export function StageSelect({
  projectId,
  stage,
}: {
  projectId: string;
  stage: ProjectStage;
}) {
  const router = useRouter();
  const [value, setValue] = useState<ProjectStage>(stage);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: ProjectStage) {
    const previous = value;
    setValue(next);
    setError(null);
    const result = await updateProjectStage({ projectId, stage: next });
    if (!result.ok) {
      setValue(previous);
      setError(result.error ?? "Update failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <Select
        aria-label="Project stage"
        value={value}
        onChange={(e) => handleChange(e.target.value as ProjectStage)}
        className="h-8 w-36 text-[12.5px]"
      >
        {(Object.keys(STAGE_LABELS) as ProjectStage[]).map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </Select>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
