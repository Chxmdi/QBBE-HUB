"use client";

import { useRouter } from "next/navigation";
import { Label, Select } from "@/components/ui/input";
import type { WorkflowsMessages } from "../i18n";
import { runOutcomes, type RunOutcomeFilter } from "../run-outcomes";

/** Narrows the run history to one outcome through the page's query string. */
export function OutcomeFilter({ value, m }: { value: RunOutcomeFilter | null; m: WorkflowsMessages }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="history-outcome" className="mb-0">{m.history.filter}</Label>
      <Select
        id="history-outcome"
        className="w-48"
        value={value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          const url = new URL(window.location.href);
          if (next) url.searchParams.set("outcome", next);
          else url.searchParams.delete("outcome");
          router.push(`${url.pathname}${url.search}`);
        }}
      >
        <option value="">{m.history.all}</option>
        {runOutcomes.map((outcome) => <option key={outcome} value={outcome}>{m.outcomes[outcome]}</option>)}
      </Select>
    </div>
  );
}
