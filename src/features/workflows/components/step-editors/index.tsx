"use client";

import type { EditorStep } from "../../editor-model";
import { ActionEditor } from "./action-editor";
import { ApprovalEditor } from "./approval-editor";
import { BranchEditor } from "./branch-editor";
import { ConditionEditor } from "./condition-editor";
import { EmailEditor } from "./email-editor";
import { LoopEditor } from "./loop-editor";
import { ReviewEditor } from "./review-editor";
import { SubworkflowEditor } from "./subworkflow-editor";
import type { StepEditorContext } from "./types";
import { WaitEditor } from "./wait-editor";
import { WebhookEditor } from "./webhook-editor";

export type { StepEditorContext } from "./types";

/** The fields of one step, by kind (U10). */
export function StepFields({ step, prefix, ctx, onChange }: {
  step: EditorStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorStep) => void;
}) {
  switch (step.kind) {
    case "condition": return <ConditionEditor step={step} prefix={prefix} ctx={ctx} onChange={onChange} />;
    case "action": return <ActionEditor step={step} prefix={prefix} ctx={ctx} onChange={onChange} />;
    case "branch": return <BranchEditor step={step} prefix={prefix} ctx={ctx} onChange={onChange} />;
    case "loop": return <LoopEditor step={step} prefix={prefix} ctx={ctx} onChange={onChange} />;
    case "subworkflow": return <SubworkflowEditor step={step} prefix={prefix} ctx={ctx} onChange={onChange} />;
    case "wait": return <WaitEditor step={step} prefix={prefix} ctx={ctx} onChange={onChange} />;
    case "approval": return <ApprovalEditor step={step} prefix={prefix} ctx={ctx} onChange={onChange} />;
    case "review": return <ReviewEditor step={step} prefix={prefix} ctx={ctx} onChange={onChange} />;
    case "webhook": return <WebhookEditor step={step} prefix={prefix} ctx={ctx} onChange={onChange} />;
    case "email": return <EmailEditor step={step} prefix={prefix} ctx={ctx} onChange={onChange} />;
  }
}
