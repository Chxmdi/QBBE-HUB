"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { fill, type WorkflowsMessages } from "../i18n";
import { retryWorkflowFromStep } from "../services/workflow.commands";

/** "Retry from this step" in the run debugger (V1-12). */
export function RetryFromStepButton({
  executionId,
  stepId,
  label,
  m,
}: {
  executionId: string;
  stepId: string;
  /** Names the step for assistive technology, e.g. "Retry from this step: action send". */
  label: string;
  m: WorkflowsMessages;
}) {
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<
    { ok: true; executionId: string; runNumber: number; ruleId: string } | { ok: false; error: string } | null
  >(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="secondary" loading={pending} aria-label={label}
        onClick={() => start(async () => setResult(await retryWorkflowFromStep({ executionId, stepId })))}>
        {m.debugger.retry}
      </Button>
      <p role={result && !result.ok ? "alert" : "status"} className="text-[13px]">
        {result?.ok ? (
          <>
            <span className="text-success-fg">{fill(m.debugger.retried, { number: result.runNumber })}</span>{" "}
            <Link href={`/workflows/${result.ruleId}/runs/${result.executionId}`} className="text-brand-fg underline-offset-2 hover:underline">
              {fill(m.debugger.openRetried, { number: result.runNumber })}
            </Link>
          </>
        ) : result ? (
          <span className="text-danger-fg">{result.error}</span>
        ) : null}
      </p>
    </div>
  );
}
