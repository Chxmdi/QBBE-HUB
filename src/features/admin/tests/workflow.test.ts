import { describe, expect, it } from "vitest";
import { workflowMatches } from "@/features/admin/workflow-match";

describe("workflowMatches", () => {
  it("fires only for enabled rules whose condition matches", () => {
    const rule = {
      trigger_event: "task_status_changed",
      enabled: true,
      condition: { status: "completed" },
    };
    expect(workflowMatches(rule, { type: "task_status_changed", status: "completed" })).toBe(true);
    expect(workflowMatches(rule, { type: "task_status_changed", status: "blocked" })).toBe(false);
    expect(workflowMatches({ ...rule, enabled: false }, { type: "task_status_changed", status: "completed" })).toBe(false);
  });
});
