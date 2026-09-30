import type { FilterNode, FilterScalar, FilterValue, PropertyFilter, QuerySpec } from "@/lib/objects/contracts";

/**
 * Following and notification rules (V1-14): which kind of change an event is,
 * what a person's rule says to do with it, and whether a task matches a
 * followed query. Pure, so the fan-out job's decisions are unit-tested.
 */

export const EVENT_KINDS = ["status", "assignment", "due", "comment", "change"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EMAIL_MODES = ["immediate", "daily", "weekly", "off"] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];

export interface FollowRule {
  event_kind: EventKind;
  in_app: boolean;
  email: EmailMode;
}

/** What a person gets before they change anything: the Hub for everything, email weekly for the big ones. */
export const DEFAULT_RULES: Record<EventKind, Omit<FollowRule, "event_kind">> = {
  status: { in_app: true, email: "weekly" },
  assignment: { in_app: true, email: "weekly" },
  due: { in_app: true, email: "weekly" },
  comment: { in_app: true, email: "off" },
  change: { in_app: true, email: "off" },
};

/** The one choice people make per kind of change. */
export const RULE_CHOICES = ["none", "hub", "immediate", "daily", "weekly"] as const;
export type RuleChoice = (typeof RULE_CHOICES)[number];

export function choiceOf(rule: Omit<FollowRule, "event_kind">): RuleChoice {
  if (!rule.in_app) return "none";
  return rule.email === "off" ? "hub" : rule.email;
}

export function ruleFromChoice(choice: RuleChoice): Omit<FollowRule, "event_kind"> {
  if (choice === "none") return { in_app: false, email: "off" };
  if (choice === "hub") return { in_app: true, email: "off" };
  return { in_app: true, email: choice };
}

export function effectiveRule(rules: FollowRule[], kind: EventKind): Omit<FollowRule, "event_kind"> {
  const own = rules.find((r) => r.event_kind === kind);
  return own ? { in_app: own.in_app, email: own.email } : DEFAULT_RULES[kind];
}

export interface ActivityEvent {
  id: string;
  organization_id: string;
  actor_id: string | null;
  verb: string;
  source_type: string;
  source_id: string;
  project_id: string | null;
  program_id: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** The kind of change an activity event is, from its verb and the fields it changed. */
export function classifyEvent(event: Pick<ActivityEvent, "verb" | "metadata">): EventKind {
  if (event.verb === "commented") return "comment";
  if (event.verb === "completed" || event.verb === "reopened") return "status";
  const metadata = event.metadata ?? {};
  if (typeof metadata.role === "string") return "assignment";
  const fields = Array.isArray(metadata.changes)
    ? (metadata.changes as { field?: unknown }[]).map((c) => String(c.field ?? ""))
    : [];
  if (fields.includes("status")) return "status";
  if (fields.some((f) => f === "assignee_id" || f === "reviewer_id" || f === "requester_id")) return "assignment";
  if (fields.some((f) => f === "due_at" || f === "start_at")) return "due";
  return "change";
}

export function categoryFor(kind: EventKind): string {
  return `follow_${kind}`;
}

export function linkFor(event: Pick<ActivityEvent, "source_type" | "source_id">): string | null {
  if (event.source_type === "task") return `/my-work?task=${event.source_id}`;
  if (event.source_type === "project") return `/projects/${event.source_id}`;
  return null;
}

// ---------------------------------------------------------------------------
// Followed queries, matched against a task row
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: string;
  status: string | null;
  priority: string | null;
  assignee_id: string | null;
  requester_id: string | null;
  reviewer_id: string | null;
  project_id: string | null;
  program_id: string | null;
  start_at: string | null;
  due_at: string | null;
  title: string | null;
}

const TASK_COLUMNS: Record<string, keyof TaskRow> = {
  title: "title",
  status: "status",
  priority: "priority",
  assignee: "assignee_id",
  requester: "requester_id",
  reviewer: "reviewer_id",
  project: "project_id",
  program: "program_id",
  start: "start_at",
  due: "due_at",
};

