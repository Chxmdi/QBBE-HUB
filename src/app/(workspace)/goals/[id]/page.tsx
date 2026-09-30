import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { goalsEnabled } from "@/features/goals/flag";
import { goalsT } from "@/features/goals/i18n";
import { percent } from "@/features/goals/progress";
import { getGoal, getGoalOptions } from "@/features/goals/services/goal.queries";
import { ProgressBar } from "@/features/goals/components/progress-bar";
import { GoalLinkForm, GoalStatusForm, UnlinkButton } from "@/features/goals/components/goal-manage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: goalsT(await getLocale())("goal") };
}

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await goalsEnabled())) notFound();
  await requireSession();
  const { id } = await params;
  const [locale, format] = await Promise.all([getLocale(), getFormatters()]);
  const t = goalsT(locale);
  const goal = await getGoal(id);
  if (!goal) notFound();
  const options = goal.canManage ? await getGoalOptions() : null;
  const pct = percent(goal.progress);
  const projects = goal.parts.filter((p) => p.kind === "project");
  const metrics = goal.parts.filter((p) => p.kind === "metric");
  const linked = new Set(goal.parts.map((p) => p.id));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={goal.program?.name ?? t("orgWide")}
        title={goal.title}
        description={goal.description ?? undefined}
        actions={<Link href="/goals" className="text-sm text-brand-fg underline">{t("allGoals")}</Link>}
      />
      <div className="mb-6 space-y-3">
        <ProgressBar
          value={pct}
          label={t("progress")}
          text={pct === null ? t("notMeasured") : t("progressValue", { percent: pct })}
        />
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <Badge tone={goal.status === "achieved" ? "success" : goal.status === "dropped" ? "neutral" : "brand"}>
            {t(`status.${goal.status}`)}
          </Badge>
          <span>{t("owner")}: {goal.owner?.name ?? "—"}</span>
          <span>· {goal.targetOn ? `${t("target")}: ${format.date(`${goal.targetOn}T12:00:00Z`)}` : t("noTarget")}</span>
        </p>
        {goal.canManage ? <GoalStatusForm goalId={goal.id} status={goal.status} /> : null}
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <section aria-labelledby="goal-projects" className="space-y-3">
          <h2 id="goal-projects" className="section-heading">{t("links.projects")}</h2>
          {projects.length === 0 ? <p className="text-sm text-muted">{t("links.noProjects")}</p> : (
            <ul className="space-y-2">
              {projects.map((p) => {
                const name = p.label ?? t("links.hiddenProject");
                const value = percent(p.progress);
                return (
                  <li key={p.id} className="card space-y-2 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      {p.label ? <Link href={`/projects/${p.id}`} className="text-ink hover:underline">{name}</Link> : <span className="text-muted">{name}</span>}
                      {goal.canManage ? <UnlinkButton goalId={goal.id} kind="project" refId={p.id} name={name} /> : null}
                    </div>
                    <ProgressBar
                      value={value}
                      label={name}
                      text={p.detail.completed ? t("links.projectCompleted") : t("links.projectDetail", { done: p.detail.done ?? 0, total: p.detail.total ?? 0 })}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {options ? <GoalLinkForm goalId={goal.id} kind="project" options={options.projects.filter((o) => !linked.has(o.id))} /> : null}
        </section>

        <section aria-labelledby="goal-metrics" className="space-y-3">
          <h2 id="goal-metrics" className="section-heading">{t("links.metrics")}</h2>
          {metrics.length === 0 ? <p className="text-sm text-muted">{t("links.noMetrics")}</p> : (
            <ul className="space-y-2">
              {metrics.map((m) => {
                const name = m.label ?? "";
                const value = percent(m.progress);
                return (
                  <li key={m.id} className="card space-y-2 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink">{name}</span>
                      {goal.canManage ? <UnlinkButton goalId={goal.id} kind="metric" refId={m.id} name={name} /> : null}
                    </div>
                    <ProgressBar
                      value={value}
                      label={name}
                      text={value === null ? t("links.metricNoData") : t("links.metricDetail", { latest: m.detail.latest ?? 0, target: m.detail.target ?? 0 })}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {options ? <GoalLinkForm goalId={goal.id} kind="metric" options={options.metrics.filter((o) => !linked.has(o.id))} /> : null}
        </section>
      </div>
    </div>
  );
}
