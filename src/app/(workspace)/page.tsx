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
import {
  ProgressBar,
  StatusDonut,
  WeeklyBars,
} from "@/features/dashboard/components/charts";
import { getDashboardData } from "@/features/dashboard/services/dashboard.queries";
import { requireSession } from "@/lib/auth";
import { formatDate, formatTime, relativeTime } from "@/lib/utils";
import type { ProjectHealth, Task } from "@/types/entities";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

function greetingFor(timezone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-CA", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function AttentionTask({ task, reason }: { task: Task; reason: string }) {
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
        href="/board"
        aria-label={`Open board for ${task.title}`}
        className="text-muted hover:text-brand"
      >
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </li>
  );
}

export default async function HomePage() {
  const session = await requireSession();
  const data = await getDashboardData(session.userId);
  const firstName = session.profile.full_name.split(" ")[0] || "there";
  const timezone = session.profile.timezone ?? "America/Toronto";
  const { kpis, attention, healthCounts, statusBreakdown } = data;

  const activeTotal = Object.values(healthCounts).reduce((a, b) => a + b, 0);
  const onTrack = healthCounts["on_track"] ?? 0;
  const atRisk = (healthCounts["at_risk"] ?? 0) + (healthCounts["off_track"] ?? 0);
  const healthPercent = activeTotal > 0 ? Math.round((onTrack / activeTotal) * 100) : null;

  const completionDelta =
    data.completedPrevious30 > 0
      ? Math.round(
          ((kpis.completedLast30 - data.completedPrevious30) /
            data.completedPrevious30) *
            100,
        )
      : null;

  const attentionEmpty =
    attention.overdueTasks.length === 0 &&
    attention.blockedTasks.length === 0 &&
    attention.unassignedTasks.length === 0 &&
    attention.riskyProjects.length === 0;

  const rail = data.announcementRail;
  const latestAnn = rail.latest;

  return (
    <div className="grid grid-cols-1 gap-8 2xl:grid-cols-[1fr_360px]">
      {/* ============ Main column ============ */}
      <div className="min-w-0">
        <header className="mb-6">
          <h1 className="page-title">
            {greetingFor(timezone)}, {firstName}{" "}
            <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1.5 text-[14.5px] text-muted">
            Here&apos;s what needs your attention today.
          </p>
        </header>

        {/* Required announcements beyond the rail stay pinned until acked */}
        {data.requiredAnnouncements.filter((a) => a.id !== latestAnn?.id).length >
        0 ? (
          <section aria-label="Required announcements" className="mb-5 space-y-2">
            {data.requiredAnnouncements
              .filter((a) => a.id !== latestAnn?.id)
              .map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-(--radius-md) border border-brand/30 bg-brand-soft/60 px-4 py-3"
                >
                  <Megaphone className="size-4.5 shrink-0 text-brand" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold">{a.title}</p>
                    <p className="meta">
                      {a.priority === "critical" ? "Critical · " : ""}
                      Acknowledgment required
                      {a.ack_deadline ? ` by ${formatDate(a.ack_deadline)}` : ""}
                    </p>
                  </div>
                  <AcknowledgeButton announcementId={a.id} />
                </div>
              ))}
          </section>
        ) : null}

        {/* Hero: portfolio pulse */}
        <section
          aria-label="Portfolio summary"
          className="card mb-5 flex flex-wrap items-center gap-x-8 gap-y-4 p-5"
        >
          <div>
            <p className="flex items-baseline gap-2">
              <span className="text-[34px] leading-none font-semibold">
                {kpis.activePrograms}
              </span>
              <span className="text-[15px] font-medium">
                active {kpis.activePrograms === 1 ? "program" : "programs"}
              </span>
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
              <span className="flex items-center gap-1">
                <span aria-hidden className="size-2 rounded-full bg-(--color-chart-good)" />
                {onTrack} on track
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden className="size-2 rounded-full bg-(--color-chart-todo)" />
                {healthCounts["at_risk"] ?? 0} needs attention
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden className="size-2 rounded-full bg-(--color-chart-overdue)" />
                {healthCounts["off_track"] ?? 0} at risk
              </span>
            </p>
          </div>
          <div className="hidden h-12 w-px bg-line sm:block" aria-hidden />
          <div>
            <p className="eyebrow">Overall portfolio health</p>
            {healthPercent === null ? (
              <p className="mt-1 text-[14px] text-muted">
                No active projects yet
              </p>
            ) : (
              <p className="mt-0.5 flex items-baseline gap-2">
                <span
                  className={
                    healthPercent >= 70
                      ? "text-[28px] leading-none font-semibold text-success"
                      : healthPercent >= 40
                        ? "text-[28px] leading-none font-semibold text-warning"
                        : "text-[28px] leading-none font-semibold text-danger"
                  }
                >
                  {healthPercent}%
                </span>
                <span className="text-[12.5px] text-muted">
                  of {activeTotal} active {activeTotal === 1 ? "project" : "projects"} on track
                  {atRisk > 0 ? ` · ${atRisk} flagged` : ""}
                </span>
              </p>
            )}
          </div>
          {session.isStaff ? (
            <div className="ml-auto">
              <Link
                href="/projects?create=1"
                className="inline-flex h-9.5 items-center gap-1.5 rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
              >
                <Plus className="size-4" aria-hidden />
                New project
              </Link>
            </div>
          ) : null}
        </section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* TODAY */}
          <section aria-labelledby="today-heading" className="card p-5">
            <h2 id="today-heading" className="eyebrow mb-4">
              Today
            </h2>
            {data.todayTasks.length === 0 && data.todayMeetings.length === 0 ? (
              <p className="py-6 text-center text-[13.5px] text-muted">
                Nothing due or scheduled today. Enjoy the clear runway.
              </p>
            ) : (
              <ul className="space-y-1">
                {data.todayMeetings.map((meeting) => (
                  <li key={meeting.id}>
                    <Link
                      href={`/meetings/${meeting.id}`}
                      className="interactive-row -mx-2 flex items-center gap-3 rounded-(--radius-sm) px-2 py-2"
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-info/10 text-info">
                        <Presentation className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">
                          {meeting.title}
                        </span>
                        <span className="meta">
                          {meeting.project?.name ?? "Meeting"}
                        </span>
                      </span>
                      <time className="text-[12.5px] font-medium whitespace-nowrap text-brand">
                        {formatTime(meeting.starts_at)}
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
                      <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand">
                        <ClipboardList className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">
                          {task.title}
                        </span>
                        <span className="meta">
                          {task.project?.name ?? "Task"}
                        </span>
                      </span>
                      <span
                        className={
                          task.due_at && task.due_at < new Date().toISOString().slice(0, 10)
                            ? "text-[12.5px] font-medium whitespace-nowrap text-danger"
                            : "text-[12.5px] font-medium whitespace-nowrap text-warning"
                        }
                      >
                        {task.due_at && task.due_at < new Date().toISOString().slice(0, 10)
                          ? `Overdue · ${formatDate(task.due_at)}`
                          : "Due today"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/my-work"
              className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline"
            >
              View my work <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </section>

          {/* PROGRAM HEALTH */}
          <section aria-labelledby="program-health-heading" className="card p-5">
            <h2 id="program-health-heading" className="eyebrow mb-4">
              Program health
            </h2>
            {data.programHealth.length === 0 ? (
              <p className="py-6 text-center text-[13.5px] text-muted">
                Create a program to see its delivery health here.
              </p>
            ) : (
              <ul className="space-y-4">
                {data.programHealth.map((program) => (
                  <li key={program.id}>
                    <Link href={`/programs/${program.id}`} className="group block">
                      <span className="mb-1.5 flex items-baseline justify-between gap-3">
                        <span className="truncate text-[13.5px] font-medium group-hover:text-brand">
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
                                ? "text-[11.5px] font-medium text-success"
                                : program.tone === "attention"
                                  ? "text-[11.5px] font-medium text-warning"
                                  : program.tone === "risk"
                                    ? "text-[11.5px] font-medium text-danger"
                                    : "text-[11.5px] font-medium text-muted"
                            }
                          >
                            {program.statusLabel}
                          </span>
                        </span>
                      </span>
                      <ProgressBar
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
              className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline"
            >
              View portfolio <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </section>

          {/* ACTIVITY OVERVIEW */}
          <section aria-labelledby="activity-overview-heading" className="card p-5">
            <h2 id="activity-overview-heading" className="eyebrow mb-4">
              Activity overview
            </h2>
            <div className="mb-4 flex items-baseline gap-3">
              <p className="text-[30px] leading-none font-semibold">
                {kpis.completedLast30}
              </p>
              <div>
                <p className="text-[12.5px] text-muted">
                  tasks completed · last 30 days
                </p>
                {completionDelta !== null ? (
                  <p
                    className={
                      completionDelta >= 0
                        ? "flex items-center gap-1 text-[12px] font-medium text-success"
                        : "flex items-center gap-1 text-[12px] font-medium text-danger"
                    }
                  >
                    {completionDelta >= 0 ? (
                      <TrendingUp className="size-3.5" aria-hidden />
                    ) : (
                      <TrendingDown className="size-3.5" aria-hidden />
                    )}
                    {completionDelta >= 0 ? "+" : ""}
                    {completionDelta}% vs previous 30 days
                  </p>
                ) : null}
              </div>
            </div>
            <WeeklyBars weeks={data.weeklyCompleted} />
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-3 text-[12.5px] font-medium text-muted">
                Tasks by status
              </p>
              <StatusDonut
                slices={[
                  {
                    label: "Completed · 30d",
                    value: statusBreakdown.completed,
                    colorVar: "--color-chart-good",
                  },
                  {
                    label: "To do",
                    value: statusBreakdown.toDo,
                    colorVar: "--color-chart-todo",
                  },
                  {
                    label: "In progress",
                    value: statusBreakdown.inProgress,
                    colorVar: "--color-chart-progress",
                  },
                  {
                    label: "Overdue",
                    value: statusBreakdown.overdue,
                    colorVar: "--color-chart-overdue",
                  },
                ]}
              />
            </div>
          </section>

          {/* UPCOMING EVENTS */}
          <section aria-labelledby="upcoming-events-heading" className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="upcoming-events-heading" className="eyebrow">
                Upcoming events
              </h2>
              <Link
                href="/calendar"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
              >
                View calendar <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
            {data.upcomingEvents.length === 0 ? (
              <div className="py-6 text-center">
                <CalendarDays className="mx-auto mb-2 size-7 text-muted/50" aria-hidden />
                <p className="text-[13.5px] text-muted">
                  No upcoming events scheduled.
                </p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {data.upcomingEvents.map((event) => {
                  const date = new Date(event.starts_at);
                  return (
                    <li key={event.id}>
                      <Link
                        href={`/events/${event.id}`}
                        className="interactive-row -mx-2 flex items-center gap-3 rounded-(--radius-sm) px-2 py-2"
                      >
                        <span className="flex w-11 shrink-0 flex-col items-center rounded-(--radius-sm) border border-line bg-surface-soft/70 py-1">
                          <span className="text-[9.5px] font-bold tracking-wide text-brand uppercase">
                            {date.toLocaleDateString("en-CA", { month: "short", timeZone: timezone })}
                          </span>
                          <span className="text-[16px] leading-tight font-bold">
                            {date.toLocaleDateString("en-CA", { day: "2-digit", timeZone: timezone })}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">
                            {event.name}
                          </span>
                          <span className="meta block truncate">
                            {formatTime(event.starts_at)}
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
              className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline"
            >
              View all events <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </section>
        </div>

        {/* Needs attention (P0-DASH-03) */}
        <section aria-labelledby="attention-heading" className="mt-8">
          <h2 id="attention-heading" className="section-heading mb-3">
            Needs attention
          </h2>
          {attentionEmpty ? (
            <div className="card px-5 py-6 text-center">
              <CheckCircle2 className="mx-auto mb-1.5 size-6 text-success" aria-hidden />
              <p className="text-[14px] font-medium">
                Nothing needs escalation right now.
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                No overdue, blocked, unassigned, or at-risk work is visible to you.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {attention.riskyProjects.length > 0 ? (
                <div className="card overflow-hidden">
                  <p className="flex items-center gap-2 border-b border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-semibold">
                    <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                    Projects at risk
                  </p>
                  <ul>
                    {attention.riskyProjects.map((p) => (
                      <li key={p.id} className="interactive-row flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <Link
                            href={`/projects/${p.id}`}
                            className="block truncate text-[13.5px] font-medium hover:text-brand"
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
                    <OctagonAlert className="size-3.5 text-danger" aria-hidden />
                    Overdue tasks
                  </p>
                  <ul>
                    {attention.overdueTasks.map((t) => (
                      <AttentionTask
                        key={t.id}
                        task={t}
                        reason={`Due ${formatDate(t.due_at)}${t.project ? ` · ${t.project.name}` : ""}`}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
              {attention.blockedTasks.length > 0 ? (
                <div className="card overflow-hidden">
                  <p className="flex items-center gap-2 border-b border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-semibold">
                    <OctagonAlert className="size-3.5 text-danger" aria-hidden />
                    Blocked work
                  </p>
                  <ul>
                    {attention.blockedTasks.map((t) => (
                      <AttentionTask key={t.id} task={t} reason={t.blocked_reason ?? "Blocked"} />
                    ))}
                  </ul>
                </div>
              ) : null}
              {attention.unassignedTasks.length > 0 ? (
                <div className="card overflow-hidden">
                  <p className="flex items-center gap-2 border-b border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-semibold">
                    <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                    Unassigned tasks
                  </p>
                  <ul>
                    {attention.unassignedTasks.map((t) => (
                      <AttentionTask key={t.id} task={t} reason={t.project?.name ?? "No project"} />
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
            Recent activity
          </h2>
          {data.recentActivity.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              Activity from tasks, projects, and meetings will appear here.
            </p>
          ) : (
            <ol className="card divide-y divide-line">
              {data.recentActivity.map((event) => (
                <li key={event.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  {event.actor ? (
                    <Avatar
                      name={event.actor.full_name}
                      src={event.actor.avatar_url}
                      size="sm"
                      className="mt-0.5"
                    />
                  ) : (
                    <Badge tone="neutral">System</Badge>
                  )}
                  <div className="min-w-0">
                    <p className="text-[13px]">
                      <span className="font-medium">
                        {event.actor?.full_name ?? "System"}
                      </span>{" "}
                      {event.summary}
                    </p>
                    <p className="meta">{relativeTime(event.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* ============ Announcements rail ============ */}
      <aside aria-label="Announcements" className="hidden min-w-0 2xl:block">
        <div className="card sticky top-[4.5rem] overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold">
              <Hash className="size-4 text-muted" aria-hidden />
              announcements
            </p>
            {rail.channelId ? (
              <Link
                href={`/channels/${rail.channelId}`}
                aria-label="Open announcements channel"
                className="text-muted transition-colors hover:text-brand"
              >
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            ) : null}
          </div>

          {latestAnn ? (
            <div className="border-b border-line bg-brand-soft/40 px-4 py-4">
              <p className="mb-1.5 flex items-center gap-1.5">
                <Megaphone className="size-3.5 text-brand" aria-hidden />
                <span className="text-[10.5px] font-bold tracking-[0.08em] text-brand uppercase">
                  Organization announcement
                </span>
                <span className="meta ml-auto">
                  {relativeTime(latestAnn.publish_at)}
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
              <p className="meta mt-2">Posted by {latestAnn.authorName}</p>
              {latestAnn.requires_ack ? (
                <div className="mt-3 space-y-2">
                  {latestAnn.acknowledgedByMe ? (
                    <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success">
                      <CheckCircle2 className="size-4" aria-hidden />
                      You acknowledged this
                    </p>
                  ) : (
                    <AcknowledgeButton announcementId={latestAnn.id} />
                  )}
                  <div>
                    <p className="meta mb-1">
                      {latestAnn.ackCount} of {latestAnn.totalRecipients} acknowledged
                      {latestAnn.ack_deadline
                        ? ` · due ${formatDate(latestAnn.ack_deadline)}`
                        : ""}
                    </p>
                    <ProgressBar
                      percent={
                        latestAnn.totalRecipients > 0
                          ? (latestAnn.ackCount / latestAnn.totalRecipients) * 100
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
                Channel messages will appear here.
              </p>
            ) : (
              <ul>
                {rail.recentMessages
                  .filter((m) => !m.deleted_at)
                  .slice(-4)
                  .map((message) => (
                    <li key={message.id} className="flex gap-2.5 px-3 py-2">
                      <Avatar
                        name={message.author?.full_name ?? "Unknown"}
                        src={message.author?.avatar_url}
                        size="sm"
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <p className="flex items-baseline gap-2">
                          <span className="truncate text-[12.5px] font-semibold">
                            {message.author?.full_name ?? "Unknown"}
                          </span>
                          <span className="meta shrink-0">
                            {relativeTime(message.created_at)}
                          </span>
                        </p>
                        <p className="line-clamp-2 text-[13px]">{message.body}</p>
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
                className="block rounded-(--radius-sm) border border-line bg-canvas px-3 py-2 text-center text-[13px] font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand"
              >
                Open #announcements
              </Link>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
