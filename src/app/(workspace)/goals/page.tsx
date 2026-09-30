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
import { getGoalOptions, listGoals } from "@/features/goals/services/goal.queries";
import { GoalCreateForm } from "@/features/goals/components/goal-create-form";
import { ProgressBar } from "@/features/goals/components/progress-bar";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: goalsT(await getLocale())("title") };
}

const STATUS_TONE = { active: "brand", achieved: "success", dropped: "neutral" } as const;

export default async function GoalsPage() {
  if (!(await goalsEnabled())) notFound();
  const session = await requireSession();
  const [locale, format] = await Promise.all([getLocale(), getFormatters()]);
  const t = goalsT(locale);
  const [goals, options] = await Promise.all([listGoals(), session.isStaff ? getGoalOptions() : null]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("title")} description={t("description")} />
      {options ? (
        <div className="mb-8">
          <GoalCreateForm programs={options.programs} people={options.people} />
        </div>
      ) : null}
      {goals.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {goals.map((g) => {
            const pct = percent(g.progress);
            return (
              <li key={g.id} className="card space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[15px] font-semibold text-ink">
                    <Link href={`/goals/${g.id}`} className="hover:underline">{g.title}</Link>
                  </h2>
                  <Badge tone={STATUS_TONE[g.status]}>{t(`status.${g.status}`)}</Badge>
                </div>
                <p className="text-[12.5px] text-muted">
                  {g.program?.name ?? t("orgWide")}
                  {g.targetOn ? ` · ${format.date(`${g.targetOn}T12:00:00Z`)}` : ""}
                </p>
                <ProgressBar
                  value={pct}
                  label={t("progress")}
                  text={pct === null ? t("notMeasured") : t("progressValue", { percent: pct })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
