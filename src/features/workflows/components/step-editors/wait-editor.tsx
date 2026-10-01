"use client";

import { Input, Label, Select } from "@/components/ui/input";
import { MAX_WAIT_SECONDS } from "../../graph";
import type { EditorWaitStep } from "../../editor-model";
import { LinkSelect } from "./link-select";
import { hintClass, type StepEditorContext } from "./types";

export function WaitEditor({ step, prefix, ctx, onChange }: {
  step: EditorWaitStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorWaitStep) => void;
}) {
  const { m } = ctx;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <Label htmlFor={`${prefix}-mode`}>{m.steps.waitMode}</Label>
        <Select id={`${prefix}-mode`} value={step.mode}
          onChange={(event) => onChange({ ...step, mode: event.target.value as EditorWaitStep["mode"] })}>
          <option value="seconds">{m.steps.waitSeconds}</option>
          <option value="until">{m.steps.waitUntil}</option>
        </Select>
      </div>
      {step.mode === "seconds" ? (
        <div>
          <Label htmlFor={`${prefix}-seconds`}>{m.steps.seconds}</Label>
          <Input id={`${prefix}-seconds`} type="number" min={1} max={MAX_WAIT_SECONDS} required value={step.seconds}
            onChange={(event) => onChange({ ...step, seconds: event.target.value })} />
        </div>
      ) : (
        <div>
          <Label htmlFor={`${prefix}-until`}>{m.steps.until}</Label>
          <Input id={`${prefix}-until`} required value={step.until} aria-describedby={`${prefix}-until-hint`}
            onChange={(event) => onChange({ ...step, until: event.target.value })} />
          <p id={`${prefix}-until-hint`} className={hintClass}>{m.steps.untilHint}</p>
        </div>
      )}
      <LinkSelect id={`${prefix}-next`} label={m.steps.next} link={step.next} ctx={ctx} self={step.id}
        onChange={(next) => onChange({ ...step, next })} />
    </div>
  );
}
