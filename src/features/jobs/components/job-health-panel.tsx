import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { describeSchedule } from "@/features/jobs/services/cron";
import type {
  DeadLetter,
  JobHealth,
  JobRunSummary,
  QueueHealth,
} from "@/features/jobs/services/jobs.queries";
import { jobDescription } from "@/features/jobs/services/i18n";
import { runLabel, runOutcome, runTone } from "@/features/jobs/services/run-health";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { TranslateFn } from "@/lib/i18n/translate";

/**
 * The operator's view of the background runtime.
 *
 * It answers, in order: is anything broken, is anything stuck, and is every
 * job still on its schedule. Failures come first because that is the reason
 * anyone opens this page.
 *
 * "Broken" includes a run that returned normally having dropped part of its
 * batch — see `run-health.ts` — so a green badge here means the work happened,
 * not merely that the process finished.
 */

function duration(ms: number | null, t: TranslateFn, format: Formatters): string {
  if (ms === null) return "—";
  if (ms < 1000) return t("jobs.units.ms", { n: format.number(ms) });
  return t("jobs.units.s", {
    n: format.number(ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  });
}

function age(seconds: number | null, t: TranslateFn): string {
  if (seconds === null) return "—";
  if (seconds < 60) return t("jobs.units.ageSeconds", { n: seconds });
  if (seconds < 3600) return t("jobs.units.ageMinutes", { n: Math.round(seconds / 60) });
  return t("jobs.units.ageHours", { n: Math.round(seconds / 3600) });
}

export async function JobHealthPanel({
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
  const t = await getT();
  const format = await getFormatters();
  const unconfigured = jobs.every((job) => job.lastRun === null);

  return (
    <div className="space-y-10">
      {unconfigured ? (
        <p className="card border-warning/40 bg-warning/8 px-4 py-3 text-[13.5px]">
          <strong className="font-semibold">{t("jobs.unconfiguredLead")}</strong>{" "}
          {t("jobs.unconfiguredBefore")}{" "}
          <code className="rounded bg-surface-soft px-1 py-0.5 text-[12.5px]">
            select app.configure_job_runner(&#39;https://your-domain&#39;, &#39;&lt;secret&gt;&#39;);
          </code>{" "}
          {t("jobs.unconfiguredAfter")}
        </p>
      ) : null}

      {/* Failures first — this is why the page gets opened. */}
      <section aria-labelledby="jobs-failures">
        <h2 id="jobs-failures" className="section-heading mb-3">
          {t("jobs.failuresHeading")}
        </h2>
        {recentFailures.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">
            {t("jobs.failuresEmpty")}
          </p>
        ) : (
          <ol className="card divide-y divide-line">
            {recentFailures.map((failure) => (
              <li key={failure.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-medium">{failure.jobName}</span>
                  <Badge tone={runTone(runOutcome(failure))}>
                    {runLabel(runOutcome(failure), failure, t)}
                  </Badge>
                  <span className="meta ml-auto whitespace-nowrap">
                    {format.relative(failure.startedAt)}
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
          {t("jobs.queuesHeading")}
        </h2>
        {queueError ? (
          <p className="card border-danger/40 bg-danger/8 px-4 py-3 text-[13px]">
            {t("jobs.queueError", { error: queueError })}
          </p>
        ) : queues.length === 0 ? (
          <EmptyState
            title={t("jobs.noQueuesTitle")}
            description={t("jobs.noQueuesDescription")}
          />
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface-soft/60">
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t("jobs.columns.queue")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("jobs.columns.pending")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("jobs.columns.readyNow")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("jobs.columns.oldest")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("jobs.columns.deadLetters")}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {queues.map((queue) => (
                    <tr key={queue.queueName} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-3 font-medium">{queue.queueName}</td>
                      <td className="px-4 py-3 text-right">{format.number(queue.queueLength)}</td>
                      <td className="px-4 py-3 text-right">{format.number(queue.visibleLength)}</td>
                      <td className="px-4 py-3 text-right">
                        {age(queue.oldestMessageAgeSeconds, t)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {queue.archivedCount > 0 ? (
                          <span className="text-danger-fg">{format.number(queue.archivedCount)}</span>
                        ) : (
                          format.number(queue.archivedCount)
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
              {t("jobs.deadLettered", { count: deadLetters.length })}
            </summary>
            <ol className="mt-3 divide-y divide-line">
              {deadLetters.map((letter) => (
                <li key={`${letter.queueName}-${letter.msgId}`} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">
                      {letter.queueName} #{letter.msgId}
                    </span>
                    <Badge tone="neutral">
                      {t(letter.readCount === 1 ? "jobs.attemptsOne" : "jobs.attemptsOther", {
                        count: letter.readCount,
                      })}
                    </Badge>
                    <span className="meta ml-auto whitespace-nowrap">
                      {t("jobs.archived", { when: format.relative(letter.archivedAt) })}
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
          {t("jobs.scheduleHeading")}
        </h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-soft/60">
                  <th scope="col" className="px-4 py-2.5 font-semibold">{t("jobs.columns.job")}</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">{t("jobs.columns.schedule")}</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">{t("jobs.columns.lastRun")}</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">{t("jobs.columns.nextRun")}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    {t("jobs.columns.failures24h")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.name} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-4 py-3">
                      <span className="block font-medium">{job.name}</span>
                      <span className="meta">{jobDescription(job.name, job.description, t)}</span>
                      {!job.enabled ? (
                        <Badge tone="neutral" className="mt-1">{t("jobs.disabled")}</Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block">{describeSchedule(job.schedule, t)}</span>
                      <span className="meta font-mono">{job.schedule}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={runTone(runOutcome(job.lastRun))}>
                        {runLabel(runOutcome(job.lastRun), job.lastRun, t)}
                      </Badge>
                      {job.lastRun ? (
                        <span className="meta mt-1 block">
                          {format.relative(job.lastRun.startedAt)} ·{" "}
                          {t("jobs.processed", { count: format.number(job.lastRun.processedCount) })}
                          {job.lastRun.failedCount > 0
                            ? t("jobs.failedSuffix", { count: format.number(job.lastRun.failedCount) })
                            : ""}{" "}
                          · {duration(job.lastRun.durationMs, t, format)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {job.nextRunAt ? format.dateTime(job.nextRunAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {job.failuresLast24h > 0 ? (
                        <span className="text-danger-fg">{format.number(job.failuresLast24h)}</span>
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
          {t("jobs.utcNote")}
        </p>
      </section>
    </div>
  );
}
