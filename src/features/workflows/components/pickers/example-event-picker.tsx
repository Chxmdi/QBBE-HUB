"use client";

import * as React from "react";
import { fill, type WorkflowsMessages } from "../../i18n";
import { eventOptions } from "../../picker-options";
import type { RecentEvent } from "../../services/workflow.queries";
import { Combobox } from "./combobox";

/**
 * Picks one of the most recent events the trigger would match, so a test run
 * replays something real (U10).
 */
export function ExampleEventPicker({
  id,
  events,
  selected,
  onPick,
  onClear,
  dateTime,
  m,
}: {
  id: string;
  events: RecentEvent[];
  selected: RecentEvent | null;
  onPick: (event: RecentEvent) => void;
  onClear: () => void;
  /** Formats a timestamp for the reader. */
  dateTime: (iso: string) => string;
  m: WorkflowsMessages;
}) {
  const options = React.useMemo(
    () => eventOptions(events, { dateTime, verb: (verb) => m.verbs[verb as keyof typeof m.verbs] ?? verb }),
    [events, dateTime, m],
  );
  const byId = new Map(options.map((option) => [option.id, option]));
  if (events.length === 0) return <p className="text-sm text-muted">{m.test.exampleEmpty}</p>;
  return (
    <Combobox
      id={id}
      label={m.test.example}
      hint={m.test.exampleHint}
      selectedLabel={selected ? (byId.get(selected.id)?.label ?? selected.summary) : ""}
      groups={[{ label: "", options: options.map(({ id: optionId, label, description }) => ({ id: optionId, label, description })) }]}
      m={m.picker}
      fill={fill}
      onSelect={(option) => {
        const found = byId.get(option.id);
        if (found) onPick(found.event);
      }}
      onClear={onClear}
    />
  );
}
