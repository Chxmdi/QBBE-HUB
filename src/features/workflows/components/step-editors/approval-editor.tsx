"use client";

import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { approvalSubjectTypes } from "../../graph";
import type { EditorApprovalStep } from "../../editor-model";
import { LinkSelect } from "./link-select";
import type { StepEditorContext } from "./types";

export function ApprovalEditor({ step, prefix, ctx, onChange }: {
  step: EditorApprovalStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorApprovalStep) => void;
}) {
  const { m } = ctx;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <Label htmlFor={`${prefix}-subject`}>{m.steps.subjectType}</Label>
        <Select id={`${prefix}-subject`} value={step.subjectType}
          onChange={(event) => onChange({ ...step, subjectType: event.target.value as EditorApprovalStep["subjectType"] })}>
          {approvalSubjectTypes.map((type) => <option key={type} value={type}>{m.steps.subjectTypes[type]}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${prefix}-title`}>{m.steps.approvalTitle}</Label>
        <Input id={`${prefix}-title`} required maxLength={200} value={step.title}
          onChange={(event) => onChange({ ...step, title: event.target.value })} />
      </div>
      <LinkSelect id={`${prefix}-next`} label={m.steps.next} link={step.next} ctx={ctx} self={step.id}
        onChange={(next) => onChange({ ...step, next })} />
      <div className="sm:col-span-3">
        <Label htmlFor={`${prefix}-description`}>{m.steps.approvalDescription}</Label>
        <Textarea id={`${prefix}-description`} maxLength={2000} value={step.description}
          onChange={(event) => onChange({ ...step, description: event.target.value })} />
      </div>
    </div>
  );
}
