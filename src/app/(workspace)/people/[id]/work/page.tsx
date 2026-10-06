import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { TaskDrawer } from "@/features/tasks/components/task-drawer";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { taskStatusText } from "@/features/tasks/schemas";
import { NO_ACCESS_REDIRECT, requireAdminAal2, requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { calendarDateInZone } from "@/lib/time";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";
import type { TaskStatus } from "@/types/entities";
import {
  attentionReasons,
  attentionRules,
  daysBetween,
  thresholdsFrom,
} from "@/features/people/team-overview";
import {
  activityCursor,
  activityHref,
  asOverviewRow,
  groupTasks,
  isUuid,
  personWorkAccess,
  personWorkHref,
  type PersonWorkSummary,
} from "@/features/people/person-work";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("personWork.metaTitle") };
}
export const dynamic = "force-dynamic";

/**
 * One person's work (#136, phase 2). The person sees it as "My work summary";
 * an owner or admin who completed MFA sees the same page for any listed staff
 * member. Built only from work records: tasks, projects, decision requests,
 * meeting action items and the activity feed. Never sign-ins, time online or
 * message content.
 */
export default async function PersonWorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { id: requested } = await params;
  const query = await searchParams;
  const session = await requireSession();
  // "/people/me/work" is the signed-in person's own summary.
  const id = requested === "me" ? session.userId : requested;

  const access = isUuid(id)
    ? personWorkAccess({
        userId: session.userId,
        isStaff: session.isStaff,
        isAdmin: session.isAdmin,
        targetId: id,
      })
    : "denied";
  if (access === "denied") redirect(NO_ACCESS_REDIRECT);
  // Someone else's summary needs an owner or admin who completed MFA; an
  // admin without it is sent to finish MFA, anyone else away.
  if (access === "admin") await requireAdminAal2();

  const supabase = await createSupabasePageClient();
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  const today =
    calendarDateInZone(new Date(), session.timeZone) ?? new Date().toISOString().slice(0, 10);
  const before = activityCursor(query.before);

  const [summaryRes, options] = await Promise.all([
    // rpc() is not covered by the page client's throw-on-error wrapper.
    supabase
      .rpc("person_work_summary", {
        p_user_id: id,
        p_today: today,
        p_activity_before: before,
        p_activity_limit: 25,
      })
      .throwOnError(),
    getPickerOptions(),
  ]);

  // Null means the database would not show this person to this viewer: a
  // volunteer or guest, someone in another organization, or no such person.
  const summary = summaryRes.data as PersonWorkSummary | null;
  if (!summary) redirect(NO_ACCESS_REDIRECT);

  const self = access === "self";
  const person = summary.person;
  const figures = summary.figures;
  const thresholds = thresholdsFrom(summary.thresholds);
  const row = asOverviewRow(summary);
  const reasons = attentionReasons(row, today, Number(figures.stale_projects), t, thresholds);
  const groups = groupTasks(summary.tasks);
  const tz = session.timeZone;
  const calendarDate = (value: string) => format.date(`${value.slice(0, 10)}T12:00:00Z`, "UTC");
  const count = (value: number | string) => format.number(Number(value));

  const trend =
    Number(figures.completed_7) === Number(figures.completed_prev_7)
      ? t("teamOverview.trendSame")
      : Number(figures.completed_7) > Number(figures.completed_prev_7)
        ? t("teamOverview.trendUp", { count: count(figures.completed_prev_7) })
        : t("teamOverview.trendDown", { count: count(figures.completed_prev_7) });

  const tiles: { label: string; value: string; note?: string }[] = [
    { label: t("personWork.figures.open"), value: count(figures.open_tasks) },
    { label: t("personWork.figures.overdue"), value: count(figures.overdue) },
    { label: t("personWork.figures.blocked"), value: count(figures.blocked) },
    { label: t("personWork.figures.dueSoon"), value: count(figures.due_this_week) },
    {
      label: t("personWork.figures.done7"),
      value: count(figures.completed_7),
      note:
        Number(figures.completed_7) + Number(figures.completed_prev_7) > 0 ? trend : undefined,
    },
    { label: t("personWork.figures.done30"), value: count(figures.completed_30) },
    { label: t("personWork.figures.decisions"), value: count(figures.open_decisions) },
    { label: t("personWork.figures.actions"), value: count(figures.open_meeting_actions) },
  ];

  const title = self
    ? t("personWork.titleSelf")
    : t("personWork.titleOther", { name: person.full_name });

  return (
    <div>
      <PageHeader
        eyebrow={t("personWork.eyebrow")}
        title={title}
        description={
          self
            ? t("personWork.descriptionSelf")
            : t("personWork.descriptionOther", { name: person.full_name })
        }
        actions={
          session.isAdmin && !self ? (
            <Link
              href="/people/overview"
              className="text-[13px] font-medium text-brand-fg hover:underline"
            >
              {t("personWork.backToOverview")}
            </Link>
          ) : self ? (
            <Link href="/my-work" className="text-[13px] font-medium text-brand-fg hover:underline">
              {t("personWork.backToMyWork")}
            </Link>
          ) : null
        }
      />

      <section aria-labelledby="person-work-status" className="card mb-6 px-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={person.full_name} src={person.avatar_url} size="md" />
          <div className="min-w-0 flex-1">
            <h2 id="person-work-status" className="font-semibold">
              {person.full_name}
            </h2>
            <p className="meta">
              {person.title ? `${person.title} · ` : ""}
              {t(`people.roles.${person.role}` as MessageKey)}
              {" · "}
              {figures.last_activity_at
                ? t("personWork.lastWork", {
                    date: format.inZone(figures.last_activity_at, tz, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }),
                  })
                : t("teamOverview.noWork")}
            </p>
          </div>
          {reasons.length > 0 ? (
            <Badge tone="warning">{t("teamOverview.needsAttention")}</Badge>
          ) : (
            <Badge tone="success">{t("teamOverview.onTrack")}</Badge>
          )}
        </div>
        {reasons.length > 0 ? (
          <ul className="meta mt-3 list-disc space-y-0.5 pl-5" aria-label={t("personWork.reasonsLabel")}>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-md border border-line px-3 py-2">
              <dt className="meta">{tile.label}</dt>
              <dd className="text-[20px] font-semibold tabular-nums">{tile.value}</dd>
              {tile.note ? <dd className="meta">{tile.note}</dd> : null}
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="person-work-tasks" className="mb-6">
        <h2 id="person-work-tasks" className="section-heading mb-3">
          {t("personWork.tasks.heading")}
        </h2>
        {summary.tasks.length === 0 ? (
          <p className="meta">{t("personWork.tasks.none")}</p>
        ) : (
          <div className="space-y-4">
            {groups.map(({ group, tasks }) => (
              <div key={group} className="card overflow-hidden">
                <h3 className="border-b border-line bg-surface-soft/60 px-4 py-2 text-[13.5px] font-semibold">
                  {t(`personWork.tasks.groups.${group}` as MessageKey)}{" "}
                  <span className="meta font-normal">({count(tasks.length)})</span>
                </h3>
                {tasks.length === 0 ? (
                  <p className="meta px-4 py-3">{t("personWork.tasks.emptyGroup")}</p>
                ) : (
                  <ul>
                    {tasks.map((task) => (
                      <li
                        key={task.id}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 last:border-b-0"
                      >
                        <Link
                          href={personWorkHref(person.user_id, task.id)}
                          scroll={false}
                          className="min-w-0 flex-1 font-medium hover:underline"
                        >
                          {task.title}
                        </Link>
                        <span className="meta">
                          {taskStatusText(task.status as TaskStatus, t)}
                          {task.project_name ? ` · ${task.project_name}` : ""}
                          {" · "}
                          {task.due_at
                            ? task.due_at < today
                              ? t("personWork.tasks.overdueBy", {
                                  count: count(daysBetween(task.due_at, today)),
                                  date: calendarDate(task.due_at),
                                })
                              : t("personWork.tasks.due", { date: calendarDate(task.due_at) })
                            : t("personWork.tasks.noDue")}
                        </span>
                        {task.no_recent_update ? (
                          <span className="meta w-full">
                            {t("personWork.tasks.noRecentUpdate", {
                              date: format.inZone(task.updated_at, tz, {
                                month: "short",
                                day: "numeric",
                              }),
                            })}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="person-work-projects">
          <h2 id="person-work-projects" className="section-heading mb-3">
            {t("personWork.projects.heading")}
          </h2>
          {summary.projects.length === 0 ? (
            <p className="meta">{t("personWork.projects.none")}</p>
          ) : (
            <ul className="card">
              {summary.projects.map((project) => (
                <li key={project.id} className="border-b border-line px-4 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/projects/${project.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                      {project.name}
                    </Link>
                    {project.report_overdue ? (
                      <Badge tone="warning">{t("personWork.projects.reportOverdue")}</Badge>
                    ) : project.reporting_cadence === "weekly" || project.reporting_cadence === "monthly" ? (
                      <Badge tone="success">{t("personWork.projects.reportOk")}</Badge>
                    ) : (
                      <Badge tone="neutral">{t("personWork.projects.noCadence")}</Badge>
                    )}
                  </div>
                  <p className="meta">
                    {t(`shell.status.stage.${project.stage}` as MessageKey)}
                    {" · "}
                    {project.last_status_update_at
                      ? t("personWork.projects.lastUpdate", {
                          date: format.inZone(project.last_status_update_at, tz, {
                            month: "short",
                            day: "numeric",
                          }),
                        })
                      : t("personWork.projects.neverUpdated")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="person-work-decisions">
          <h2 id="person-work-decisions" className="section-heading mb-3">
            {t("personWork.decisions.heading")}
          </h2>
          {summary.decisions.length === 0 ? (
            <p className="meta">{t("personWork.decisions.none")}</p>
          ) : (
            <ul className="card">
              {summary.decisions.map((decision) => (
                <li key={decision.id} className="border-b border-line px-4 py-2.5 last:border-b-0">
                  <Link
                    href={`/projects/${decision.project_id}`}
                    className="font-medium hover:underline"
                  >
                    {decision.context}
                  </Link>
                  <p className="meta">
                    {decision.project_name}
                    {" · "}
                    {t("personWork.decisions.due", { date: calendarDate(decision.due_at) })}
                    {decision.overdue ? ` · ${t("personWork.decisions.pastDue")}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="person-work-actions" className="mb-6">
        <h2 id="person-work-actions" className="section-heading mb-3">
          {t("personWork.actions.heading")}
        </h2>
        {summary.meeting_actions.length === 0 ? (
          <p className="meta">{t("personWork.actions.none")}</p>
        ) : (
          <ul className="card">
            {summary.meeting_actions.map((action) => (
              <li key={action.id} className="border-b border-line px-4 py-2.5 last:border-b-0">
                <Link
                  href={
                    action.task_id
                      ? personWorkHref(person.user_id, action.task_id)
                      : `/meetings/${action.meeting_id}`
                  }
                  scroll={false}
                  className="font-medium hover:underline"
                >
                  {action.title}
                </Link>
                <p className="meta">
                  {t("personWork.actions.fromMeeting", { meeting: action.meeting_title })}
                  {" · "}
                  {action.due_at
                    ? t("personWork.tasks.due", { date: calendarDate(action.due_at) })
                    : t("personWork.tasks.noDue")}
                  {action.overdue ? ` · ${t("personWork.decisions.pastDue")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="person-work-activity" className="mb-6">
        <h2 id="person-work-activity" className="section-heading mb-1">
          {t("personWork.activity.heading")}
        </h2>
        <p className="meta mb-3">
          {t("personWork.activity.window", {
            date: format.inZone(summary.activity_since, tz, {
              month: "long",
              day: "numeric",
              year: "numeric",
            }),
          })}
        </p>
        {summary.activity.length === 0 ? (
          <p className="meta">{t("personWork.activity.none")}</p>
        ) : (
          <ol className="card">
            {summary.activity.map((event) => {
              const href = activityHref(event, person.user_id);
              return (
                <li key={event.id} className="flex flex-wrap gap-x-3 border-b border-line px-4 py-2 last:border-b-0">
                  <time dateTime={event.created_at} className="meta w-36 shrink-0 tabular-nums">
                    {format.dateTime(event.created_at, tz)}
                  </time>
                  {href ? (
                    <Link href={href} scroll={false} className="min-w-0 flex-1 hover:underline">
                      {event.summary}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1">{event.summary}</span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <nav aria-label={t("personWork.activity.pagesLabel")} className="mt-3 flex gap-4">
          {before ? (
            <Link href={personWorkHref(person.user_id)} className="text-[13px] font-medium text-brand-fg hover:underline">
              {t("personWork.activity.latest")}
            </Link>
          ) : null}
          {summary.activity_has_more ? (
            <Link
              href={`${personWorkHref(person.user_id)}?before=${encodeURIComponent(
                summary.activity[summary.activity.length - 1].created_at,
              )}`}
              className="text-[13px] font-medium text-brand-fg hover:underline"
            >
              {t("personWork.activity.older")}
            </Link>
          ) : null}
        </nav>
      </section>

      <div className="meta">
        <p>{t("teamOverview.footnoteIntro")}</p>
        <ul className="mt-1 list-disc pl-5">
          {attentionRules(thresholds, t).map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>

      <Suspense fallback={null}>
        <TaskDrawer people={options.people} isStaff={session.isStaff} />
      </Suspense>
    </div>
  );
}
