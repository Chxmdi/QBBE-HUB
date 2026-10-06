import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { reportError } from "@/lib/observability";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calendarDateInZone } from "@/lib/time";
import { runLensAll } from "@/lib/query/run";
import type { LensNode, LensSpec } from "@/lib/query/spec";
import { OPEN_STATUSES } from "@/features/tasks/filters";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { getLens } from "@/features/lenses/services/lens-store.queries";
import { barFor, type Edge, type TimelineBar } from "@/features/lenses/timeline/model";
import { TimelineLens } from "@/features/lenses/timeline/timeline-lens";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("timeline.title") };
}
export const dynamic = "force-dynamic";

const MAX_BARS = 300;

/**
 * The timeline lens (V1-2), behind wos_lenses: a lens's dated tasks as bars,
 * with dependency arrows. `?lens=<id>` for a saved task lens; otherwise open
 * tasks with a date.
 */
export default async function TimelineLensPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  const session = await requireSession();
  const t = await getLensT();
  const params = await searchParams;
  const lensId = Array.isArray(params.lens) ? params.lens[0] : params.lens;
  const lens = lensId ? await getLens(session.userId, lensId) : null;
  const supabase = await createSupabaseServerClient();
  const today = calendarDateInZone(new Date(), session.timeZone) ?? new Date().toISOString().slice(0, 10);

  let bars: TimelineBar[] = [];
  let edges: Edge[] = [];
  let undated = 0;
  let failed = false;
  try {
    const base: Partial<LensSpec> = lens?.typeKey === "task" ? (lens.spec as LensSpec) : {};
    const own: LensNode[] = base.where ? ("and" in base.where ? base.where.and : [base.where]) : [{ property: "status", operator: "is_any_of", value: [...OPEN_STATUSES] }];
    const spec: LensSpec = {
      version: 1,
      type: "task",
      where: { and: [...own, { or: [{ property: "start", operator: "is_not_empty" }, { property: "due", operator: "is_not_empty" }] }] },
      sort: [{ property: "start", direction: "asc" }, { property: "due", direction: "asc" }, { property: "title", direction: "asc" }],
      select: ["start", "due", "status"],
      limit: MAX_BARS,
    };
    const result = await runLensAll(supabase, spec, { timeZone: session.timeZone, maxRows: MAX_BARS });
    const ids = result.rows.map((r) => r.id);
    const [editableRes, depsRes, undatedRes] = await Promise.all([
      supabase.rpc("lens_editable", { p_ids: ids }),
      ids.length
        ? supabase.from("task_dependency").select("blocking_task_id, blocked_task_id").in("blocked_task_id", ids)
        : Promise.resolve({ data: [], error: null }),
      runLensAll(supabase, { version: 1, type: "task", where: { and: [...own, { property: "start", operator: "is_empty" }, { property: "due", operator: "is_empty" }] }, limit: 1 }, { timeZone: session.timeZone, maxRows: 1 }),
    ]);
    if (editableRes.error) reportError(editableRes.error, { lens: "timeline", step: "editable" });
    if (depsRes.error) reportError(depsRes.error, { lens: "timeline", step: "dependencies" });
    const editable = new Set((editableRes.data as string[] | null) ?? []);
    bars = result.rows
      .map((r) =>
        barFor(
          {
            id: r.id,
            title: r.title,
            start: typeof r.values.start === "string" ? r.values.start : null,
            due: typeof r.values.due === "string" ? r.values.due : null,
            done: r.values.status === "completed",
          },
          editable.has(r.id),
        ),
      )
      .filter((b): b is TimelineBar => b !== null);
    const shownIds = new Set(bars.map((b) => b.id));
    edges = ((depsRes.data ?? []) as { blocking_task_id: string; blocked_task_id: string }[])
      .filter((d) => shownIds.has(d.blocking_task_id) && shownIds.has(d.blocked_task_id))
      .map((d) => ({ blocking: d.blocking_task_id, blocked: d.blocked_task_id }));
    undated = undatedRes.total;
  } catch (error) {
    reportError(error, { lens: "timeline" });
    failed = true;
  }

  return (
    <div>
      <PageHeader eyebrow={lens?.name ?? t("types.task")} title={t("timeline.title")} description={t("timeline.description")} />
      {failed ? (
        <p role="alert" className="text-[13.5px] text-danger-fg">
          {t("common.loadFailed")}
        </p>
      ) : (
        <>
          <TimelineLens bars={bars} edges={edges} today={today} />
          {undated > 0 ? <p className="mt-3 text-[13px] text-muted">{t("timeline.undated", { count: undated })}</p> : null}
        </>
      )}
    </div>
  );
}
