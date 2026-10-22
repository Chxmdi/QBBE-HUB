import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge } from "@/components/shared/status-badges";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/lib/auth";
import { getLocale, getT } from "@/lib/i18n/server";
import { calendarDateFormats } from "@/features/calendar/components/week-view";
import { anchorDay, dayAsLocalDate } from "@/features/calendar/calendar-model";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/entities";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("schedule.title") };
}
export const dynamic = "force-dynamic";

const WINDOW_MONTHS = 6;

const HEALTH_BAR: Record<string, string> = {
  on_track: "bg-(--color-chart-good)",
  at_risk: "bg-(--color-chart-todo)",
  off_track: "bg-(--color-chart-overdue)",
  paused: "bg-muted/50",
  unknown: "bg-(--color-chart-progress)",
};

// The chart colours are light tints in dark mode, so white text on them
// failed contrast there (axe, qa-matrix, #101); dark mode uses the canvas.
// ink turns light in dark mode too, which the amber bar could not carry.
const HEALTH_BAR_TEXT: Record<string, string> = {
  at_risk: "text-ink dark:text-canvas",
  paused: "text-ink",
};
const HEALTH_BAR_TEXT_DEFAULT = "text-white dark:text-canvas";

/**
 * Master Schedule (P0-GNT-01): server-prepared bounded window — never an
 * unbounded multi-year DOM timeline (CAL-006).
 */
/** Whole days from one YYYY-MM-DD to another, independent of any zone. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The first of the month `months` away from the month of `day`. */
function monthStart(day: string, months: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default async function SchedulePage() {
  const session = await requireSession();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const formats = calendarDateFormats(locale);
  const supabase = await createSupabasePageClient();

  // Days as YYYY-MM-DD in the workspace zone: the server runs in UTC, so
  // "today" from new Date() moved to tomorrow every evening.
  const today = anchorDay(undefined, session.timeZone);
  const windowStart = monthStart(today, -1);
  const windowEnd = monthStart(windowStart, WINDOW_MONTHS);
  const totalDays = daysBetween(windowStart, windowEnd);

  const { data: projects } = await supabase
    .from("project")
    .select(
      "id, name, stage, health, start_date, target_date, program:program_id(id, name)",
    )
    .is("archived_at", null)
    .in("stage", ["approved", "planning", "active", "paused"])
    .not("target_date", "is", null)
    .order("start_date", { ascending: true })
    .limit(60);

  const projectList = ((projects ?? []) as unknown as Project[]).filter(
    (p) => p.target_date,
  );

  const months = Array.from({ length: WINDOW_MONTHS }, (_, i) =>
    monthStart(windowStart, i),
  );
  const todayOffset = (daysBetween(windowStart, today) / totalDays) * 100;

  return (
    <div>
      <PageHeader
        eyebrow={t("schedule.eyebrow")}
        title={t("schedule.title")}
        description={t("schedule.description", {
          start: format(dayAsLocalDate(windowStart), formats.shortMonthYear, formats.options),
          end: format(dayAsLocalDate(monthStart(windowEnd, -1)), formats.shortMonthYear, formats.options),
        })}
      />

      {projectList.length === 0 ? (
        <EmptyState
          icon={<CalendarRange />}
          title={t("schedule.emptyTitle")}
          description={t("schedule.emptyDescription")}
        />
      ) : (
        <div className="card overflow-x-auto">
          <div className="min-w-[860px]">
            {/* Month header */}
            <div className="flex border-b border-line bg-surface-soft/60">
              <div className="w-64 shrink-0 border-r border-line px-4 py-2 text-[11.5px] font-semibold tracking-wide text-muted uppercase">
                {t("schedule.project")}
              </div>
              <div className="relative flex flex-1">
                {months.map((month) => (
                  <div
                    key={month}
                    className="flex-1 border-r border-line px-2 py-2 text-[11.5px] font-semibold tracking-wide text-muted uppercase last:border-r-0"
                  >
                    {format(dayAsLocalDate(month), formats.shortMonthYear, formats.options)}
                  </div>
                ))}
              </div>
            </div>

            {/* Rows */}
            <div className="relative">
              {/* Today marker */}
              {todayOffset >= 0 && todayOffset <= 100 ? (
                <div
                  aria-hidden
                  className="absolute inset-y-0 z-(--z-raised) w-0.5 bg-brand/70"
                  style={{ left: `calc(16rem + (100% - 16rem) * ${todayOffset / 100})` }}
                  title={t("schedule.today")}
                />
              ) : null}
              {projectList.map((project) => {
                const start = project.start_date ?? windowStart;
                const end = project.target_date!;
                const startOffset = Math.max(
                  (daysBetween(windowStart, start) / totalDays) * 100,
                  0,
                );
                const endOffset = Math.min(
                  (daysBetween(windowStart, end) / totalDays) * 100,
                  100,
                );
                const width = Math.max(endOffset - startOffset, 1.5);
                const visible = endOffset > 0 && startOffset < 100;
                return (
                  <div
                    key={project.id}
                    className="flex border-b border-line last:border-b-0"
                  >
                    <div className="w-64 shrink-0 border-r border-line px-4 py-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="block truncate text-[13.5px] font-medium hover:text-brand-fg"
                      >
                        {project.name}
                      </Link>
                      <p className="meta truncate">
                        {project.program?.name ?? t("schedule.independent")} ·{" "}
                        {format(dayAsLocalDate(end.slice(0, 10)), formats.shortDay, formats.options)}
                      </p>
                    </div>
                    <div className="relative flex-1 py-3">
                      {visible ? (
                        <Link
                          href={`/projects/${project.id}`}
                          title={`${project.name}: ${project.start_date ?? "—"} → ${project.target_date}`}
                          className={cn(
                            "absolute top-1/2 flex h-5 -translate-y-1/2 items-center overflow-hidden rounded-full px-2",
                            HEALTH_BAR[project.health] ?? HEALTH_BAR.unknown,
                          )}
                          style={{ left: `${startOffset}%`, width: `${width}%` }}
                        >
                          <span
                            className={cn(
                              "truncate text-[10.5px] font-semibold",
                              HEALTH_BAR_TEXT[project.health] ?? HEALTH_BAR_TEXT_DEFAULT,
                            )}
                          >
                            {project.name}
                          </span>
                        </Link>
                      ) : (
                        <p className="meta px-2">{t("schedule.outsideWindow")}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Health legend with text labels */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {(["on_track", "at_risk", "off_track", "paused", "unknown"] as const).map(
          (health) => (
            <HealthBadge key={health} health={health} />
          ),
        )}
      </div>
    </div>
  );
}
