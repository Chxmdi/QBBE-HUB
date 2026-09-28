/**
 * Team overview (#136): which people need attention, and why.
 *
 * Every rule reads the state of work assigned to a person — never sign-ins,
 * time online or message content. Each reason is a plain fact ("4 overdue,
 * oldest 12 days") rather than a score, so the person it describes would
 * recognise it and could act on it.
 */

import {
  createTranslator,
  type MessageKey,
  type MessageVars,
  type TranslateFn,
} from "@/lib/i18n/translate";

export interface TeamOverviewRow {
  user_id: string;
  organization_id: string;
  role: "owner" | "admin" | "staff";
  full_name: string;
  avatar_url: string | null;
  title: string | null;
  open_tasks: number;
  overdue: number;
  oldest_overdue_due: string | null;
  due_this_week: number;
  blocked: number;
  blocked_stale: number;
  in_progress_stale: number;
  completed_7: number;
  completed_prev_7: number;
  completed_30: number;
  open_decisions: number;
  overdue_decisions: number;
  last_activity_at: string | null;
}

/**
 * When work needs attention. Each organization sets these in Admin, Team
 * signals (the `team_signal_settings` table); the defaults are the ones
 * agreed on #136. The blocked and in-progress ages are applied in SQL, which
 * returns only the counts, so here they only word the reason.
 */
export interface AttentionThresholds {
  overdueCount: number;
  overdueAgeDays: number;
  blockedNoUpdateDays: number;
  inProgressNoUpdateDays: number;
  flagProjectReports: boolean;
  flagOverdueDecisions: boolean;
}

export const ATTENTION: AttentionThresholds = {
  overdueCount: 3,
  overdueAgeDays: 7,
  blockedNoUpdateDays: 5,
  inProgressNoUpdateDays: 7,
  flagProjectReports: true,
  flagOverdueDecisions: true,
};

/** The settings row as the database returns it (snake case), or the defaults. */
export function thresholdsFrom(
  row:
    | {
        overdue_count?: number | null;
        overdue_age_days?: number | null;
        blocked_no_update_days?: number | null;
        in_progress_no_update_days?: number | null;
        flag_project_reports?: boolean | null;
        flag_overdue_decisions?: boolean | null;
      }
    | null
    | undefined,
): AttentionThresholds {
  return {
    overdueCount: row?.overdue_count ?? ATTENTION.overdueCount,
    overdueAgeDays: row?.overdue_age_days ?? ATTENTION.overdueAgeDays,
    blockedNoUpdateDays: row?.blocked_no_update_days ?? ATTENTION.blockedNoUpdateDays,
    inProgressNoUpdateDays: row?.in_progress_no_update_days ?? ATTENTION.inProgressNoUpdateDays,
    flagProjectReports: row?.flag_project_reports ?? ATTENTION.flagProjectReports,
    flagOverdueDecisions: row?.flag_overdue_decisions ?? ATTENTION.flagOverdueDecisions,
  };
}

/** The rules in force, as sentences, for the footnote under each page. */
export function attentionRules(thresholds: AttentionThresholds, t: TranslateFn = english): string[] {
  const rules = [
    t("teamOverview.rules.overdueCount", { count: thresholds.overdueCount }),
    t("teamOverview.rules.overdueAge", { days: thresholds.overdueAgeDays }),
    t("teamOverview.rules.blocked", { days: thresholds.blockedNoUpdateDays }),
    t("teamOverview.rules.inProgress", { days: thresholds.inProgressNoUpdateDays }),
  ];
  if (thresholds.flagProjectReports) rules.push(t("teamOverview.rules.projectReports"));
  if (thresholds.flagOverdueDecisions) rules.push(t("teamOverview.rules.decisions"));
  return rules;
}

/** Whole days from one calendar date to another. */
export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000,
  );
}

/** English unless the caller passes the viewer's translator (unit tests read English). */
const english = createTranslator("en");

type CountedKey = "overdue" | "oldest" | "blocked" | "inProgress" | "projectReports" | "decisions";

function counted(t: TranslateFn, key: CountedKey, count: number, vars: MessageVars = {}) {
  const suffix = count === 1 ? "One" : "Other";
  return t(`teamOverview.reasons.${key}${suffix}` as MessageKey, { count, ...vars });
}

