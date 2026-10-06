import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Formatters } from "@/lib/i18n/format";
import { fill, type WorkflowsMessages } from "../i18n";
import type { RunOutcomeFilter } from "../run-outcomes";
import type { RunRow } from "../services/workflow.queries";
import { OutcomeFilter } from "./outcome-filter";

const TONE: Record<string, "success" | "danger" | "warning" | "neutral" | "info"> = {
  succeeded: "success",
  notified: "success",
  failed: "danger",
  stopped: "danger",
  waiting: "warning",
  running: "info",
  skipped: "neutral",
};

/** The runs of one workflow, newest first (M14c). */
export function RunHistory({
  runs,
  m,
  f,
  timeZone,
  workflowId,
  outcome = null,
}: {
  runs: RunRow[];
  m: WorkflowsMessages;
  f: Formatters;
  timeZone: string;
  workflowId: string;
  /** The outcome the list is narrowed to, from the page's query string. */
  outcome?: RunOutcomeFilter | null;
}) {
  return (
    <section className="rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5" aria-labelledby="workflow-history">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="workflow-history" className="section-heading">{m.history.heading}</h2>
        <OutcomeFilter value={outcome} m={m} />
      </div>
      {runs.length === 0 ? (
        <p className="text-sm text-muted">{m.history.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{m.history.heading}</caption>
            <thead className="text-[12.5px] text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">#</th>
                <th scope="col" className="py-2 pr-3 font-medium">{m.history.started}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{m.history.outcome}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{m.history.detail}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-line">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <Link href={`/workflows/${workflowId}/runs/${run.id}`} className="font-medium text-brand-fg underline-offset-2 hover:underline">
                      {fill(m.history.run, { number: run.run_number })}
                    </Link>
                    {run.is_test ? <Badge className="ml-2">{m.history.test}</Badge> : null}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{f.dateTime(run.started_at ?? run.created_at, timeZone)}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={TONE[run.outcome] ?? "neutral"}>
                      {m.outcomes[run.outcome as keyof typeof m.outcomes] ?? run.outcome}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-muted">{run.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
