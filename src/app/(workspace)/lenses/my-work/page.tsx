import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { TaskFilterBar } from "@/features/tasks/components/task-filter-bar";
import { parseTaskFilters } from "@/features/tasks/filters";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { calendarDateInZone } from "@/lib/time";
import { myWorkBucket } from "@/lib/utils";
import type { LensRow } from "@/lib/query/run";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { myOwnedSpec, myReviewSpec } from "@/features/lenses/task-specs";
import { loadTaskLens } from "@/features/lenses/load";
import { ListLens, type ListSection } from "@/features/lenses/components/list-lens";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("myWork.title") };
}
export const dynamic = "force-dynamic";

/**
 * My Work on the lens engine (M8c): the new version of /my-work, behind
 * wos_lenses. Same buckets and URL filters; /my-work itself is unchanged.
 */
export default async function LensMyWorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  const session = await requireSession();
  const t = await getLensT();
  const filters = parseTaskFilters(await searchParams);
  const today = calendarDateInZone(new Date(), session.timeZone) ?? "";
  const owned = myOwnedSpec(filters, today);
  const review = myReviewSpec(filters, today);
  const [{ results }, options] = await Promise.all([
    loadTaskLens([owned.spec, review.spec], session.timeZone),
    getPickerOptions(),
  ]);
  const [ownedResult, reviewResult] = results;

  const buckets: Record<ReturnType<typeof myWorkBucket>, LensRow[]> = { overdue: [], today: [], this_week: [], later: [] };
  for (const row of ownedResult?.rows ?? []) {
    const due = typeof row.values.due === "string" ? row.values.due : null;
    buckets[myWorkBucket(due, session.timeZone)].push(row);
  }
  const sections: ListSection[] = [
    { key: "review", label: t("myWork.review"), rows: reviewResult?.rows ?? [] },
    { key: "blocked", label: t("myWork.blocked"), rows: (ownedResult?.rows ?? []).filter((r) => r.values.status === "blocked") },
    { key: "overdue", label: t("myWork.overdue"), rows: buckets.overdue },
    { key: "today", label: t("myWork.today"), rows: buckets.today },
    { key: "this_week", label: t("myWork.thisWeek"), rows: buckets.this_week },
    { key: "later", label: t("myWork.later"), rows: buckets.later },
  ];

  return (
    <div>
      <PageHeader eyebrow={t("types.task")} title={t("myWork.title")} description={t("myWork.description")} />
      <Suspense fallback={<div className="mb-5 h-9" />}>
        <TaskFilterBar filters={filters} options={options} basePath="/lenses/my-work" showOwner={false} />
      </Suspense>
      {owned.unsupported.length ? (
        <p role="note" className="mb-4 rounded-(--radius-md) border border-warning/30 bg-warning/10 px-4 py-2.5 text-[13px] text-warning-fg">
          {t("board.unsupported")}
        </p>
      ) : null}
      {ownedResult && reviewResult ? (
        <ListLens sections={sections} timeZone={session.timeZone} />
      ) : (
        <p role="alert" className="text-[13.5px] text-danger-fg">
          {t("common.loadFailed")}
        </p>
      )}
    </div>
  );
}
