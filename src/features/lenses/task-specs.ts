/**
 * The existing task screens' filters as lens specs (M8c), so the new board
 * and My Work read through the engine and still answer the same question as
 * /board and /my-work for the same URL.
 *
 * One deliberate difference, from the engine's hidden-reference rule: a
 * project filter finds only tasks whose project the viewer can read. The old
 * screens also matched a visible task in an unreadable project, which then
 * showed without its project name.
 */

import { dueWindowRange, OPEN_STATUSES, type TaskFilters } from "@/features/tasks/filters";
import type { LensCondition, LensGroup, LensNode, LensSpec } from "@/lib/query/spec";

/** Filters with no lens equivalent yet. The page says so instead of ignoring them. */
export type UnsupportedFilter = "label";

export interface TaskWhere {
  conditions: LensNode[];
  unsupported: UnsupportedFilter[];
}

export function taskFilterConditions(filters: TaskFilters, today: string): TaskWhere {
  const conditions: LensNode[] = [];
  const unsupported: UnsupportedFilter[] = [];
  const add = (c: LensCondition) => conditions.push(c);

  if (filters.status) add({ property: "status", operator: "is", value: filters.status });
  else add({ property: "status", operator: "is_any_of", value: [...OPEN_STATUSES] });

  if (filters.program) add({ property: "program", operator: "is", value: filters.program });
  if (filters.project) add({ property: "project", operator: "contains", value: filters.project });
  if (filters.owner) add({ property: "assignee", operator: "contains", value: filters.owner });
  if (filters.priority) add({ property: "priority", operator: "is", value: filters.priority });
  if (filters.milestone) add({ property: "milestone", operator: "is", value: filters.milestone });
  if (filters.label) unsupported.push("label");

  // Same rules as applyTaskFilters: blocked is a status, emitted only when it
  // says something the status filter has not.
  if (filters.blocked === "yes" && filters.status !== "blocked") {
    add({ property: "status", operator: "is", value: "blocked" });
  }
  if (filters.blocked === "no" && (filters.status === undefined || filters.status === "blocked")) {
    add({ property: "status", operator: "is_not", value: "blocked" });
  }

  if (filters.due) {
    const range = dueWindowRange(filters.due, today);
    if (range.isNull) add({ property: "due", operator: "is_empty" });
    else {
      add({ property: "due", operator: "is_not_empty" });
      if (range.from) add({ property: "due", operator: "on_or_after", value: { date: range.from } });
      if (range.to) add({ property: "due", operator: "on_or_before", value: { date: range.to } });
    }
  }

  if (filters.q) add({ property: "title", operator: "contains", value: filters.q.slice(0, 200) });
  return { conditions, unsupported };
}

/** The columns a task card or row shows. */
export const TASK_CARD_SELECT = ["status", "priority", "due", "assignee", "project", "blocked_reason"];

function where(conditions: LensNode[]): LensGroup | undefined {
  return conditions.length ? { and: conditions } : undefined;
}

/** The board: every task the filters allow, grouped by status. */
export function boardSpec(filters: TaskFilters, today: string): { spec: LensSpec; unsupported: UnsupportedFilter[] } {
  const { conditions, unsupported } = taskFilterConditions(filters, today);
  return {
    spec: {
      version: 1,
      type: "task",
      ...(where(conditions) ? { where: where(conditions) } : {}),
      groupBy: { property: "status" },
      sort: [{ property: "due", direction: "asc" }, { property: "title", direction: "asc" }],
      select: TASK_CARD_SELECT,
      limit: 1000,
    },
    unsupported,
  };
}

/** My Work, owned: tasks assigned to the viewer. */
export function myOwnedSpec(filters: TaskFilters, today: string): { spec: LensSpec; unsupported: UnsupportedFilter[] } {
  const { conditions, unsupported } = taskFilterConditions(filters, today);
  return {
    spec: {
      version: 1,
      type: "task",
      where: { and: [{ property: "assignee", operator: "contains", value: { relative: "me" } }, ...conditions] },
      sort: [{ property: "due", direction: "asc" }, { property: "title", direction: "asc" }],
      select: TASK_CARD_SELECT,
      limit: 1000,
    },
    unsupported,
  };
}

/**
 * My Work, reviewing: the viewer is the reviewer or approver (column or task
 * role) and not the assignee. "Not the assignee" includes unassigned work.
 */
export function myReviewSpec(filters: TaskFilters, today: string): { spec: LensSpec; unsupported: UnsupportedFilter[] } {
  const { conditions, unsupported } = taskFilterConditions(filters, today);
  const me = { relative: "me" };
  return {
    spec: {
      version: 1,
      type: "task",
      where: {
        and: [
          {
            or: [
              { property: "reviewer", operator: "contains", value: me },
              { property: "approver", operator: "contains", value: me },
              { property: "review_role", operator: "contains", value: me },
            ],
          },
          { property: "assignee", operator: "not_contains", value: me },
          ...conditions,
        ],
      },
      sort: [{ property: "due", direction: "asc" }, { property: "title", direction: "asc" }],
      select: TASK_CARD_SELECT,
      limit: 1000,
    },
    unsupported,
  };
}