export const TASK_ROW_COLUMNS = "id, status, priority, assignee_id, requester_id, reviewer_id, project_id, program_id, start_at, due_at, title";

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

interface MatchContext {
  userId: string;
  /** Today in the organization's zone, YYYY-MM-DD. */
  today: string;
}

/** A relative value as a point or a date range [from, to). */
function resolve(value: FilterValue | undefined, context: MatchContext): FilterScalar | FilterScalar[] | { from: string; to: string } {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value as FilterScalar | FilterScalar[];
  switch (value.relative) {
    case "me":
      return context.userId;
    case "today":
      return { from: context.today, to: addDays(context.today, 1) };
    case "days_from_today": {
      const day = addDays(context.today, value.days);
      return { from: day, to: addDays(day, 1) };
    }
    case "this_week": {
      const weekday = new Date(`${context.today}T00:00:00Z`).getUTCDay();
      const monday = addDays(context.today, -((weekday + 6) % 7));
      return { from: monday, to: addDays(monday, 7) };
    }
  }
}

function matchFilter(filter: PropertyFilter, task: TaskRow, context: MatchContext): boolean {
  if (typeof filter.property !== "string") return false;
  const column = TASK_COLUMNS[filter.property];
  if (!column) return false;
  const actual = task[column];
  if (filter.op === "is_empty") return actual === null || actual === "";
  if (filter.op === "is_not_empty") return actual !== null && actual !== "";
  const expected = resolve(filter.value, context);
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    if (actual === null) return false;
    const day = String(actual).slice(0, 10);
    switch (filter.op) {
      case "eq":
        return day >= expected.from && day < expected.to;
      case "neq":
        return !(day >= expected.from && day < expected.to);
      case "lt":
        return day < expected.from;
      case "lte":
        return day < expected.to;
      case "gt":
        return day >= expected.to;
      case "gte":
        return day >= expected.from;
      default:
        return false;
    }
  }
  switch (filter.op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "contains":
      return typeof actual === "string" && typeof expected === "string" && actual.toLowerCase().includes(expected.toLowerCase());
    case "lt":
      return actual !== null && expected !== null && String(actual) < String(expected);
    case "lte":
      return actual !== null && expected !== null && String(actual) <= String(expected);
    case "gt":
      return actual !== null && expected !== null && String(actual) > String(expected);
    case "gte":
      return actual !== null && expected !== null && String(actual) >= String(expected);
    default:
      return false;
  }
}

function matchNode(node: FilterNode, task: TaskRow, context: MatchContext): boolean {
  if ("and" in node) return node.and.every((child) => matchNode(child, task, context));
  if ("or" in node) return node.or.some((child) => matchNode(child, task, context));
  return matchFilter(node, task, context);
}

/**
 * Whether a task is in a followed query's results. Only task queries match
 * today, as the query stand-in only knows tasks; relation paths never match.
 * Access is checked separately (can_as), never here.
 */
export function taskMatchesQuery(spec: QuerySpec, task: TaskRow, context: MatchContext): boolean {
  if (spec.version !== 1 || !spec.types.includes("task")) return false;
  if (spec.parentObjectId && task.project_id !== spec.parentObjectId) return false;
  return spec.filter ? matchNode(spec.filter, task, context) : true;
}

/** The ready-made queries people can follow from the Following page. */
export const PRESET_QUERIES = {
  my_blocked: {
    version: 1,
    types: ["task"],
    filter: { and: [{ property: "assignee", op: "eq", value: { relative: "me" } }, { property: "status", op: "eq", value: "blocked" }] },
  },
  due_this_week: {
    version: 1,
    types: ["task"],
    filter: { and: [{ property: "assignee", op: "eq", value: { relative: "me" } }, { property: "due", op: "eq", value: { relative: "this_week" } }] },
  },
  i_requested: {
    version: 1,
    types: ["task"],
    filter: { property: "requester", op: "eq", value: { relative: "me" } },
  },
} satisfies Record<string, QuerySpec>;

export type PresetQueryKey = keyof typeof PRESET_QUERIES;
