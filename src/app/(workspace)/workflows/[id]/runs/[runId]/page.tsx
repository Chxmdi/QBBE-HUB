import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireAdminAal2 } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { RetryFromStepButton } from "@/features/workflows/components/retry-button";
import { fill, workflowMessages, type WorkflowsMessages } from "@/features/workflows/i18n";
import { canRetry, durationMs, summarizeRun, summaryLine, type SummaryItem } from "@/features/workflows/run-summary";
import { getRun, getWorkflow, listRunSteps, runNumbers } from "@/features/workflows/services/workflow.queries";

export async function generateMetadata({ params }: { params: Promise<{ runId: string }> }): Promise<Metadata> {
  const m = workflowMessages(await getLocale());
  const { runId } = await params;
  return { title: `${m.history.heading} · ${runId.slice(0, 8)}` };
}
export const dynamic = "force-dynamic";

const TONE: Record<string, "success" | "danger" | "warning" | "neutral" | "info"> = {
  succeeded: "success", failed: "danger", stopped: "danger", waiting: "warning", running: "info", skipped: "neutral",
};
const SYMBOL_CLASS: Record<SummaryItem["symbol"], string> = {
  "✓": "text-success-fg", "✕": "text-danger-fg", "…": "text-warning-fg", "–": "text-muted",
};
const linkClass = "text-brand-fg underline-offset-2 hover:underline";

function kindLabel(m: WorkflowsMessages, kind: string): string {
  return m.stepKinds[kind as keyof WorkflowsMessages["stepKinds"]] ?? kind;
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 max-h-72 overflow-auto rounded-(--radius-sm) bg-surface-soft p-2 text-[12px] leading-snug text-ink">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** The run debugger (V1-12): every step, what went in and out, how long, and why it failed. */
export default async function RunDebuggerPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  if (!(await isEnabled("wos_workflows_v2"))) notFound();
  const session = await requireAdminAal2();
  const { id, runId } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(runId).success) notFound();
  const [workflow, run] = await Promise.all([getWorkflow(session.organizationId, id), getRun(id, runId)]);
  if (!workflow || !run) notFound();

  const m = workflowMessages(await getLocale());
  const f = await getFormatters();
  const steps = await listRunSteps(run.id);
  const summary = summarizeRun(steps);
  const label = (item: SummaryItem) => fill(m.debugger.step, { kind: kindLabel(m, item.kind), id: item.stepId });
  const linked = await runNumbers([run.retry_of ?? "", run.parent_execution_id ?? ""]);
  const retryable = canRetry(run.outcome);
  const title = fill(m.debugger.title, { number: run.run_number });

  return (
    <div className="space-y-5">
      <p className="text-sm">
        <Link href={`/workflows/${workflow.id}`} className={linkClass}>{fill(m.debugger.backToWorkflow, { name: workflow.name })}</Link>
      </p>
      <PageHeader eyebrow={workflow.name} title={title} />

      <section aria-labelledby="run-summary" className="rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5">
        <h2 id="run-summary" className="section-heading mb-2">{m.debugger.summaryLabel}</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={TONE[run.outcome] ?? "neutral"}>{m.outcomes[run.outcome as keyof typeof m.outcomes] ?? run.outcome}</Badge>
          {run.is_test ? <Badge>{m.history.test}</Badge> : null}
        </p>
        {summary.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{m.debugger.empty}</p>
        ) : (
          <p className="mt-3 text-[15px] leading-relaxed text-ink">
            <span className="sr-only">{`${title}: ${summaryLine(summary, label)}`}</span>
            <span aria-hidden className="font-semibold">{title}:</span>{" "}
            {summary.map((item, index) => (
              <span key={`${item.stepId}-${index}`} aria-hidden className="mr-3 inline-block">
                <span className={SYMBOL_CLASS[item.symbol]}>{item.symbol}</span> {label(item)}
                {item.status === "failed" && item.reason ? <span className="text-danger-fg"> ({item.reason})</span> : null}
              </span>
            ))}
          </p>
        )}
        <dl className="mt-3 grid gap-1 text-[13px] text-muted sm:grid-cols-2">
          <div><dt className="sr-only">{m.history.started}</dt><dd>{fill(m.debugger.started, { when: f.dateTime(run.started_at ?? run.created_at, session.timeZone) })}</dd></div>
          <div><dt className="sr-only">{m.history.outcome}</dt><dd>{run.finished_at ? fill(m.debugger.finished, { when: f.dateTime(run.finished_at, session.timeZone) }) : m.debugger.stillGoing}</dd></div>
          <div><dt className="sr-only">{m.history.item}</dt><dd>{fill(m.debugger.item, { type: run.source_type, id: run.source_id })}</dd></div>
          {run.is_test ? <div><dt className="sr-only">{m.history.test}</dt><dd>{m.debugger.test}</dd></div> : null}
          {run.retry_of && linked.get(run.retry_of) ? (
            <div><dt className="sr-only">{m.debugger.retryOf}</dt><dd>
              <Link className={linkClass} href={`/workflows/${workflow.id}/runs/${run.retry_of}`}>{fill(m.debugger.retryOf, { number: linked.get(run.retry_of)!.number })}</Link>
            </dd></div>
          ) : null}
          {run.parent_execution_id && linked.get(run.parent_execution_id)?.ruleId ? (
            <div><dt className="sr-only">{m.debugger.parent}</dt><dd>
              <Link className={linkClass} href={`/workflows/${linked.get(run.parent_execution_id)!.ruleId}/runs/${run.parent_execution_id}`}>
                {fill(m.debugger.parent, { number: linked.get(run.parent_execution_id)!.number })}
              </Link>
            </dd></div>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="run-steps">
        <h2 id="run-steps" className="section-heading mb-1">{m.debugger.steps}</h2>
        {retryable ? <p className="mb-3 text-[12.5px] text-muted">{m.debugger.retryHint}</p> : <div className="mb-3" />}
        <ol className="space-y-3" aria-label={m.debugger.steps}>
          {steps.map((step) => {
            const ms = durationMs(step.started_at, step.finished_at);
            const name = fill(m.debugger.step, { kind: kindLabel(m, step.step_kind), id: step.step_id });
            return (
              <li key={step.id} className="rounded-(--radius-md) border border-line bg-surface p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">{name}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                    {step.attempt > 1 ? <span>{fill(m.debugger.attempt, { number: step.attempt })}</span> : null}
                    {ms !== null ? <span>{fill(m.debugger.took, { ms })}</span> : null}
                    <Badge tone={TONE[step.status] ?? "neutral"}>{m.stepStatus[step.status as keyof typeof m.stepStatus] ?? step.status}</Badge>
                  </div>
                </div>
                {step.error ? (
                  <p className="mt-2 text-sm text-danger-fg"><span className="font-medium">{m.debugger.reason}:</span> {step.error}</p>
                ) : null}
                {step.input !== null ? (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-muted">{m.debugger.input}</summary>
                    <Json value={step.input} />
                  </details>
                ) : null}
                {step.output !== null ? (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-muted">{m.debugger.output}</summary>
                    <Json value={step.output} />
                  </details>
                ) : null}
                {retryable && step.step_kind !== "trigger" ? (
                  <div className="mt-3">
                    <RetryFromStepButton executionId={run.id} stepId={step.step_id} m={m} label={`${m.debugger.retry}: ${name}`} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
