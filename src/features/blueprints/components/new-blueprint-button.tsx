"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyBlueprint, type Blueprint } from "../schema";
import { saveBlueprint } from "../services/blueprint.commands";

/** Saves a blank draft (or a copy of a starter) with a free key, then opens it in the designer. */
export function NewBlueprintButton({
  label,
  takenKeys,
  from,
  variant = "primary",
}: {
  label: string;
  takenKeys: string[];
  /** A starter to copy; a blank blueprint when left out. */
  from?: Blueprint;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function create() {
    const blueprint = from ? structuredClone(from) : emptyBlueprint();
    const base = blueprint.key;
    const taken = new Set(takenKeys);
    for (let n = 2; taken.has(blueprint.key); n += 1) blueprint.key = `${base}_${n}`;
    startTransition(async () => {
      const result = await saveBlueprint(null, blueprint);
      if (result.ok) router.push(`/builder/${result.value.id}`);
      else setError(result.error);
    });
  }

  return (
    <div className={from ? "flex flex-col items-start gap-1" : "flex flex-col items-end gap-1"}>
      <Button type="button" variant={variant} onClick={create} loading={pending}>
        {from ? null : <Plus className="size-4" aria-hidden />}
        {label}
      </Button>
      <p role="status" className="text-[12.5px] text-danger-fg">{error}</p>
    </div>
  );
}
