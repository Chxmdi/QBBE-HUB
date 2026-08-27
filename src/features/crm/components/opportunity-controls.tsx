"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  OPPORTUNITY_STAGES,
  SETTLED_STAGES,
  STAGE_LABELS,
  type OpportunityStage,
} from "@/features/crm/opportunity-schemas";
import { updateOpportunity } from "@/features/crm/services/opportunity.commands";

/**
 * Moving one bid along the pipeline.
 *
 * A stage change is the only edit anybody makes often, so it is the only one
 * inline. Which fields appear depends on where the bid is going: an award asks
 * for the amount, a refusal asks for the reason, and both ask for the date the
 * answer arrived. That mirrors the CHECK constraints exactly — the point is
 * that the form asks before the database refuses.
 */
export function OpportunityControls({
  opportunityId,
  stage,
  currency,
  outcomeNote,
}: {
  opportunityId: string;
  stage: OpportunityStage;
  currency: string;
  outcomeNote: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nextStage, setNextStage] = React.useState<OpportunityStage>(stage);

  const settling = SETTLED_STAGES.includes(nextStage);
  const awarding = nextStage === "awarded";
  const refusing = settling && !awarding;
  const today = new Date().toISOString().slice(0, 10);

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Move stage
        </Button>
        {error ? <span className="text-[12.5px] text-danger-fg">{error}</span> : null}
      </div>
    );
  }

  return (
    <form
      className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const amount = String(form.get("amountAwarded") ?? "").trim();
        const note = String(form.get("outcomeNote") ?? "").trim();
        const decided = String(form.get("decidedAt") ?? "").trim();

        setBusy(true);
        setError(null);
        const result = await updateOpportunity({
          opportunityId,
          stage: nextStage,
          ...(awarding && amount ? { amountAwarded: Number(amount) } : {}),
          ...(refusing && note ? { outcomeNote: note } : {}),
          ...(settling ? { decidedAt: decided || today } : {}),
        });
        setBusy(false);

        if (!result.ok) {
          setError(result.error ?? "That didn't work. Try again.");
          return;
        }
        setOpen(false);
        router.refresh();
      }}
    >
      <div>
        <Label htmlFor={`stage-${opportunityId}`}>Stage</Label>
        <Select
          id={`stage-${opportunityId}`}
          value={nextStage}
          onChange={(event) =>
            setNextStage(event.currentTarget.value as OpportunityStage)
          }
        >
          {OPPORTUNITY_STAGES.map((value) => (
            <option key={value} value={value}>
              {STAGE_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      {settling ? (
        <div>
          <Label htmlFor={`decided-${opportunityId}`}>Decided on</Label>
          <Input
            id={`decided-${opportunityId}`}
            name="decidedAt"
            type="date"
            defaultValue={today}
          />
        </div>
      ) : null}

      {awarding ? (
        <div>
          <Label htmlFor={`awarded-${opportunityId}`}>
            Amount awarded ({currency})
          </Label>
          <Input
            id={`awarded-${opportunityId}`}
            name="amountAwarded"
            type="number"
            min="0"
            step="0.01"
            required
          />
        </div>
      ) : null}

      {refusing ? (
        <div className="sm:col-span-2">
          <Label htmlFor={`outcome-${opportunityId}`}>
            Why? This shapes the next application to them.
          </Label>
          <Textarea
            id={`outcome-${opportunityId}`}
            name="outcomeNote"
            rows={2}
            required
            defaultValue={outcomeNote ?? ""}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setNextStage(stage);
            setError(null);
          }}
        >
          Cancel
        </Button>
        {error ? (
          <span role="alert" className="text-[12.5px] text-danger-fg">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
