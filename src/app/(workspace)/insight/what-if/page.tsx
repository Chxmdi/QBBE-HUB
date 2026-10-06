import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { requireInsightEnabled } from "@/features/insight/gate";
import { getInsightT } from "@/features/insight/i18n/translate";
import { planFingerprint, planShift, clampDays, MAX_SHIFT_DAYS, type DateMove } from "@/features/insight/whatif/whatif";
import { applyMilestoneShift } from "@/features/insight/whatif/whatif.actions";
import { loadSchedule } from "@/features/insight/whatif/whatif.source";
import { requireSession } from "@/lib/auth";
import { getFormatters } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getInsightT())("whatif.title") };
}
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const RESULTS = ["applied", "stale", "forbidden", "nothing", "failed"] as const;
type Result = (typeof RESULTS)[number];

const th = "whitespace-nowrap px-4 py-2 font-medium";
const td = "whitespace-nowrap px-4 py-2 tabular-nums text-ink";

export default async function WhatIfPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireInsightEnabled();
  await requireSession();
  const [params, t, format, client] = await Promise.all([
    searchParams,
    getInsightT(),
    getFormatters(),
    createSupabasePageClient(),
  ]);
  const { schedule, options } = await loadSchedule(client);
  const milestoneId = first(params.milestone) ?? "";
  const days = clampDays(first(params.days) ?? 0);
  const result = RESULTS.find((value) => value === first(params.result)) as Result | undefined;
  const plan = milestoneId && days !== 0 ? planShift(schedule, milestoneId, days) : null;

  const date = (value: string | null) => (value ? format.inZone(`${value}T12:00:00Z`, "UTC", { dateStyle: "medium" }) : "—");
  const names = new Map<string, string>([
    ...schedule.milestones.map((m) => [m.id, m.name] as const),
    ...schedule.tasks.map((task) => [task.id, task.title] as const),
  ]);
  const why = (move: DateMove) =>
    move.reason === "shifted" ? t("whatif.reason.shifted") : t(`whatif.reason.${move.reason}`, { name: names.get(move.cause ?? "") ?? "" });

  const moveTable = (heading: string, moves: DateMove[], id: string) =>
    moves.length ? (
      <section aria-labelledby={id} className="mb-6">
        <h2 id={id} className="mb-2 text-title font-semibold text-ink">{heading}</h2>
        <div className="overflow-x-auto rounded-(--radius-md) border border-line bg-surface">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className={th}>{t("whatif.columns.name")}</th>
                <th scope="col" className={th}>{t("whatif.columns.from")}</th>
                <th scope="col" className={th}>{t("whatif.columns.to")}</th>
                <th scope="col" className={th}>{t("whatif.columns.why")}</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((move) => (
                <tr key={move.id} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="px-4 py-2 font-medium text-ink">{move.name}</th>
                  <td className={td}>{date(move.from)}</td>
                  <td className={`${td} font-medium`}>{date(move.to)}</td>
                  <td className="px-4 py-2 text-muted">{why(move)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ) : null;

  return (
    <div>
      <PageHeader eyebrow={t("common.eyebrow")} title={t("whatif.title")} description={t("whatif.description")} />
      {result ? (
        <p
          role={result === "applied" ? "status" : "alert"}
          className={`mb-4 rounded-(--radius-md) border px-4 py-3 text-body-sm ${
            result === "applied" ? "border-success/40 bg-surface text-success-fg" : "border-danger/40 bg-surface text-danger-fg"
          }`}
        >
          {t(`whatif.result.${result}`, { count: format.number(Number(first(params.moved) ?? 0)) })}
        </p>
      ) : null}

      {options.length === 0 ? (
        <p className="text-body-sm text-muted">{t("whatif.noMilestones")}</p>
      ) : (
        <form
          method="get"
          action="/insight/what-if"
          aria-label={t("whatif.formLabel")}
          className="mb-3 flex flex-wrap items-end gap-4 rounded-(--radius-md) border border-line bg-surface p-4"
        >
          <label className="flex min-w-64 flex-col gap-1 text-body-sm font-medium text-ink">
            {t("whatif.milestone")}
            <Select name="milestone" defaultValue={milestoneId} required>
              <option value="" disabled>{t("whatif.chooseMilestone")}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.projectName}: {option.name} ({date(option.due)})
                </option>
              ))}
            </Select>
          </label>
          <label className="flex w-40 flex-col gap-1 text-body-sm font-medium text-ink">
            {t("whatif.days")}
            <Input
              type="number"
              name="days"
              min={-MAX_SHIFT_DAYS}
              max={MAX_SHIFT_DAYS}
              step={1}
              defaultValue={days || 7}
              required
              aria-describedby="whatif-days-hint"
            />
          </label>
          <Button type="submit">{t("whatif.preview")}</Button>
          <p id="whatif-days-hint" className="w-full text-meta text-muted">{t("whatif.daysHint")}</p>
        </form>
      )}
      <p className="mb-6 text-body-sm text-muted">{t("whatif.rules")}</p>

      {plan ? (
        plan.milestones.length + plan.tasks.length === 0 ? (
          <p className="text-body-sm text-muted">{t("whatif.nothingMoves")}</p>
        ) : (
          <>
            <p className="mb-4 text-body font-medium text-ink" aria-live="polite">
              {t("whatif.summary", { milestones: format.number(plan.milestones.length), tasks: format.number(plan.tasks.length) })}
            </p>
            {moveTable(t("whatif.milestonesHeading"), plan.milestones, "whatif-milestones")}
            {moveTable(t("whatif.tasksHeading"), plan.tasks, "whatif-tasks")}
            {plan.projects.length ? (
              <section aria-labelledby="whatif-projects" className="mb-6">
                <h2 id="whatif-projects" className="mb-2 text-title font-semibold text-ink">{t("whatif.projectsHeading")}</h2>
                <ul className="space-y-1 text-body-sm text-ink">
                  {plan.projects.map((project) => (
                    <li key={project.id}>
                      <span className="font-medium">{project.name}</span>: {date(project.from)} → {date(project.to)}
                      {project.pastTarget ? <span className="text-danger-fg"> ({t("whatif.pastTarget", { date: date(project.pastTarget) })})</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section aria-labelledby="whatif-goals" className="mb-6">
              <h2 id="whatif-goals" className="mb-2 text-title font-semibold text-ink">{t("whatif.goalsHeading")}</h2>
              {plan.goals.length ? (
                <ul className="space-y-1 text-body-sm text-ink">
                  {plan.goals.map((goal) => (
                    <li key={`${goal.id}-${goal.projectId}`}>
                      <span className="font-medium">{goal.name}</span>: {t("whatif.columns.target")} {date(goal.targetOn)},{" "}
                      {t("whatif.columns.finishNew").toLowerCase()} {date(goal.projectFinish)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-sm text-muted">{t("whatif.goalsNone")}</p>
              )}
            </section>
            <form action={applyMilestoneShift} className="rounded-(--radius-md) border border-line bg-surface-soft p-4">
              <input type="hidden" name="milestone" value={plan.milestoneId} />
              <input type="hidden" name="days" value={plan.days} />
              <input type="hidden" name="fingerprint" value={planFingerprint(plan)} />
              <p id="whatif-apply-hint" className="mb-3 text-body-sm text-muted">{t("whatif.applyHint")}</p>
              <Button type="submit" aria-describedby="whatif-apply-hint">{t("whatif.apply")}</Button>
            </form>
          </>
        )
      ) : null}
    </div>
  );
}
