"use client";

import { Input, Label, Textarea } from "@/components/ui/input";
import type { EditorEmailStep } from "../../editor-model";
import { LinkSelect } from "./link-select";
import { RetryFields } from "./retry-fields";
import { hintClass, type StepEditorContext } from "./types";

export function EmailEditor({ step, prefix, ctx, onChange }: {
  step: EditorEmailStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorEmailStep) => void;
}) {
  const { m } = ctx;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <Label htmlFor={`${prefix}-to`}>{m.steps.to}</Label>
        <Input id={`${prefix}-to`} required maxLength={320} value={step.to} aria-describedby={`${prefix}-to-hint`}
          onChange={(event) => onChange({ ...step, to: event.target.value })} />
        <p id={`${prefix}-to-hint`} className={hintClass}>{m.steps.toHint}</p>
      </div>
      <div>
        <Label htmlFor={`${prefix}-subject`}>{m.steps.subject}</Label>
        <Input id={`${prefix}-subject`} required maxLength={200} value={step.subject}
          onChange={(event) => onChange({ ...step, subject: event.target.value })} />
      </div>
      <LinkSelect id={`${prefix}-next`} label={m.steps.next} link={step.next} ctx={ctx} self={step.id}
        onChange={(next) => onChange({ ...step, next })} />
      <div className="sm:col-span-3">
        <Label htmlFor={`${prefix}-email-body`}>{m.steps.emailBody}</Label>
        <Textarea id={`${prefix}-email-body`} required maxLength={5000} value={step.body}
          onChange={(event) => onChange({ ...step, body: event.target.value })} />
      </div>
      <RetryFields prefix={prefix} retry={step.retry} ctx={ctx} onChange={(retry) => onChange({ ...step, retry })} />
    </div>
  );
}
