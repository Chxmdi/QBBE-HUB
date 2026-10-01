"use client";

import { Checkbox, Input, Label } from "@/components/ui/input";
import { MAX_STEP_ATTEMPTS } from "../../graph";
import type { EditorRetry } from "../../editor-model";
import type { StepEditorContext } from "./types";

/** Retry with backoff for actions, webhooks and emails. */
export function RetryFields({
  prefix,
  retry,
  onChange,
  ctx,
}: {
  prefix: string;
  retry: EditorRetry | null;
  onChange: (retry: EditorRetry | null) => void;
  ctx: StepEditorContext;
}) {
  const { m } = ctx;
  return (
    <div className="sm:col-span-3 grid gap-3 sm:grid-cols-3">
      <label className="inline-flex items-center gap-2 text-sm text-ink sm:pt-6">
        <Checkbox checked={retry !== null}
          onChange={(event) => onChange(event.target.checked ? { attempts: 3, backoffSeconds: 60 } : null)} />
        {m.steps.retry}
      </label>
      {retry ? (
        <>
          <div>
            <Label htmlFor={`${prefix}-attempts`}>{m.steps.attempts}</Label>
            <Input id={`${prefix}-attempts`} type="number" min={1} max={MAX_STEP_ATTEMPTS} required value={retry.attempts}
              onChange={(event) => onChange({ ...retry, attempts: Number(event.target.value) })} />
          </div>
          <div>
            <Label htmlFor={`${prefix}-backoff`}>{m.steps.backoff}</Label>
            <Input id={`${prefix}-backoff`} type="number" min={1} max={3600} required value={retry.backoffSeconds}
              onChange={(event) => onChange({ ...retry, backoffSeconds: Number(event.target.value) })} />
          </div>
        </>
      ) : null}
    </div>
  );
}
