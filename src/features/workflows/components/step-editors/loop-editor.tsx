"use client";

import { Input, Label } from "@/components/ui/input";
import type { EditorLoopStep } from "../../editor-model";
import { LinkSelect } from "./link-select";
import { hintClass, type StepEditorContext } from "./types";

export function LoopEditor({ step, prefix, ctx, onChange }: {
  step: EditorLoopStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorLoopStep) => void;
}) {
  const { m } = ctx;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <Label htmlFor={`${prefix}-items`}>{m.steps.items}</Label>
        <Input id={`${prefix}-items`} required value={step.items} aria-describedby={`${prefix}-items-hint`}
          onChange={(event) => onChange({ ...step, items: event.target.value })} />
        <p id={`${prefix}-items-hint`} className={hintClass}>{m.steps.itemsHint}</p>
      </div>
      <LinkSelect id={`${prefix}-body`} label={m.steps.body} link={step.body} ctx={ctx} self={step.id} noEnd
        onChange={(body) => onChange({ ...step, body })} />
      <LinkSelect id={`${prefix}-next`} label={m.steps.afterLoop} link={step.next} ctx={ctx} self={step.id}
        onChange={(next) => onChange({ ...step, next })} />
    </div>
  );
}
