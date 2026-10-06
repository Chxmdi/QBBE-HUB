import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { calendarDateInZone } from "@/lib/time";
import { isProjectStale } from "@/features/projects/stale";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { TranslateFn } from "@/lib/i18n/translate";
import {
  attentionReasons,
  attentionRules,
  sortForAttention,
  thresholdsFrom,
  type TeamOverviewRow,
} from "@/features/people/team-overview";
import { personWorkHref } from "@/features/people/person-work";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("teamOverview.title") };
}
export const dynamic = "force-dynamic";

function formatDay(iso: string | null, timeZone: string, t: TranslateFn, format: Formatters) {
  if (!iso) return t("teamOverview.noWork");
  return format.inZone(iso, timeZone, { month: "short", day: "numeric" });
}

function trend(current: number, previous: number, t: TranslateFn) {
  if (current === previous) return t("teamOverview.trendSame");
  return current > previous
    ? t("teamOverview.trendUp", { count: previous })
    : t("teamOverview.trendDown", { count: previous });
}

/**
 * Team overview (#136): the state of each staff member's assigned work, for
 * workspace administrators. Built only from work records — tasks, decision
 * requests, project reporting dates and the activity feed — never sign-ins,
 * time online or message content.
 */
export default async function TeamOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  // team_overview itself returns nothing to anyone else; this sends them away
  // instead of showing an empty table (and sends an admin without MFA to it).
  const session = await requireAdminAal2();
  const params = await searchParams;
  const supabase = await createSupabasePageClient();
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  const today =
    calendarDateInZone(new Date(), session.timeZone) ?? new Date().toISOString().slice(0, 10);

  const [overviewRes, projectsRes, teamsRes, teamMembersRes, settingsRes] = await Promise.all([
    // rpc() is not covered by the page client's throw-on-error wrapper, so a
    // failed read would otherwise render as "No staff yet".
    supabase.rpc("team_overview", { p_today: today }).throwOnError(),
    supabase
      .from("project")
      .select("id, owner_id, reporting_cadence, last_status_update_at, created_at, stage, archived_at")
      .in("reporting_cadence", ["weekly", "monthly"])
      .is("archived_at", null),
    supabase.from("team").select("id, name").order("name"),
    supabase.from("team_member").select("team_id, user_id"),
    // The organization's thresholds (Admin, Team signals); none saved means the defaults.
    supabase
      .from("team_signal_settings")
      .select(
        "overdue_count, overdue_age_days, blocked_no_update_days, in_progress_no_update_days, flag_project_reports, flag_overdue_decisions",
      )
      .eq("organization_id", session.organizationId)
      .maybeSingle(),
  ]);
  const thresholds = thresholdsFrom(settingsRes.data);

  const now = new Date();
  const staleByOwner = new Map<string, number>();
  for (const project of projectsRes.data ?? []) {
    if (project.owner_id && isProjectStale(project, now)) {
      staleByOwner.set(project.owner_id, (staleByOwner.get(project.owner_id) ?? 0) + 1);
    }
  }

  const teams = (teamsRes.data ?? []) as { id: string; name: string }[];
  const teamFilter = params.team && teams.some((team) => team.id === params.team) ? params.team : null;
  const inTeam = teamFilter
    ? new Set(
        ((teamMembersRes.data ?? []) as { team_id: string; user_id: string }[])
          .filter((m) => m.team_id === teamFilter)
          .map((m) => m.user_id),
      )
    : null;

  const rows = ((overviewRes.data ?? []) as TeamOverviewRow[])
    .map((row) => ({
      ...row,
      open_tasks: Number(row.open_tasks),
      overdue: Number(row.overdue),
      due_this_week: Number(row.due_this_week),
      blocked: Number(row.blocked),
      blocked_stale: Number(row.blocked_stale),
      in_progress_stale: Number(row.in_progress_stale),
      completed_7: Number(row.completed_7),
      completed_prev_7: Number(row.completed_prev_7),
      completed_30: Number(row.completed_30),
      open_decisions: Number(row.open_decisions),
      overdue_decisions: Number(row.overdue_decisions),
    }))
    .filter((row) => !inTeam || inTeam.has(row.user_id));

  const entries = sortForAttention(
    rows.map((row) => ({
      row,
      staleProjects: staleByOwner.get(row.user_id) ?? 0,
      reasons: attentionReasons(row, today, staleByOwner.get(row.user_id) ?? 0, t, thresholds),
    })),
  );
  const needingAttention = entries.filter((e) => e.reasons.length > 0).length;

  const chip = (active: boolean) =>
    active
      ? "rounded-full border border-brand bg-brand px-3 py-1 text-[13px] font-medium text-white"
      : "rounded-full border border-line bg-surface px-3 py-1 text-[13px] font-medium text-muted";

  return (
    <div>
      <PageHeader
        eyebrow={t("teamOverview.eyebrow")}
        title={t("teamOverview.title")}
        description={t("teamOverview.description")}
      />

      {teams.length > 0 ? (
        <nav aria-label={t("teamOverview.filterByTeam")} className="mb-4 flex flex-wrap gap-1.5">
          <Link href="/people/overview" className={chip(!teamFilter)}>
            {t("teamOverview.everyone")}
          </Link>
          {teams.map((team) => (
            <Link
              key={team.id}
              href={`/people/overview?team=${team.id}`}
              className={chip(teamFilter === team.id)}
            >
              {team.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={teamFilter ? t("teamOverview.emptyTeamTitle") : t("teamOverview.emptyTitle")}
          description={t("teamOverview.emptyDescription")}
        />
      ) : (
        <>
          <p className="meta mb-3" role="status">
            {needingAttention === 0
              ? t("teamOverview.allOnTrack", { count: entries.length })
              : t(
                  entries.length === 1
                    ? "teamOverview.needAttentionOne"
                    : "teamOverview.needAttentionOther",
                  { count: needingAttention, total: entries.length },
                )}
          </p>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13.5px]">
                <caption className="sr-only">
                  {t("teamOverview.caption")}
                </caption>
                <thead>
                  <tr className="border-b border-line bg-surface-soft/60">
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t("teamOverview.columns.person")}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t("teamOverview.columns.status")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("teamOverview.columns.open")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("teamOverview.columns.overdue")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("teamOverview.columns.blocked")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("teamOverview.columns.dueSoon")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("teamOverview.columns.done7")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("teamOverview.columns.done30")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("teamOverview.columns.decisions")}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t("teamOverview.columns.lastWork")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(({ row, reasons }) => (
                    <tr
                      key={`${row.organization_id}-${row.user_id}`}
                      className="border-b border-line align-top last:border-b-0"
                    >
                      <th scope="row" className="px-4 py-3 font-normal">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={row.full_name} src={row.avatar_url} size="md" />
                          <span>
                            <Link
                              href={personWorkHref(row.user_id)}
                              aria-label={t("teamOverview.viewWork", { name: row.full_name })}
                              className="block font-medium hover:underline"
                            >
                              {row.full_name}
                              {row.user_id === session.userId ? (
                                <span className="meta ml-1.5">{t("teamOverview.you")}</span>
                              ) : null}
                            </Link>
                            <span className="meta">
                              {row.title ? `${row.title} · ` : ""}
                              {t(`people.roles.${row.role}`)}
                            </span>
                          </span>
                        </span>
                      </th>
                      <td className="px-4 py-3">
                        {reasons.length > 0 ? (
                          <>
                            <Badge tone="warning">{t("teamOverview.needsAttention")}</Badge>
                            <ul className="meta mt-1.5 list-disc space-y-0.5 pl-4">
                              {reasons.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <Badge tone="success">{t("teamOverview.onTrack")}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.open_tasks}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.overdue}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.blocked}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.due_this_week}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.completed_7}
                        {row.completed_7 + row.completed_prev_7 > 0 ? (
                          <span className="meta block">
                            {trend(row.completed_7, row.completed_prev_7, t)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.completed_30}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.open_decisions}
                        {row.overdue_decisions > 0 ? (
                          <span className="meta block">
                            {t("teamOverview.pastDue", { count: row.overdue_decisions })}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{formatDay(row.last_activity_at, session.timeZone, t, format)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="meta mt-3">
            <p>{t("teamOverview.footnoteIntro")}</p>
            <ul className="mt-1 list-disc pl-5">
              {attentionRules(thresholds, t).map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
