"use client";

import { Label, Select } from "@/components/ui/input";
import type { EditorLink } from "../../editor-model";
import { fill } from "../../i18n";
import type { StepEditorContext } from "./types";

/** Where the run goes next: the step below, a named step, or the end. */
export function LinkSelect({
  id,
  label,
  link,
  onChange,
  ctx,
  self,
  noEnd,
}: {
  id: string;
  label: string;
  link: EditorLink;
  onChange: (link: EditorLink) => void;
  ctx: StepEditorContext;
  /** The step being edited, left out of the choices. */
  self: string;
  /** A loop body cannot be "the end". */
  noEnd?: boolean;
}) {
  const value = link.to === "step" ? `step:${link.id}` : link.to;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "following") onChange({ to: "following" });
          else if (raw === "end") onChange({ to: "end" });
          else onChange({ to: "step", id: raw.slice("step:".length) });
        }}
      >
        <option value="following">{ctx.m.steps.nextFollowing}</option>
        {noEnd ? null : <option value="end">{ctx.m.steps.nextEnd}</option>}
        {ctx.steps.filter((step) => step.id !== self).map((step) => (
          <option key={step.id} value={`step:${step.id}`}>
            {fill(ctx.m.steps.nextStep, { id: step.id })} · {ctx.m.steps.kinds[step.kind]}
          </option>
        ))}
        {link.to === "step" && !ctx.steps.some((step) => step.id === link.id) ? (
          <option value={`step:${link.id}`}>{fill(ctx.m.steps.nextStep, { id: link.id })}</option>
        ) : null}
      </Select>
    </div>
  );
}
