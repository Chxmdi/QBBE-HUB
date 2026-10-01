"use client";

import { Label, Select } from "@/components/ui/input";
import type { EditorSubworkflowStep } from "../../editor-model";
import { LinkSelect } from "./link-select";
import type { StepEditorContext } from "./types";

export function SubworkflowEditor({ step, prefix, ctx, onChange }: {
  step: EditorSubworkflowStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorSubworkflowStep) => void;
}) {
  const { m } = ctx;
  const known = ctx.workflows.some((workflow) => workflow.id === step.workflowId);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <Label htmlFor={`${prefix}-workflow`}>{m.steps.workflowId}</Label>
        <Select id={`${prefix}-workflow`} required value={step.workflowId}
          onChange={(event) => onChange({ ...step, workflowId: event.target.value })}>
          <option value="">{m.steps.chooseWorkflow}</option>
          {ctx.workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
          {step.workflowId && !known ? <option value={step.workflowId}>{step.workflowId}</option> : null}
        </Select>
      </div>
      <LinkSelect id={`${prefix}-next`} label={m.steps.next} link={step.next} ctx={ctx} self={step.id}
        onChange={(next) => onChange({ ...step, next })} />
    </div>
  );
}
