"use client";

import type { EditorBranchStep } from "../../editor-model";
import { ConditionFields } from "./condition-fields";
import { LinkSelect } from "./link-select";
import type { StepEditorContext } from "./types";

export function BranchEditor({ step, prefix, ctx, onChange }: {
  step: EditorBranchStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorBranchStep) => void;
}) {
  return (
    <div className="space-y-3">
      <ConditionFields prefix={prefix} when={step.when} ctx={ctx} onChange={(when) => onChange({ ...step, when })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <LinkSelect id={`${prefix}-then`} label={ctx.m.steps.then} link={step.then} ctx={ctx} self={step.id}
          onChange={(then) => onChange({ ...step, then })} />
        <LinkSelect id={`${prefix}-else`} label={ctx.m.steps.else} link={step.else} ctx={ctx} self={step.id}
          onChange={(otherwise) => onChange({ ...step, else: otherwise })} />
      </div>
    </div>
  );
}
