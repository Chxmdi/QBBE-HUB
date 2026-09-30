"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyBlueprint } from "../schema";
import { saveBlueprint } from "../services/blueprint.commands";

/** Saves a blank draft with a free key, then opens it in the designer. */
export function NewBlueprintButton({ label, takenKeys }: { label: string; takenKeys: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function create() {
    const blueprint = emptyBlueprint();
    const taken = new Set(takenKeys);
    for (let n = 2; taken.has(blueprint.key); n += 1) blueprint.key = `new_blueprint_${n}`;
    startTransition(async () => {
      const result = await saveBlueprint(null, blueprint);
      if (result.ok) router.push(`/builder/${result.value.id}`);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" onClick={create} loading={pending}>
        <Plus className="size-4" aria-hidden />
        {label}
      </Button>
      <p role="status" className="text-[12.5px] text-danger-fg">{error}</p>
    </div>
  );
}
