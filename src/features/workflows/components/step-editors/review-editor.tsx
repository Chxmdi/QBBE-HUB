"use client";

import { Label, Textarea } from "@/components/ui/input";
import type { EditorReviewStep } from "../../editor-model";
import { PersonPicker } from "../pickers/person-picker";
import { LinkSelect } from "./link-select";
import type { StepEditorContext } from "./types";

export function ReviewEditor({ step, prefix, ctx, onChange }: {
  step: EditorReviewStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorReviewStep) => void;
}) {
  const { m } = ctx;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <PersonPicker id={`${prefix}-reviewer`} value={step.reviewer} m={m}
        label={m.steps.reviewer} idLabel={m.steps.personId} idHint={m.steps.personIdHint}
        onChange={(reviewer) => onChange({ ...step, reviewer })} />
      <div className="sm:col-span-2">
        <Label htmlFor={`${prefix}-instructions`}>{m.steps.instructions}</Label>
        <Textarea id={`${prefix}-instructions`} required maxLength={2000} value={step.instructions}
          onChange={(event) => onChange({ ...step, instructions: event.target.value })} />
      </div>
      <LinkSelect id={`${prefix}-next`} label={m.steps.next} link={step.next} ctx={ctx} self={step.id}
        onChange={(next) => onChange({ ...step, next })} />
    </div>
  );
}
