import { describe, expect, it } from "vitest";
import { summarizeWorkload, workloadFromCounts } from "@/features/dashboard/portfolio";

const today = "2026-10-22";
const weekOut = "2026-10-29";

describe("workload from database counts", () => {
  it("gives the same figures as counting the tasks one by one", () => {
    const tasks = [
      { assigneeId: "a", assigneeName: "Ada", dueAt: "2026-10-20", estimateHours: 2 },
      { assigneeId: "a", assigneeName: "Ada", dueAt: "2026-10-25", estimateHours: null },
      { assigneeId: "a", assigneeName: "Ada", dueAt: "2026-10-26", estimateHours: 3 },
      { assigneeId: "a", assigneeName: "Ada", dueAt: null, estimateHours: 1 },
      { assigneeId: "b", assigneeName: "Bea", dueAt: "2026-11-30", estimateHours: null },
    ];
    const rows = [
      { assignee_id: "a", assignee_name: "Ada", active: "4", overdue: "1", due_soon: "2", estimated_hours: "6",
        unknown_estimates: "1", near_term_hours: "3", near_term_known: "1", near_term_unknown: "1" },
      { assignee_id: "b", assignee_name: "Bea", active: 1, overdue: 0, due_soon: 0, estimated_hours: 0,
        unknown_estimates: 1, near_term_hours: 0, near_term_known: 0, near_term_unknown: 0 },
    ];
    expect(workloadFromCounts(rows, "Unknown")).toEqual(summarizeWorkload(tasks, today, weekOut));
  });

  it("flags overload from overdue work and names an unknown person", () => {
    const [person] = workloadFromCounts(
      [{ assignee_id: "c", assignee_name: null, active: 5, overdue: 5, due_soon: 0, estimated_hours: null,
        unknown_estimates: 5, near_term_hours: null, near_term_known: 0, near_term_unknown: 0 }],
      "Unknown",
    );
    expect(person.name).toBe("Unknown");
    expect(person.overloaded).toBe(true);
    expect(person.estimatedHours).toBeNull();
  });
});
