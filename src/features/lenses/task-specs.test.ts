import { describe, expect, it } from "vitest";
import { OPEN_STATUSES } from "@/features/tasks/filters";
import { parseLensSpec } from "@/lib/query/run";
import { boardSpec, myOwnedSpec, myReviewSpec, taskFilterConditions } from "./task-specs";

const today = "2026-10-05";
const id = "11111111-1111-4111-8111-111111111111";

describe("task filters as lens conditions", () => {
  it("defaults to open work, as applyTaskFilters does", () => {
    expect(taskFilterConditions({}, today).conditions).toEqual([
      { property: "status", operator: "is_any_of", value: [...OPEN_STATUSES] },
    ]);
  });

  it("maps every supported filter", () => {
    const { conditions, unsupported } = taskFilterConditions(
      { status: "blocked", program: id, project: id, owner: id, priority: "high", milestone: id, label: id, due: "week", q: "grant" },
      today,
    );
    expect(conditions).toEqual([
      { property: "status", operator: "is", value: "blocked" },
      { property: "program", operator: "is", value: id },
      { property: "project", operator: "contains", value: id },
      { property: "assignee", operator: "contains", value: id },
      { property: "priority", operator: "is", value: "high" },
      { property: "milestone", operator: "is", value: id },
      { property: "due", operator: "is_not_empty" },
      { property: "due", operator: "on_or_after", value: { date: "2026-10-05" } },
      { property: "due", operator: "on_or_before", value: { date: "2026-10-11" } },
      { property: "title", operator: "contains", value: "grant" },
    ]);
    expect(unsupported).toEqual(["label"]);
  });

  it("keeps the blocked filter's rules", () => {
    expect(taskFilterConditions({ blocked: "yes" }, today).conditions).toContainEqual({ property: "status", operator: "is", value: "blocked" });
    expect(taskFilterConditions({ blocked: "yes", status: "blocked" }, today).conditions).toHaveLength(1);
    expect(taskFilterConditions({ blocked: "no" }, today).conditions).toContainEqual({ property: "status", operator: "is_not", value: "blocked" });
    expect(taskFilterConditions({ blocked: "no", status: "ready" }, today).conditions).toHaveLength(1);
  });

  it("maps due windows", () => {
    expect(taskFilterConditions({ due: "none" }, today).conditions).toContainEqual({ property: "due", operator: "is_empty" });
    const overdue = taskFilterConditions({ due: "overdue" }, today).conditions;
    expect(overdue).toContainEqual({ property: "due", operator: "on_or_before", value: { date: "2026-10-04" } });
    expect(overdue.some((c) => "operator" in c && c.operator === "on_or_after")).toBe(false);
  });
});

describe("screen specs", () => {
  it("are valid engine specs", () => {
    for (const build of [boardSpec, myOwnedSpec, myReviewSpec]) {
      expect(() => parseLensSpec(build({ q: "x", due: "today", blocked: "no" }, today).spec)).not.toThrow();
    }
  });

  it("scopes My Work to the viewer, and review to work the viewer does not own", () => {
    expect(JSON.stringify(myOwnedSpec({}, today).spec.where)).toContain('"assignee","operator":"contains","value":{"relative":"me"}');
    const review = JSON.stringify(myReviewSpec({}, today).spec.where);
    expect(review).toContain('"review_role"');
    expect(review).toContain('"approver"');
    expect(review).toContain('"assignee","operator":"not_contains"');
  });

  it("groups the board by status", () => {
    expect(boardSpec({}, today).spec.groupBy).toEqual({ property: "status" });
  });
});
