"use client";

import { Input, Label, Textarea } from "@/components/ui/input";
import { parseWebhookBody, type EditorWebhookStep } from "../../editor-model";
import { fill } from "../../i18n";
import { LinkSelect } from "./link-select";
import { RetryFields } from "./retry-fields";
import { hintClass, type StepEditorContext } from "./types";

export function WebhookEditor({ step, prefix, ctx, onChange }: {
  step: EditorWebhookStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorWebhookStep) => void;
}) {
  const { m } = ctx;
  const invalid = parseWebhookBody(step.body) === null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="sm:col-span-2">
        <Label htmlFor={`${prefix}-url`}>{m.steps.url}</Label>
        <Input id={`${prefix}-url`} type="url" required maxLength={2000} value={step.url}
          onChange={(event) => onChange({ ...step, url: event.target.value })} />
      </div>
      <LinkSelect id={`${prefix}-next`} label={m.steps.next} link={step.next} ctx={ctx} self={step.id}
        onChange={(next) => onChange({ ...step, next })} />
      <div className="sm:col-span-3">
        <Label htmlFor={`${prefix}-body`}>{m.steps.webhookBody}</Label>
        <Textarea id={`${prefix}-body`} className="font-mono text-[13px]" spellCheck={false} value={step.body}
          aria-describedby={`${prefix}-body-hint`} aria-invalid={invalid || undefined}
          onChange={(event) => onChange({ ...step, body: event.target.value })} />
        <p id={`${prefix}-body-hint`} className={invalid ? "mt-1 text-[12.5px] text-danger-fg" : hintClass}>
          {invalid ? fill(m.steps.issues.webhook_body_json, { id: step.id }) : m.steps.bodyHint}
        </p>
      </div>
      <RetryFields prefix={prefix} retry={step.retry} ctx={ctx} onChange={(retry) => onChange({ ...step, retry })} />
    </div>
  );
}
