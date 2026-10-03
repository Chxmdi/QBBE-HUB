import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Hash,
  Megaphone,
  OctagonAlert,
  Plus,
  Presentation,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { HealthBadge } from "@/components/shared/status-badges";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AcknowledgeButton } from "@/features/announcements/components/acknowledge-button";
import { AccountantHomeCard } from "@/features/ledger/components/accountant-home-card";
import {
  ProgressBar,
  StatusDonut,
  WeeklyBars,
} from "@/features/dashboard/components/charts";
import { dashboardLens } from "@/features/dashboard/portfolio";
import { getDashboardData } from "@/features/dashboard/services/dashboard.queries";
import {
  getCommitments,
  getOutcomeRollup,
  getPortfolio,
  getWorkload,
} from "@/features/dashboard/services/portfolio.queries";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { managedPrograms } from "@/features/budgets/services/budget.queries";
import { calendarDateInZone, viewerTimeZone } from "@/lib/time";
import type { ProjectHealth, Task } from "@/types/entities";
import { healthSummaryLabel } from "@/features/dashboard/health";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("home.title") };
}
export const dynamic = "force-dynamic";

function greetingFor(timezone: string, t: TranslateFn): string {
  // A number for comparison, not display text, so the language is fixed.
  const hour = Number(
    new Intl.DateTimeFormat("en-CA", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(new Date()),
  );
  if (hour < 12) return t("home.greeting.morning");
  if (hour < 17) return t("home.greeting.afternoon");
  return t("home.greeting.evening");
}

function AttentionLink({
  title,
  reason,
  href,
  openLabel,
}: {
  title: string;
  reason: string;
  href: string;
  openLabel: string;
}) {
  return (
    <li className="interactive-row flex items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1">
        <Link
          href={href}
          className="block truncate text-[13.5px] font-medium hover:text-brand-fg"
        >
          {title}
        </Link>
        <span className="meta">{reason}</span>
      </span>
      <Link
        href={href}
        aria-label={openLabel}
        className="text-muted hover:text-brand-fg"
      >
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </li>
  );
}

function AttentionTask({
  task,
  reason,
  openLabel,
}: {
  task: Task;
  reason: string;
  openLabel: string;
}) {
  return (
    <li className="interactive-row flex items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">
          {task.title}
        </span>
        <span className="meta">{reason}</span>
      </span>
      {task.assignee ? (
        <Avatar
          name={task.assignee.full_name}
          src={task.assignee.avatar_url}
          size="sm"
        />
      ) : null}
      <Link
        href={`/my-work?task=${task.id}`}
        aria-label={openLabel}
        className="text-muted hover:text-brand-fg"
      >
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </li>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const session = await requireSession();
  const denied = (await searchParams).denied === "1";
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  const lens = dashboardLens(session.role);
  const showPortfolio = lens !== "volunteer";
  const [data, portfolio, workload, outcomes, commitments, canCreateProject] = await Promise.all([
    getDashboardData(session.userId, session.timeZone),
    showPortfolio
      ? getPortfolio({
          userId: session.userId,
          role: session.role,
          filters: {},
        })
      : Promise.resolve(null),
    showPortfolio
      ? getWorkload(session.timeZone)
      : Promise.resolve({ people: [], teams: [] }),
    showPortfolio ? getOutcomeRollup() : Promise.resolve([]),
    getCommitments(session.timeZone),
    // A project goes inside a program its creator manages; only an
    // administrator may create one outside every program.
    session.isAdmin
      ? Promise.resolve(true)
      : session.isStaff
        ? createSupabasePageClient()
            .then((supabase) => managedPrograms(supabase, session.organizationId))
            .then((programs) => programs.length > 0)
        : Promise.resolve(false),
  ]);
  const todayInZone =
    calendarDateInZone(new Date(), session.timeZone) ??
    new Date().toISOString().slice(0, 10);
  const firstName = session.profile.full_name.split(" ")[0] ?? "";
  // Two zones, deliberately, because the page answers two kinds of question.
  //
  // `timezone` is the viewer's own: a greeting depends on whether it is morning
  // where the reader is sitting, and nobody else's opinion of that matters.
  //
  // `session.timeZone` is the workspace's, and overdue is answered in it.
  // Whether a task is late is a shared operational judgement, so two colleagues
  // in different zones must get the same answer — and the query above already
  // buckets by the workspace zone. Formatting the label with the viewer's would
  // put the row's text at odds with the group it was filed under, which is the
  // defect this page had against UTC, reintroduced between people.
  const timezone = viewerTimeZone(session.profile.timezone);
  const { kpis, attention, healthCounts, statusBreakdown } = data;

  const activeTotal = Object.values(healthCounts).reduce((a, b) => a + b, 0);
  const onTrack = healthCounts["on_track"] ?? 0;
  const atRisk =
    (healthCounts["at_risk"] ?? 0) + (healthCounts["off_track"] ?? 0);
  const healthPercent =
    activeTotal > 0 ? Math.round((onTrack / activeTotal) * 100) : null;

  const completionDelta =
    data.completedPrevious30 > 0
      ? Math.round(
          ((kpis.completedLast30 - data.completedPrevious30) /
            data.completedPrevious30) *
            100,
        )
      : null;

  const attentionEmpty = showPortfolio
    ? attention.overdueTasks.length === 0 &&
      attention.blockedTasks.length === 0 &&
      attention.unassignedTasks.length === 0 &&
      attention.riskyProjects.length === 0 &&
      attention.overdueMilestones.length === 0 &&
      attention.pendingDecisions.length === 0 &&
      attention.upcomingCommitments.length === 0
    : attention.overdueTasks.length === 0 &&
      attention.blockedTasks.length === 0;

  const rail = data.announcementRail;
  const latestAnn = rail.latest;

  return (
    <div className="grid grid-cols-1 gap-8 2xl:grid-cols-[1fr_360px]">
      {/* ============ Main column ============ */}
      <div className="min-w-0">
        <AccountantHomeCard session={session} />
        <header className="mb-6">
          <h1 className="page-title">
            {firstName
              ? t("home.greetingLine", { greeting: greetingFor(timezone, t), name: firstName })
              : greetingFor(timezone, t)}{" "}
            <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1.5 text-[14.5px] text-muted">
            {session.isStaff
              ? t("home.attentionToday")
              : t("home.overview")}
          </p>
        </header>

        {denied ? (
          <div
            role="status"
            className="mb-5 flex items-start gap-3 rounded-(--radius-md) border border-warning/40 bg-warning/10 px-4 py-3"
          >
            <AlertTriangle className="mt-0.5 size-4.5 shrink-0 text-warning-fg" aria-hidden />
            <div>
              <p className="text-[13.5px] font-semibold">{t("home.denied.title")}</p>
              {/* Full-contrast text: the muted colour on this tint falls under 4.5:1. */}
              <p className="text-[12.5px] text-ink">{t("home.denied.body")}</p>
            </div>
          </div>
        ) : null}

        {/* Required announcements beyond the rail stay pinned until acked */}
        {data.requiredAnnouncements.filter((a) => a.id !== latestAnn?.id)
          .length > 0 ? (
          <section
            aria-label={t("home.requiredAnnouncements")}
            className="mb-5 space-y-2"
          >
            {data.requiredAnnouncements
              .filter((a) => a.id !== latestAnn?.id)
              .map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-(--radius-md) border border-brand/30 bg-brand-soft/60 px-4 py-3"
                >
                  <Megaphone
                    className="size-4.5 shrink-0 text-brand-fg"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold">{a.title}</p>
                    <p className="meta">
                      {a.priority === "critical" ? t("home.criticalPrefix") : ""}
                      {t("home.ackRequired")}
                      {a.ack_deadline
                        ? t("home.ackBy", { date: format.date(a.ack_deadline) })
                        : ""}
                    </p>
                  </div>
                  <AcknowledgeButton announcementId={a.id} />
                </div>
              ))}
          </section>
        ) : null}

        {/* Hero: portfolio pulse — staff/leadership only (P0-VOL-02) */}
        {showPortfolio && portfolio ? (
          <section
            aria-label={t("home.portfolioSummary")}
            className="card mb-5 flex flex-wrap items-center gap-x-8 gap-y-4 p-5"
          >
            <div>
              <p className="flex items-baseline gap-2">
                <span className="text-[34px] leading-none font-semibold">
                  {kpis.activePrograms}
                </span>
                <span className="text-[15px] font-medium">
                  {kpis.activePrograms === 1
                    ? t("home.activeProgramOne")
                    : t("home.activeProgramOther")}
                </span>
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                <Link
                  href="/projects?stage=active"
                  className="inline-flex min-h-6 items-center hover:underline"
                >
                  {t("home.counts.active", { count: portfolio.counts.active })}
                </Link>
                <Link
                  href="/projects?health=on_track"
                  className="inline-flex min-h-6 items-center hover:underline"
                >
                  {t("home.counts.onTrack", { count: portfolio.counts.onTrack })}
                </Link>
                <Link
                  href="/projects?health=at_risk"
                  className="inline-flex min-h-6 items-center hover:underline"
                >
                  {t("home.counts.atRisk", { count: portfolio.counts.atRisk })}
                </Link>
                <Link
                  href="/projects?health=off_track"
                  className="inline-flex min-h-6 items-center hover:underline"
                >
                  {t("home.counts.offTrack", { count: portfolio.counts.offTrack })}
                </Link>
                <Link
                  href="/projects?health=paused"
                  className="inline-flex min-h-6 items-center hover:underline"
                >
                  {t("home.counts.paused", { count: portfolio.counts.paused })}
                </Link>
                <Link
                  href="/projects?stale=1"
                  className="inline-flex min-h-6 items-center hover:underline"
                >
                  {t("home.counts.stale", { count: portfolio.counts.stale })}
                </Link>
              </p>
              <p className="meta mt-1">
                {t("home.lastRefreshed", {
                  when: format.dateTime(portfolio.refreshedAt),
                })}
              </p>
            </div>
            <div className="hidden h-12 w-px bg-line sm:block" aria-hidden />
            <div>
              <p className="eyebrow">{t("home.overallHealth")}</p>
              {healthPercent === null ? (
                <p className="mt-1 text-[14px] text-muted">
                  {t("home.noActiveProjects")}
                </p>
              ) : (
                <p className="mt-0.5 flex items-baseline gap-2">
                  <span
                    className={
                      healthPercent >= 70
                        ? "text-[28px] leading-none font-semibold text-success-fg"
                        : healthPercent >= 40
                          ? "text-[28px] leading-none font-semibold text-warning-fg"
                          : "text-[28px] leading-none font-semibold text-danger-fg"
                    }
                  >
                    {healthPercent}%
                  </span>
                  <span className="text-[12.5px] text-muted">
                    {activeTotal === 1
                      ? t("home.healthOfOne", { total: activeTotal })
                      : t("home.healthOfOther", { total: activeTotal })}
                    {atRisk > 0 ? t("home.flagged", { count: atRisk }) : ""}
                  </span>
                </p>
              )}
            </div>
            {canCreateProject ? (
              <div className="ml-auto">
                <Link
                  href="/projects?create=1"
                  className="inline-flex h-9.5 items-center gap-1.5 rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
                >
                  <Plus className="size-4" aria-hidden />
                  {t("home.newProject")}
                </Link>
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* TODAY */}
          <section aria-labelledby="today-heading" className="card p-5">
            <h2 id="today-heading" className="eyebrow mb-4">
              {t("home.sections.today")}
            </h2>
            {data.todayTasks.length === 0 && data.todayMeetings.length === 0 ? (
              <p className="py-6 text-center text-[13.5px] text-muted">
                {t("home.todayEmpty")}
              </p>
            ) : (
              <ul className="space-y-1">
                {data.todayMeetings.map((meeting) => (
                  <li key={meeting.id}>
                    <Link
                      href={`/meetings/${meeting.id}`}
                      className="interactive-row -mx-2 flex items-center gap-3 rounded-(--radius-sm) px-2 py-2"
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-info/10 text-info-fg">
                        <Presentation className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">
                          {meeting.title}
                        </span>
                        <span className="meta">
                          {meeting.project?.name ?? t("home.meeting")}
                        </span>
                      </span>
                      <time className="text-[12.5px] font-medium whitespace-nowrap text-brand-fg">
                        {format.time(meeting.starts_at)}
                      </time>
                    </Link>
                  </li>
                ))}
                {data.todayTasks.map((task) => (
                  <li key={task.id}>
                    <Link
                      href="/my-work"
                      className="interactive-row -mx-2 flex items-center gap-3 rounded-(--radius-sm) px-2 py-2"
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand-fg">
                        <ClipboardList className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">
                          {task.title}
                        </span>
                        <span className="meta">
                          {task.project?.name ?? t("home.task")}
                        </span>
                      </span>
                      {/*
                        The same calendar date the query filtered on. Deriving
                        it again here from the server's UTC clock is how a task
                        came to sit under a "Due today" query while its own
                        label read "Overdue".
                      */}
                      <span
                        className={
                          task.due_at && task.due_at < todayInZone
                            ? "text-[12.5px] font-medium whitespace-nowrap text-danger-fg"
                            : "text-[12.5px] font-medium whitespace-nowrap text-warning-fg"
                        }
                      >
                        {task.due_at && task.due_at < todayInZone
                          ? t("home.overdueOn", {
                              date: format.date(task.due_at, session.timeZone),
                            })
                          : t("home.dueToday")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/my-work"
              className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
            >
              {t("home.viewMyWork")} <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </section>

          {/* PROGRAM HEALTH — staff only */}
          {session.isStaff ? (
            <section
              aria-labelledby="program-health-heading"
              className="card p-5"
            >
              <h2 id="program-health-heading" className="eyebrow mb-4">
                {t("home.sections.programHealth")}
              </h2>
              {data.programHealth.length === 0 ? (
                <p className="py-6 text-center text-[13.5px] text-muted">
                  {t(session.isAdmin ? "home.programHealthEmpty" : "home.programHealthEmptyStaff")}
                </p>
              ) : (
                <ul className="space-y-4">
                  {data.programHealth.map((program) => (
                    <li key={program.id}>
                      <Link
                        href={`/programs/${program.id}`}
                        className="group block"
                      >
                        <span className="mb-1.5 flex items-baseline justify-between gap-3">
                          <span className="truncate text-[13.5px] font-medium group-hover:text-brand-fg">
                            {program.name}
                          </span>
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            {program.totalTasks > 0 ? (
                              <span className="text-[13px] font-semibold tabular-nums">
                                {Math.round(program.completionPercent)}%
                              </span>
                            ) : null}
                            <span
                              className={
                                program.tone === "good"
                                  ? "text-[11.5px] font-medium text-success-fg"
                                  : program.tone === "attention"
                                    ? "text-[11.5px] font-medium text-warning-fg"
                                    : program.tone === "risk"
                                      ? "text-[11.5px] font-medium text-danger-fg"
                                      : "text-[11.5px] font-medium text-muted"
                              }
                            >
                              {healthSummaryLabel(program.statusLabel, t)}
                            </span>
                          </span>
                        </span>
                        <ProgressBar
                          label={t("home.programCompletion", { name: program.name })}
                          percent={program.completionPercent}
                          tone={program.tone}
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/projects"
                className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
              >
                {t("home.viewPortfolio")} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </section>
          ) : null}

          {/* ACTIVITY OVERVIEW — staff only */}
          {session.isStaff ? (
            <section
              aria-labelledby="activity-overview-heading"
              className="card p-5"
            >
              <h2 id="activity-overview-heading" className="eyebrow mb-4">
                {t("home.sections.activityOverview")}
              </h2>
              <div className="mb-4 flex items-baseline gap-3">
                <p className="text-[30px] leading-none font-semibold">
                  {kpis.completedLast30}
                </p>
                <div>
                  <p className="text-[12.5px] text-muted">
                    {t("home.tasksCompleted30")}
                  </p>
                  {completionDelta !== null ? (
                    <p
                      className={
                        completionDelta >= 0
                          ? "flex items-center gap-1 text-[12px] font-medium text-success-fg"
                          : "flex items-center gap-1 text-[12px] font-medium text-danger-fg"
                      }
                    >
                      {completionDelta >= 0 ? (
                        <TrendingUp className="size-3.5" aria-hidden />
                      ) : (
                        <TrendingDown className="size-3.5" aria-hidden />
                      )}
                      {t("home.vsPrevious", {
                        delta: `${completionDelta >= 0 ? "+" : ""}${completionDelta}`,
                      })}
                    </p>
                  ) : null}
                </div>
              </div>
              <WeeklyBars weeks={data.weeklyCompleted} />
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-3 text-[12.5px] font-medium text-muted">
                  {t("home.tasksByStatus")}
                </p>
                <StatusDonut
                  slices={[
                    {
                      label: t("home.donut.completed"),
                      value: statusBreakdown.completed,
                      colorVar: "--color-chart-good",
                    },
                    {
                      label: t("home.donut.toDo"),
                      value: statusBreakdown.toDo,
                      colorVar: "--color-chart-todo",
                    },
                    {
                      label: t("home.donut.inProgress"),
                      value: statusBreakdown.inProgress,
                      colorVar: "--color-chart-progress",
                    },
                    {
                      label: t("home.donut.overdue"),
                      value: statusBreakdown.overdue,
                      colorVar: "--color-chart-overdue",
                    },
                  ]}
                />
              </div>
            </section>
          ) : null}

          {/* UPCOMING EVENTS */}
          <section
            aria-labelledby="upcoming-events-heading"
            className="card p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="upcoming-events-heading" className="eyebrow">
                {t("home.sections.upcomingEvents")}
              </h2>
              <Link
                href="/calendar"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-fg hover:underline"
              >
                {t("home.viewCalendar")} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
            {data.upcomingEvents.length === 0 ? (
              <div className="py-6 text-center">
                <CalendarDays
                  className="mx-auto mb-2 size-7 text-muted/50"
                  aria-hidden
                />
                <p className="text-[13.5px] text-muted">
                  {t("home.noUpcomingEvents")}
                </p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {data.upcomingEvents.map((event) => {
                  return (
                    <li key={event.id}>
                      <Link
                        href={`/events/${event.id}`}
                        className="interactive-row -mx-2 flex items-center gap-3 rounded-(--radius-sm) px-2 py-2"
                      >
                        <span className="flex w-11 shrink-0 flex-col items-center rounded-(--radius-sm) border border-line bg-surface-soft/70 py-1">
                          <span className="text-[9.5px] font-bold tracking-wide text-brand-fg uppercase">
                            {format.inZone(event.starts_at, timezone, {
                              month: "short",
                            })}
                          </span>
                          <span className="text-[16px] leading-tight font-bold">
                            {format.inZone(event.starts_at, timezone, {
                              day: "2-digit",
                            })}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">
                            {event.name}
                          </span>
                          <span className="meta block truncate">
                            {format.time(event.starts_at)}
                            {event.location ? ` · ${event.location}` : ""}
                          </span>
                        </span>
                        {event.volunteer_need ? (
                          <span className="meta flex items-center gap-1 whitespace-nowrap">
                            <Users className="size-3.5" aria-hidden />
                            {event.volunteer_need}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link
              href="/events"
              className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
            >
              {t("home.viewAllEvents")} <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </section>
        </div>

        {showPortfolio ? (
          <section aria-labelledby="workload-heading" className="mt-8">
            <h2 id="workload-heading" className="section-heading mb-3">
              {t("home.sections.workload")}
            </h2>
            {workload.people.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                {t("home.workloadEmpty")}
              </p>
            ) : (
              <div className="space-y-4">
                <div
                  className="card overflow-x-auto"
                  role="region"
                  aria-label={t("home.workloadByPerson")}
                  tabIndex={0}
                >
                  <table className="w-full text-left text-[13.5px]">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="px-4 py-2 font-semibold">{t("home.table.person")}</th>
                        <th className="px-4 py-2 font-semibold">{t("home.table.active")}</th>
                        <th className="px-4 py-2 font-semibold">{t("home.table.dueSoon")}</th>
                        <th className="px-4 py-2 font-semibold">{t("home.table.overdue")}</th>
                        <th className="px-4 py-2 font-semibold">
                          {t("home.table.estimatedHours")}
                        </th>
                        <th className="px-4 py-2 font-semibold">{t("home.table.overload")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workload.people.map((person) => (
                        <tr
                          key={person.userId}
                          className="border-b border-line last:border-b-0"
                        >
                          <td className="px-4 py-2">{person.name}</td>
                          <td className="px-4 py-2">{person.active}</td>
                          <td className="px-4 py-2">{person.dueSoon}</td>
                          <td className="px-4 py-2">{person.overdue}</td>
                          <td className="px-4 py-2">
                            {person.estimatedHours === null
                              ? t("home.unknown")
                              : `${format.number(person.estimatedHours)}${person.unknownEstimates ? t("home.unknownEstimates", { count: person.unknownEstimates }) : ""}`}
                          </td>
                          <td className="px-4 py-2">
                            {person.overloaded ? t("home.possibleOverload") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {workload.teams.length > 0 ? (
                  <div
                    className="card overflow-x-auto"
                    role="region"
                    aria-label={t("home.workloadByTeam")}
                    tabIndex={0}
                  >
                    <table className="w-full text-left text-[13.5px]">
                      <thead>
                        <tr className="border-b border-line">
                          <th className="px-4 py-2 font-semibold">{t("home.table.team")}</th>
                          <th className="px-4 py-2 font-semibold">{t("home.table.active")}</th>
                          <th className="px-4 py-2 font-semibold">{t("home.table.dueSoon")}</th>
                          <th className="px-4 py-2 font-semibold">{t("home.table.overdue")}</th>
                          <th className="px-4 py-2 font-semibold">
                            {t("home.table.estimatedHours")}
                          </th>
                          <th className="px-4 py-2 font-semibold">{t("home.table.overload")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workload.teams.map((team) => (
                          <tr
                            key={team.teamId}
                            className="border-b border-line last:border-b-0"
                          >
                            <td className="px-4 py-2">{team.name}</td>
                            <td className="px-4 py-2">{team.active}</td>
                            <td className="px-4 py-2">{team.dueSoon}</td>
                            <td className="px-4 py-2">{team.overdue}</td>
                            <td className="px-4 py-2">
                              {team.estimatedHours === null
                                ? t("home.unknown")
                                : format.number(team.estimatedHours)}
                            </td>
                            <td className="px-4 py-2">
                              {team.overloaded ? t("home.possibleOverload") : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        <section aria-labelledby="commitments-heading" className="mt-8">
          <h2 id="commitments-heading" className="section-heading mb-3">
            {t("home.sections.commitments")}
          </h2>
          {commitments.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              {t("home.commitmentsEmpty")}
            </p>
          ) : (
            <ul className="card divide-y divide-line">
              {commitments.map((item) => (
                <li key={item.id} className="px-4 py-2.5">
                  <Link
                    href={item.href}
                    className="text-[13.5px] font-medium hover:text-brand-fg"
                  >
                    {item.title}
                  </Link>
                  <p className="meta">
                    {t(`home.commitmentKind.${item.kind}`)} · {item.when}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {showPortfolio ? (
          <section aria-labelledby="outcomes-heading" className="mt-8">
            <h2 id="outcomes-heading" className="section-heading mb-3">
              {t("home.sections.outcomes")}
            </h2>
            {outcomes.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                {t("home.outcomesEmpty")}
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {outcomes.map((metric) => (
                  <li key={metric.id} className="px-4 py-2.5">
                    <p className="text-[13.5px] font-medium">{metric.name}</p>
                    <p className="meta">
                      {t("home.outcomeLine", {
                        program: metric.programName,
                        latest: metric.latest ?? "—",
                        unit: metric.unit,
                        target: metric.target ?? "—",
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {/* Needs attention (P0-DASH-03) */}
        <section aria-labelledby="attention-heading" className="mt-8">
          <h2 id="attention-heading" className="section-heading mb-3">
            {t("home.sections.needsAttention")}
          </h2>
          {attentionEmpty ? (
            <div className="card px-5 py-6 text-center">
              <CheckCircle2
                className="mx-auto mb-1.5 size-6 text-success-fg"
                aria-hidden
              />
              <p className="text-[14px] font-medium">
                {t("home.attentionEmptyTitle")}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                {t("home.attentionEmptyBody")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {showPortfolio && attention.riskyProjects.length > 0 ? (
                <div className="card overflow-hidden">
                  <p className="flex items-center gap-2 border-b border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-semibold">
                    <AlertTriangle
                      className="size-3.5 text-warning-fg"
                      aria-hidden
                    />
                    {t("home.attention.projectsAtRisk")}
                  </p>
                  <ul>
                    {attention.riskyProjects.map((p) => (
                      <li
                        key={p.id}
                        className="interactive-row flex items-center gap-3 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1">
                          <Link
                            href={`/projects/${p.id}`}
                            className="block truncate text-[13.5px] font-medium hover:text-brand-fg"
                          >
                            {p.name}
                          </Link>
                          {p.health_reason ? (
                            <span className="meta">{p.health_reason}</span>
                          ) : null}
                        </span>
                        <HealthBadge health={p.health as ProjectHealth} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {attention.overdueTasks.length > 0 ? (
                <div className="card overflow-hidden">
                  <p className="flex items-center gap-2 border-b border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-semibold">
                    <OctagonAlert
                      className="size-3.5 text-danger-fg"
                      aria-hidden
                    />
                    {t("home.attention.overdueTasks")}
                  </p>
                  <ul>
                    {attention.overdueTasks.map((task) => (
                      <AttentionTask
                        key={task.id}
                        task={task}
                        openLabel={t("home.openItem", { title: task.title })}
                        reason={`${t("home.dueOn", { date: format.date(task.due_at) })}${task.project ? ` · ${task.project.name}` : ""}`}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
              {attention.blockedTasks.length > 0 ? (
                <div className="card overflow-hidden">
                  <p className="flex items-center gap-2 border-b border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-semibold">
                    <OctagonAlert
                      className="size-3.5 text-danger-fg"
                      aria-hidden
                    />
                    {t("home.attention.blockedWork")}
                  </p>
                  <ul>
                    {attention.blockedTasks.map((task) => (
                      <AttentionTask
                        key={task.id}
                        task={task}
                        openLabel={t("home.openItem", { title: task.title })}
                        reason={task.blocked_reason ?? t("home.blocked")}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
              {showPortfolio && attention.unassignedTasks.length > 0 ? (
                <div className="card overflow-hidden">
                  <p className="flex items-center gap-2 border-b border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-semibold">
                    <AlertTriangle
                      className="size-3.5 text-warning-fg"
                      aria-hidden
                    />
                    {t("home.attention.unassignedTasks")}
                  </p>
                  <ul>
                    {attention.unassignedTasks.map((task) => (
                      <AttentionTask
                        key={task.id}
                        task={task}
                        openLabel={t("home.openItem", { title: task.title })}
                        reason={task.project?.name ?? t("home.noProject")}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
              {showPortfolio && attention.overdueMilestones.length > 0 ? (
                <div className="card overflow-hidden">
                  <p className="flex items-center gap-2 border-b border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-semibold">
                    <OctagonAlert
                      className="size-3.5 text-danger-fg"
                      aria-hidden
                    />
                    {t("home.attention.overdueMilestones")}
                  </p>
                  <ul>
                    {attention.overdueMilestones.map((item) => (
                      <AttentionLink
                        key={item.id}
                        title={item.title}
                        reason={item.reason}
                        href={item.href}
                        openLabel={t("home.openItem", { title: item.title })}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
              {showPortfolio && attention.pendingDecisions.length > 0 ? (
                <div className="card overflow-hidden">
                  <p className="flex items-center gap-2 border-b border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-semibold">
                    <AlertTriangle
                      className="size-3.5 text-warning-fg"
                      aria-hidden
                    />
                    {t("home.attention.pendingDecisions")}
                  </p>
                  <ul>
                    {attention.pendingDecisions.map((item) => (
                      <AttentionLink
                        key={item.id}
                        title={item.title}
                        reason={item.reason}
                        href={item.href}
                        openLabel={t("home.openItem", { title: item.title })}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
              {showPortfolio && attention.upcomingCommitments.length > 0 ? (
                <div className="card overflow-hidden">
                  <p className="flex items-center gap-2 border-b border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-semibold">
                    <CalendarDays
                      className="size-3.5 text-brand-fg"
                      aria-hidden
                    />
                    {t("home.attention.upcomingCommitments")}
                  </p>
                  <ul>
                    {attention.upcomingCommitments.map((item) => (
                      <AttentionLink
                        key={item.id}
                        title={item.title}
                        reason={item.reason}
                        href={item.href}
                        openLabel={t("home.openItem", { title: item.title })}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* Recent activity */}
        <section aria-labelledby="activity-heading" className="mt-8">
          <h2 id="activity-heading" className="section-heading mb-3">
            {t("home.sections.recentActivity")}
          </h2>
          {data.recentActivity.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              {t("home.activityEmpty")}
            </p>
          ) : (
            <ol className="card divide-y divide-line">
              {data.recentActivity.map((event) => (
                <li
                  key={event.id}
                  className="flex items-start gap-2.5 px-4 py-2.5"
                >
                  {event.actor ? (
                    <Avatar
                      name={event.actor.full_name}
                      src={event.actor.avatar_url}
                      size="sm"
                      className="mt-0.5"
                    />
                  ) : (
                    <Badge tone="neutral">{t("common.system")}</Badge>
                  )}
                  <div className="min-w-0">
                    <p className="text-[13px]">
                      <span className="font-medium">
                        {event.actor?.full_name ?? t("common.system")}
                      </span>{" "}
                      {event.summary}
                    </p>
                    <p className="meta">{format.relative(event.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* ============ Announcements rail ============ */}
      <aside aria-label={t("home.rail.label")} className="hidden min-w-0 2xl:block">
        <div className="card sticky top-[4.5rem] overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold">
              <Hash className="size-4 text-muted" aria-hidden />
              {t("home.rail.channelName")}
            </p>
            {rail.channelId ? (
              <Link
                href={`/channels/${rail.channelId}`}
                aria-label={t("home.rail.openChannel")}
                className="text-muted transition-colors hover:text-brand-fg"
              >
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            ) : null}
          </div>

          {latestAnn ? (
            <div className="border-b border-line bg-brand-soft/40 px-4 py-4">
              <p className="mb-1.5 flex items-center gap-1.5">
                <Megaphone className="size-3.5 text-brand-fg" aria-hidden />
                <span className="text-[10.5px] font-bold tracking-[0.08em] text-brand-fg uppercase">
                  {t("home.rail.orgAnnouncement")}
                </span>
                <span className="meta ml-auto">
                  {format.relative(latestAnn.publish_at)}
                </span>
              </p>
              <p className="text-[14.5px] leading-snug font-semibold">
                {latestAnn.title}
              </p>
              {latestAnn.message?.body ? (
                <p className="mt-1 line-clamp-4 text-[13px] whitespace-pre-wrap text-muted">
                  {latestAnn.message.body}
                </p>
              ) : null}
              <p className="meta mt-2">
                {t("home.rail.postedBy", { name: latestAnn.authorName })}
              </p>
              {latestAnn.requires_ack ? (
                <div className="mt-3 space-y-2">
                  {latestAnn.acknowledgedByMe ? (
                    <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success-fg">
                      <CheckCircle2 className="size-4" aria-hidden />
                      {t("home.rail.youAcknowledged")}
                    </p>
                  ) : (
                    <AcknowledgeButton announcementId={latestAnn.id} />
                  )}
                  <div>
                    <p className="meta mb-1">
                      {t("home.rail.ackCount", {
                        count: latestAnn.ackCount,
                        total: latestAnn.totalRecipients,
                      })}
                      {latestAnn.ack_deadline
                        ? t("home.rail.ackDue", {
                            date: format.date(latestAnn.ack_deadline),
                          })
                        : ""}
                    </p>
                    <ProgressBar
                      label={t("home.rail.ackProgress")}
                      percent={
                        latestAnn.totalRecipients > 0
                          ? (latestAnn.ackCount / latestAnn.totalRecipients) *
                            100
                          : 0
                      }
                      tone="attention"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="px-1 py-2">
            {rail.recentMessages.filter((m) => !m.deleted_at).length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-muted">
                {t("home.rail.empty")}
              </p>
            ) : (
              <ul>
                {rail.recentMessages
                  .filter((m) => !m.deleted_at)
                  .slice(-4)
                  .map((message) => (
                    <li key={message.id} className="flex gap-2.5 px-3 py-2">
                      <Avatar
                        name={message.author?.full_name ?? t("common.unknown")}
                        src={message.author?.avatar_url}
                        size="sm"
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <p className="flex items-baseline gap-2">
                          <span className="truncate text-[12.5px] font-semibold">
                            {message.author?.full_name ?? t("common.unknown")}
                          </span>
                          <span className="meta shrink-0">
                            {format.relative(message.created_at)}
                          </span>
                        </p>
                        <p className="line-clamp-2 text-[13px]">
                          {message.body}
                        </p>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          {rail.channelId ? (
            <div className="border-t border-line p-3">
              <Link
                href={`/channels/${rail.channelId}`}
                className="block rounded-(--radius-sm) border border-line bg-canvas px-3 py-2 text-center text-[13px] font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand-fg"
              >
                {t("home.rail.openChannelLink")}
              </Link>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
