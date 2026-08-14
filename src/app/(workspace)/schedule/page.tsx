import type { Metadata } from "next";
import Link from "next/link";
import {
  addMonths,
  differenceInCalendarDays,
  format,
  startOfMonth,
} from "date-fns";
import { CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge } from "@/components/shared/status-badges";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/entities";

export const metadata: Metadata = { title: "Master Schedule" };
export const dynamic = "force-dynamic";

const WINDOW_MONTHS = 6;

const HEALTH_BAR: Record<string, string> = {
  on_track: "bg-(--color-chart-good)",
  at_risk: "bg-(--color-chart-todo)",
  off_track: "bg-(--color-chart-overdue)",
  paused: "bg-muted/50",
  unknown: "bg-(--color-chart-progress)",
};

/**
 * Master Schedule (P0-GNT-01): server-prepared bounded window — never an
 * unbounded multi-year DOM timeline (CAL-006).
 */
export default async function SchedulePage() {
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const windowStart = startOfMonth(addMonths(new Date(), -1));
  const windowEnd = addMonths(windowStart, WINDOW_MONTHS);
  const totalDays = differenceInCalendarDays(windowEnd, windowStart);

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
    addMonths(windowStart, i),
  );
  const todayOffset =
    (differenceInCalendarDays(new Date(), windowStart) / totalDays) * 100;

  return (
    <div>
      <PageHeader
        eyebrow="Portfolio timeline"
        title="Master Schedule"
        description={`Project timelines across the portfolio, ${format(windowStart, "MMM yyyy")} – ${format(addMonths(windowEnd, -1), "MMM yyyy")}. Health is shown on each bar.`}
      />

      {projectList.length === 0 ? (
        <EmptyState
          icon={<CalendarRange />}
          title="No scheduled projects"
          description="Projects with start and target dates appear here as portfolio timeline bars."
        />
      ) : (
        <div className="card overflow-x-auto">
          <div className="min-w-[860px]">
            {/* Month header */}
            <div className="flex border-b border-line bg-surface-soft/60">
              <div className="w-64 shrink-0 border-r border-line px-4 py-2 text-[11.5px] font-semibold tracking-wide text-muted uppercase">
                Project
              </div>
              <div className="relative flex flex-1">
                {months.map((month) => (
                  <div
                    key={month.toISOString()}
                    className="flex-1 border-r border-line px-2 py-2 text-[11.5px] font-semibold tracking-wide text-muted uppercase last:border-r-0"
                  >
                    {format(month, "MMM yyyy")}
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
                  className="absolute inset-y-0 z-10 w-0.5 bg-brand/70"
                  style={{ left: `calc(16rem + (100% - 16rem) * ${todayOffset / 100})` }}
                  title="Today"
                />
              ) : null}
              {projectList.map((project) => {
                const start = project.start_date
                  ? new Date(project.start_date)
                  : windowStart;
                const end = new Date(project.target_date!);
                const startOffset = Math.max(
                  (differenceInCalendarDays(start, windowStart) / totalDays) * 100,
                  0,
                );
                const endOffset = Math.min(
                  (differenceInCalendarDays(end, windowStart) / totalDays) * 100,
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
                        {project.program?.name ?? "Independent"} ·{" "}
                        {format(end, "MMM d")}
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
                          <span className="truncate text-[10.5px] font-semibold text-white">
                            {project.name}
                          </span>
                        </Link>
                      ) : (
                        <p className="meta px-2">Outside this window</p>
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
