import Link from "next/link";
import type { Formatters } from "@/lib/i18n/format";
import { fill, type WorkflowsMessages } from "../i18n";
import type { FailedRunRow } from "../services/workflow.queries";
import { RetryFromStepButton } from "./retry-button";

/**
 * Failed runs with the step that failed and a retry from it (U10): one
 * workflow's on its page, every workflow's on the index.
 */
export function FailureHistory({
  runs,
  m,
  f,
  timeZone,
  scope,
}: {
  runs: FailedRunRow[];
  m: WorkflowsMessages;
  f: Formatters;
  timeZone: string;
  /** "workflow" on a workflow's page; "all" on the index, which names the workflow too. */
  scope: "workflow" | "all";
}) {
  const heading = scope === "all" ? m.failures.headingAll : m.failures.heading;
  return (
    <section className="rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5" aria-labelledby="workflow-failures">
      <h2 id="workflow-failures" className="section-heading mb-1">{heading}</h2>
      <p className="mb-3 text-sm text-muted">{m.failures.description}</p>
      {runs.length === 0 ? (
        <p className="text-sm text-muted">{m.failures.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{heading}</caption>
            <thead className="text-[12.5px] text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">#</th>
                {scope === "all" ? <th scope="col" className="py-2 pr-3 font-medium">{m.failures.workflow}</th> : null}
                <th scope="col" className="py-2 pr-3 font-medium">{m.history.started}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{m.failures.step}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{m.failures.reason}</th>
                <th scope="col" className="py-2 pr-3 font-medium"><span className="sr-only">{m.debugger.retry}</span></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const stepName = run.failedStep
                  ? fill(m.debugger.step, {
                    kind: m.stepKinds[run.failedStep.step_kind as keyof typeof m.stepKinds] ?? run.failedStep.step_kind,
                    id: run.failedStep.step_id,
                  })
                  : "";
                return (
                  <tr key={run.id} className="border-t border-line align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <Link href={`/workflows/${run.rule_id}/runs/${run.id}`} className="font-medium text-brand-fg underline-offset-2 hover:underline">
                        {fill(m.history.run, { number: run.run_number })}
                      </Link>
                    </td>
                    {scope === "all" ? (
                      <td className="py-2 pr-3">
                        <Link href={`/workflows/${run.rule_id}`} className="text-ink underline-offset-2 hover:underline">{run.rule_name}</Link>
                      </td>
                    ) : null}
                    <td className="py-2 pr-3 whitespace-nowrap">{f.dateTime(run.started_at ?? run.created_at, timeZone)}</td>
                    <td className="py-2 pr-3">{stepName}</td>
                    <td className="py-2 pr-3 text-danger-fg">{run.failedStep?.error ?? run.detail ?? ""}</td>
                    <td className="py-2 pr-3">
                      {run.failedStep ? (
                        <RetryFromStepButton
                          executionId={run.id}
                          stepId={run.failedStep.step_id}
                          m={m}
                          label={`${m.debugger.retry}: ${fill(m.history.run, { number: run.run_number })} ${stepName}`}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
