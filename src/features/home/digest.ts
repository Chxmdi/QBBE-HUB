import type { TaskStatus } from "@/types/entities";
import { activityHref, taskHref } from "./sections";

/**
 * "While you were away" (M17d, epic #199): what changed on the viewer's work
 * since their last visit, ranked by fixed rules. No summarising model: each
 * entry is one recorded change, and the rank comes from its kind.
 *
 *   newly blocked (a followed task moved to blocked)         60
 *   approval requested of you                                55
 *   deadline moved (a followed task's due date changed)      50, +10 if sooner
 *   project health changed                                   45, +10 if now off track
 *   approval decided on something you asked for              40
 *   number changed (a followed metric's new value differs)   40
 *   followed work completed                                  30
 *   other status change on followed work                     25
 *
 * "Followed work" is the viewer's own tasks (assignee, requester, reviewer,
 * approver or task role), and tasks and updates in projects they own,
 * sponsor or have tasks in. Changes the viewer made are left out.
 * Several changes to one record of one kind show once, as the latest, with
 * a count. Ties go to the most recent, then the key, so the order is total.
 */

export const DIGEST_WEIGHTS = {
  newly_blocked: 60,
  approval_requested: 55,
  deadline_moved: 50,
  health_changed: 45,
  approval_decided: 40,
  number_changed: 40,
  completed: 30,
  status_changed: 25,
} as const;
export type DigestKind = keyof typeof DIGEST_WEIGHTS;

export const DIGEST_LIMIT = 10;
/** With no earlier visit, the digest looks back this far. */
export const FIRST_VISIT_DAYS = 7;

export interface DigestChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface DigestActivity {
  id: string;
  actor_id: string | null;
  verb: string;
  source_type: string;
  source_id: string;
  project_id: string | null;
  summary: string;
  created_at: string;
  metadata: { changes?: DigestChange[] } | null;
  actor?: { full_name: string } | null;
}

export interface DigestInput {
  userId: string;
  /** Where the digest starts (ISO instant). */
  since: string;
  followedTaskIds: ReadonlySet<string>;
  followedProjectIds: ReadonlySet<string>;
  /** Task titles by id, for changes whose summary is not a title. */
  taskTitles: ReadonlyMap<string, string>;
  activity: DigestActivity[];
  approvalsForMe: { id: string; note: string | null; created_at: string; requested_by_name: string | null }[];
  myDecidedRequests: { id: string; note: string | null; decision: string; decided_at: string }[];
  measurements: {
    id: string;
    metric_id: string;
    metric_name: string;
    unit: string | null;
    value: number;
    previous: number | null;
    created_at: string;
    /** The metric's program page, where its values are shown. */
    href: string;
  }[];
  statusUpdates: {
    id: string;
    project_id: string;
    project_name: string;
    health: string;
    previous: string | null;
    created_at: string;
  }[];
}

export type DigestDetail =
  | { kind: "newly_blocked"; reason: string | null }
  | { kind: "deadline_moved"; from: string | null; to: string | null; sooner: boolean }
  | { kind: "status_changed"; from: TaskStatus | null; to: TaskStatus }
  | { kind: "completed" }
  | { kind: "approval_requested"; by: string | null }
  | { kind: "approval_decided"; decision: string }
  | { kind: "health_changed"; from: string | null; to: string }
  | { kind: "number_changed"; from: number | null; to: number; unit: string | null };

export interface DigestEntry {
  key: string;
  kind: DigestKind;
  weight: number;
  at: string;
  title: string;
  href: string;
  /** Who made the change, when known. */
  by: string | null;
  /** How many changes of this kind to this record were folded into this entry. */
  count: number;
  detail: DigestDetail;
}

function followed(input: DigestInput, activity: DigestActivity): boolean {
  if (activity.source_type === "task" && input.followedTaskIds.has(activity.source_id)) return true;
  if (activity.source_type === "project" && input.followedProjectIds.has(activity.source_id)) return true;
  return activity.project_id !== null && input.followedProjectIds.has(activity.project_id);
}

function titleOf(input: DigestInput, activity: DigestActivity): string {
  return (activity.source_type === "task" && input.taskTitles.get(activity.source_id)) || activity.summary;
}

