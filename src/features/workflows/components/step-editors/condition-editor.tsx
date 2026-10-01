"use client";

import type { EditorConditionStep } from "../../editor-model";
import { ConditionFields } from "./condition-fields";
import { LinkSelect } from "./link-select";
import type { StepEditorContext } from "./types";

export function ConditionEditor({ step, prefix, ctx, onChange }: {
  step: EditorConditionStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorConditionStep) => void;
}) {
  return (
    <div className="space-y-3">
      <ConditionFields prefix={prefix} when={step.when} ctx={ctx} onChange={(when) => onChange({ ...step, when })} />
      <div className="sm:w-80">
        <LinkSelect id={`${prefix}-next`} label={ctx.m.steps.next} link={step.next} ctx={ctx} self={step.id}
          onChange={(next) => onChange({ ...step, next })} />
      </div>
    </div>
  );
}