/**
 * Why this person needs attention, most important first; empty when nothing
 * does. The same rules as app.team_signal_figures() in the database, which
 * drives the reminders and the digest. `staleProjects` is how many active projects they own whose reporting
 * date has passed (the same rule as the dashboard and the stale sweep).
 */
export function attentionReasons(
  row: TeamOverviewRow,
  today: string,
  staleProjects = 0,
  t: TranslateFn = english,
  thresholds: AttentionThresholds = ATTENTION,
): string[] {
  const reasons: string[] = [];
  const oldestAge = row.oldest_overdue_due ? daysBetween(row.oldest_overdue_due, today) : 0;
  if (row.overdue >= thresholds.overdueCount || oldestAge > thresholds.overdueAgeDays) {
    reasons.push(
      `${counted(t, "overdue", row.overdue)}${oldestAge > 0 ? counted(t, "oldest", oldestAge) : ""}`,
    );
  }
  if (row.blocked_stale > 0) {
    reasons.push(
      counted(t, "blocked", row.blocked_stale, { days: thresholds.blockedNoUpdateDays }),
    );
  }
  if (row.in_progress_stale > 0) {
    reasons.push(
      counted(t, "inProgress", row.in_progress_stale, { days: thresholds.inProgressNoUpdateDays }),
    );
  }
  if (thresholds.flagProjectReports && staleProjects > 0) {
    reasons.push(counted(t, "projectReports", staleProjects));
  }
  if (thresholds.flagOverdueDecisions && row.overdue_decisions > 0) {
    reasons.push(counted(t, "decisions", row.overdue_decisions));
  }
  return reasons;
}

/** People needing attention first (most reasons, then most overdue), then by name. */
export function sortForAttention<T extends { row: TeamOverviewRow; reasons: string[] }>(
  entries: T[],
): T[] {
  return [...entries].sort(
    (a, b) =>
      b.reasons.length - a.reasons.length ||
      b.row.overdue - a.row.overdue ||
      a.row.full_name.localeCompare(b.row.full_name),
  );
}

/** The signal kinds the database tracks (team_signal.kind). */
export type SignalKind = "overdue" | "blocked" | "in_progress" | "project_reports" | "decisions";

export const SIGNAL_KINDS: SignalKind[] = [
  "overdue",
  "blocked",
  "in_progress",
  "project_reports",
  "decisions",
];

/**
 * One signal as a sentence, worded exactly as the overview words the same
 * reason. `count` is how many items it covers; `oldestDays` is only used for
 * overdue work.
 */
export function signalReason(
  signal: { kind: SignalKind; count: number; oldestDays?: number | null },
  thresholds: AttentionThresholds = ATTENTION,
  t: TranslateFn = english,
): string {
  switch (signal.kind) {
    case "overdue": {
      const oldest = signal.oldestDays ?? 0;
      return `${counted(t, "overdue", signal.count)}${oldest > 0 ? counted(t, "oldest", oldest) : ""}`;
    }
    case "blocked":
      return counted(t, "blocked", signal.count, { days: thresholds.blockedNoUpdateDays });
    case "in_progress":
      return counted(t, "inProgress", signal.count, { days: thresholds.inProgressNoUpdateDays });
    case "project_reports":
      return counted(t, "projectReports", signal.count);
    case "decisions":
      return counted(t, "decisions", signal.count);
  }
}

/** A row of team_signal_digest() as its signals, in the fixed order. */
export function signalsFromDigestRow(row: {
  kinds: string[];
  overdue: number | string;
  oldest_overdue_days: number | null;
  blocked_stale: number | string;
  in_progress_stale: number | string;
  stale_projects: number | string;
  overdue_decisions: number | string;
}): { kind: SignalKind; count: number; oldestDays?: number | null }[] {
  const counts: Record<SignalKind, number> = {
    overdue: Number(row.overdue),
    blocked: Number(row.blocked_stale),
    in_progress: Number(row.in_progress_stale),
    project_reports: Number(row.stale_projects),
    decisions: Number(row.overdue_decisions),
  };
  return SIGNAL_KINDS.filter((kind) => row.kinds.includes(kind)).map((kind) => ({
    kind,
    count: counts[kind],
    oldestDays: kind === "overdue" ? row.oldest_overdue_days : null,
  }));
}
