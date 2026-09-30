import { Badge } from "@/components/ui/badge";
import type { Formatters } from "@/lib/i18n/format";
import { fill, type WorkflowsMessages } from "../i18n";
import type { RunRow } from "../services/workflow.queries";

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
}: {
  runs: RunRow[];
  m: WorkflowsMessages;
  f: Formatters;
  timeZone: string;
}) {
  return (
    <section className="rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5" aria-labelledby="workflow-history">
      <h2 id="workflow-history" className="section-heading mb-3">{m.history.heading}</h2>
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
                    <span className="font-medium text-ink">{fill(m.history.run, { number: run.run_number })}</span>
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
