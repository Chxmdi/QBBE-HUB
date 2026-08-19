import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { describeSchedule } from "@/features/jobs/services/cron";
import type {
  DeadLetter,
  JobHealth,
  JobRunSummary,
  QueueHealth,
} from "@/features/jobs/services/jobs.queries";
import { formatDateTime, relativeTime } from "@/lib/utils";

/**
 * The operator's view of the background runtime.
 *
 * It answers, in order: is anything broken, is anything stuck, and is every
 * job still on its schedule. Failures come first because that is the reason
 * anyone opens this page.
 */

function runTone(run: JobRunSummary | null): "success" | "danger" | "info" | "neutral" {
  if (!run) return "neutral";
  if (run.status === "failed") return "danger";
  if (run.status === "running") return "info";
  return "success";
}

function runLabel(run: JobRunSummary | null): string {
  if (!run) return "Never run";
  if (run.status === "running") return "Running";
  return run.status === "failed" ? "Failed" : "Succeeded";
}

function duration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function age(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function JobHealthPanel({
  jobs,
  recentFailures,
  queues,
  deadLetters,
  queueError,
}: {
  jobs: JobHealth[];
  recentFailures: (JobRunSummary & { jobName: string })[];
  queues: QueueHealth[];
  deadLetters: DeadLetter[];
  queueError: string | null;
}) {
  const unconfigured = jobs.every((job) => job.lastRun === null);

  return (
    <div className="space-y-10">
      {unconfigured ? (
        <p className="card border-warning/40 bg-warning/8 px-4 py-3 text-[13.5px]">
          <strong className="font-semibold">No job has run yet.</strong> The
          scheduler reaches this deployment only after an administrator runs{" "}
          <code className="rounded bg-surface-soft px-1 py-0.5 text-[12.5px]">
            select app.configure_job_runner(&#39;https://your-domain&#39;, &#39;&lt;secret&gt;&#39;);
          </code>{" "}
          against the database. See docs/runbooks/jobs.md.
        </p>
      ) : null}

      {/* Failures first — this is why the page gets opened. */}
      <section aria-labelledby="jobs-failures">
        <h2 id="jobs-failures" className="section-heading mb-3">
          Recent failures
        </h2>
        {recentFailures.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">
            No failed runs recorded. Failures appear here with the error that
            caused them.
          </p>
        ) : (
          <ol className="card divide-y divide-line">
            {recentFailures.map((failure) => (
              <li key={failure.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-medium">{failure.jobName}</span>
                  <Badge tone="danger">failed</Badge>
                  <span className="meta ml-auto whitespace-nowrap">
                    {relativeTime(failure.startedAt)}
                  </span>
                </div>
                {failure.error ? (
                  <p className="mt-1 font-mono text-[12.5px] break-words text-muted">
                    {failure.error}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Queue depth and dead letters (JOB-004). */}
      <section aria-labelledby="jobs-queues">
        <h2 id="jobs-queues" className="section-heading mb-3">
          Queues
        </h2>
        {queueError ? (
          <p className="card border-danger/40 bg-danger/8 px-4 py-3 text-[13px]">
            Queue metrics could not be read: {queueError}
          </p>
        ) : queues.length === 0 ? (
          <EmptyState
            title="No queues"
            description="Queues are created by migration 0008. If none appear, migrations have not been applied to this database."
          />
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface-soft/60">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Queue</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Pending</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Ready now</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Oldest</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Dead letters</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {queues.map((queue) => (
                    <tr key={queue.queueName} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-3 font-medium">{queue.queueName}</td>
                      <td className="px-4 py-3 text-right">{queue.queueLength}</td>
                      <td className="px-4 py-3 text-right">{queue.visibleLength}</td>
                      <td className="px-4 py-3 text-right">
                        {age(queue.oldestMessageAgeSeconds)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {queue.archivedCount > 0 ? (
                          <span className="text-danger-fg">{queue.archivedCount}</span>
                        ) : (
                          queue.archivedCount
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {deadLetters.length > 0 ? (
          <details className="card mt-4 px-4 py-3">
            <summary className="cursor-pointer text-[13.5px] font-medium">
              Dead-lettered messages ({deadLetters.length})
            </summary>
            <ol className="mt-3 divide-y divide-line">
              {deadLetters.map((letter) => (
                <li key={`${letter.queueName}-${letter.msgId}`} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">
                      {letter.queueName} #{letter.msgId}
                    </span>
                    <Badge tone="neutral">{letter.readCount} attempts</Badge>
                    <span className="meta ml-auto whitespace-nowrap">
                      archived {relativeTime(letter.archivedAt)}
                    </span>
                  </div>
                  <pre className="mt-1 overflow-x-auto rounded bg-surface-soft px-2 py-1.5 font-mono text-[12px]">
                    {JSON.stringify(letter.message)}
                  </pre>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </section>

      {/* The schedule itself. */}
      <section aria-labelledby="jobs-schedule">
        <h2 id="jobs-schedule" className="section-heading mb-3">
          Scheduled jobs
        </h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-soft/60">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Job</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Schedule</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Last run</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Next run</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    Failures (24h)
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.name} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-4 py-3">
                      <span className="block font-medium">{job.name}</span>
                      <span className="meta">{job.description}</span>
                      {!job.enabled ? (
                        <Badge tone="neutral" className="mt-1">disabled</Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block">{describeSchedule(job.schedule)}</span>
                      <span className="meta font-mono">{job.schedule}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={runTone(job.lastRun)}>{runLabel(job.lastRun)}</Badge>
                      {job.lastRun ? (
                        <span className="meta mt-1 block">
                          {relativeTime(job.lastRun.startedAt)} ·{" "}
                          {job.lastRun.processedCount} processed ·{" "}
                          {duration(job.lastRun.durationMs)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {job.nextRunAt ? formatDateTime(job.nextRunAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {job.failuresLast24h > 0 ? (
                        <span className="text-danger-fg">{job.failuresLast24h}</span>
                      ) : (
                        "0"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="meta mt-2">
          Schedules and next-run times are UTC, matching pg_cron.
        </p>
      </section>
    </div>
  );
}
