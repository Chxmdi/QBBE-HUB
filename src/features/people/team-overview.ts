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

/** Thresholds agreed on #136. Blocked and in-progress ages are set in SQL. */
export const ATTENTION = {
  overdueCount: 3,
  overdueAgeDays: 7,
  blockedNoUpdateDays: 5,
  inProgressNoUpdateDays: 7,
} as const;

function daysBetween(fromDate: string, toDate: string): number {
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
 * does. `staleProjects` is how many active projects they own whose reporting
 * date has passed (the same rule as the dashboard and the stale sweep).
 */
export function attentionReasons(
  row: TeamOverviewRow,
  today: string,
  staleProjects = 0,
  t: TranslateFn = english,
): string[] {
  const reasons: string[] = [];
  const oldestAge = row.oldest_overdue_due ? daysBetween(row.oldest_overdue_due, today) : 0;
  if (row.overdue >= ATTENTION.overdueCount || oldestAge > ATTENTION.overdueAgeDays) {
    reasons.push(
      `${counted(t, "overdue", row.overdue)}${oldestAge > 0 ? counted(t, "oldest", oldestAge) : ""}`,
    );
  }
  if (row.blocked_stale > 0) {
    reasons.push(
      counted(t, "blocked", row.blocked_stale, { days: ATTENTION.blockedNoUpdateDays }),
    );
  }
  if (row.in_progress_stale > 0) {
    reasons.push(
      counted(t, "inProgress", row.in_progress_stale, { days: ATTENTION.inProgressNoUpdateDays }),
    );
  }
  if (staleProjects > 0) {
    reasons.push(counted(t, "projectReports", staleProjects));
  }
  if (row.overdue_decisions > 0) {
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
