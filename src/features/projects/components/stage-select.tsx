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
        {(Object.keys(STAGE_LABELS) as ProjectStage[])
          // `completed` is not offered as a destination: updateProjectStage
          // refuses it, because closing a project has to capture results and
          // check for unresolved work. Offering it only produced an inline
          // error. It stays in the list when the project is already completed,
          // or the control would show no value at all for a closed project.
          .filter((s) => s !== "completed" || value === "completed")
          .map((s) => (
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
