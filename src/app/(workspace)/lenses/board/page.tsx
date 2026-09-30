import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { TaskFilterBar } from "@/features/tasks/components/task-filter-bar";
import { parseTaskFilters } from "@/features/tasks/filters";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { calendarDateInZone } from "@/lib/time";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { boardSpec } from "@/features/lenses/task-specs";
import { loadTaskLens } from "@/features/lenses/load";
import { BoardLens } from "@/features/lenses/components/board-lens";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("board.title") };
}
export const dynamic = "force-dynamic";

/**
 * The board on the lens engine (M8c): the new version of /board, behind
 * wos_lenses. Same URL filters as /board; /board itself is unchanged.
 */
export default async function LensBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  const session = await requireSession();
  const t = await getLensT();
  const filters = parseTaskFilters(await searchParams);
  const today = calendarDateInZone(new Date(), session.timeZone) ?? "";
  const { spec, unsupported } = boardSpec(filters, today);
  const [{ results, property }, options] = await Promise.all([
    loadTaskLens([spec], session.timeZone),
    getPickerOptions(),
  ]);
  const result = results[0];

  return (
    <div>
      <PageHeader eyebrow={t("types.task")} title={t("board.title")} description={t("board.description")} />
      <Suspense fallback={<div className="mb-5 h-9" />}>
        <TaskFilterBar filters={filters} options={options} basePath="/lenses/board" />
      </Suspense>
      {unsupported.length ? (
        <p role="note" className="mb-4 rounded-(--radius-md) border border-warning/30 bg-warning/10 px-4 py-2.5 text-[13px] text-warning-fg">
          {t("board.unsupported")}
        </p>
      ) : null}
      {result && property ? (
        <BoardLens rows={result.rows} groupProperty={property} timeZone={session.timeZone} />
      ) : (
        <p role="alert" className="text-[13.5px] text-danger-fg">
          {t("common.loadFailed")}
        </p>
      )}
    </div>
  );
}
