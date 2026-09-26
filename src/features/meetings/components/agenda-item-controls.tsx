"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import {
  carryForwardAgendaItem,
  combineAgendaItem,
  removeAgendaItem,
} from "@/features/meetings/services/meeting.commands";

interface Option {
  id: string;
  label: string;
}

/**
 * Remove, combine and carry forward for one agenda item (P0-AGD-01/03,
 * P1-AGD-06). The database decides who may do each; these controls are shown
 * to the organizer's side of the meeting.
 */
export function AgendaItemControls({
  agendaItemId,
  title,
  status,
  otherItems,
  laterMeetings,
}: {
  agendaItemId: string;
  title: string;
  status: string;
  otherItems: Option[];
  laterMeetings: Option[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "combine" | "carry">("none");
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unfinished = !["done", "declined", "combined"].includes(status);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That did not work.");
      return;
    }
    setMode("none");
    setChoice("");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {mode === "none" ? (
        <>
          {unfinished && otherItems.length > 0 ? (
            <Button
              variant="ghost"
              onClick={() => setMode("combine")}
              aria-label={`Combine "${title}"`}
            >
              Combine
            </Button>
          ) : null}
          {unfinished && laterMeetings.length > 0 ? (
            <Button
              variant="ghost"
              onClick={() => setMode("carry")}
              aria-label={`Carry "${title}" forward`}
            >
              Carry forward
            </Button>
          ) : null}
          <Button
            variant="ghost"
            loading={busy}
            aria-label={`Remove "${title}"`}
            onClick={() => {
              if (window.confirm(`Remove "${title}" from the agenda?`)) {
                void run(() => removeAgendaItem(agendaItemId));
              }
            }}
          >
            Remove
          </Button>
        </>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              mode === "combine"
                ? combineAgendaItem({ agendaItemId, targetItemId: choice })
                : carryForwardAgendaItem({
                    agendaItemId,
                    targetMeetingId: choice,
                  }),
            );
          }}
        >
          <div>
            <Label htmlFor={`${mode}-${agendaItemId}`}>
              {mode === "combine" ? "Combine into" : "Carry to"}
            </Label>
            <Select
              id={`${mode}-${agendaItemId}`}
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              required
            >
              <option value="">Choose…</option>
              {(mode === "combine" ? otherItems : laterMeetings).map(
                (option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ),
              )}
            </Select>
          </div>
          <Button type="submit" loading={busy}>
            {mode === "combine" ? "Combine" : "Carry forward"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode("none")}>
            Cancel
          </Button>
        </form>
      )}
      {error ? (
        <span role="alert" className="text-[12px] text-danger-fg">
          {error}
        </span>
      ) : null}
    </div>
  );
}