function fromActivity(input: DigestInput, activity: DigestActivity): Omit<DigestEntry, "count">[] {
  const base = {
    at: activity.created_at,
    title: titleOf(input, activity),
    href: activity.source_type === "task" ? taskHref(activity.source_id) : activityHref(activity),
    by: activity.actor?.full_name ?? null,
  };
  const record = `${activity.source_type}:${activity.source_id}`;
  const entries: Omit<DigestEntry, "count">[] = [];
  const changes = activity.metadata?.changes ?? [];

  for (const change of changes) {
    if (change.field === "status" && change.to) {
      const to = change.to as TaskStatus;
      if (to === "blocked") {
        const reason = changes.find((other) => other.field === "blocked_reason")?.to ?? null;
        entries.push({ ...base, key: `${record}:newly_blocked`, kind: "newly_blocked", weight: DIGEST_WEIGHTS.newly_blocked, detail: { kind: "newly_blocked", reason } });
      } else if (to === "completed") {
        entries.push({ ...base, key: `${record}:completed`, kind: "completed", weight: DIGEST_WEIGHTS.completed, detail: { kind: "completed" } });
      } else {
        entries.push({
          ...base,
          key: `${record}:status_changed`,
          kind: "status_changed",
          weight: DIGEST_WEIGHTS.status_changed,
          detail: { kind: "status_changed", from: (change.from as TaskStatus | null) ?? null, to },
        });
      }
    }
    if (change.field === "due_at") {
      const from = change.from?.slice(0, 10) ?? null;
      const to = change.to?.slice(0, 10) ?? null;
      // Sooner: a date moved earlier, or a date appearing where there was none.
      const sooner = to !== null && (from === null || to < from);
      entries.push({
        ...base,
        key: `${record}:deadline_moved`,
        kind: "deadline_moved",
        weight: DIGEST_WEIGHTS.deadline_moved + (sooner ? 10 : 0),
        detail: { kind: "deadline_moved", from, to, sooner },
      });
    }
  }
  // Completions recorded without a field diff (projects).
  if (changes.length === 0 && activity.verb === "completed") {
    entries.push({ ...base, key: `${record}:completed`, kind: "completed", weight: DIGEST_WEIGHTS.completed, detail: { kind: "completed" } });
  }
  return entries;
}

export function buildDigest(input: DigestInput): DigestEntry[] {
  const after = (at: string) => at > input.since;
  const candidates: Omit<DigestEntry, "count">[] = [];

  for (const activity of input.activity) {
    if (activity.actor_id === input.userId || !after(activity.created_at) || !followed(input, activity)) continue;
    candidates.push(...fromActivity(input, activity));
  }
  for (const approval of input.approvalsForMe) {
    if (!after(approval.created_at)) continue;
    candidates.push({
      key: `approval:${approval.id}:approval_requested`,
      kind: "approval_requested",
      weight: DIGEST_WEIGHTS.approval_requested,
      at: approval.created_at,
      title: approval.note?.split("\n")[0] ?? "",
      href: "/approvals",
      by: approval.requested_by_name,
      detail: { kind: "approval_requested", by: approval.requested_by_name },
    });
  }
  for (const request of input.myDecidedRequests) {
    if (!after(request.decided_at)) continue;
    candidates.push({
      key: `approval:${request.id}:approval_decided`,
      kind: "approval_decided",
      weight: DIGEST_WEIGHTS.approval_decided,
      at: request.decided_at,
      title: request.note?.split("\n")[0] ?? "",
      href: "/approvals",
      by: null,
      detail: { kind: "approval_decided", decision: request.decision },
    });
  }
  for (const update of input.statusUpdates) {
    if (!after(update.created_at) || update.previous === update.health) continue;
    candidates.push({
      key: `project:${update.project_id}:health_changed`,
      kind: "health_changed",
      weight: DIGEST_WEIGHTS.health_changed + (update.health === "off_track" ? 10 : 0),
      at: update.created_at,
      title: update.project_name,
      href: `/projects/${update.project_id}`,
      by: null,
      detail: { kind: "health_changed", from: update.previous, to: update.health },
    });
  }
  for (const measurement of input.measurements) {
    if (!after(measurement.created_at) || measurement.previous === measurement.value) continue;
    candidates.push({
      key: `metric:${measurement.metric_id}:number_changed`,
      kind: "number_changed",
      weight: DIGEST_WEIGHTS.number_changed,
      at: measurement.created_at,
      title: measurement.metric_name,
      href: measurement.href,
      by: null,
      detail: { kind: "number_changed", from: measurement.previous, to: measurement.value, unit: measurement.unit },
    });
  }

  // One entry per record and kind: the latest, counting the others. A later
  // change that reverses an earlier one still shows as the latest state.
  const byKey = new Map<string, DigestEntry>();
  for (const candidate of candidates) {
    const existing = byKey.get(candidate.key);
    if (!existing) {
      byKey.set(candidate.key, { ...candidate, count: 1 });
    } else {
      const latest = candidate.at > existing.at ? candidate : existing;
      byKey.set(candidate.key, { ...latest, count: existing.count + 1 });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.weight - a.weight || b.at.localeCompare(a.at) || a.key.localeCompare(b.key))
    .slice(0, DIGEST_LIMIT);
}
