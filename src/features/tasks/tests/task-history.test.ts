import { describe, expect, it } from "vitest";
import {
  describeChange,
  diffTaskFields,
  summarizeChanges,
} from "@/features/tasks/services/task.history";

/**
 * P0-TSK-05: changes to owner, due date, status, priority and project are
 * recorded. The events always carried an actor and a timestamp; what they
 * could not say was which field moved and to what. These cover that part.
 */
describe("task field history", () => {
  it("records each tracked field that changed", () => {
    const changes = diffTaskFields(
      {
        assignee_id: "person-a",
        due_at: "2026-10-01",
        status: "in_progress",
        priority: "medium",
        project_id: "project-a",
      },
      {
        assignee_id: "person-b",
        due_at: "2026-10-08",
        status: "in_review",
        priority: "high",
        project_id: "project-a",
      },
    );

    expect(changes.map((c) => c.field)).toEqual([
      "assignee_id",
      "due_at",
      "status",
      "priority",
    ]);
    expect(changes[0]).toMatchObject({ from: "person-a", to: "person-b" });
  });

  it("ignores fields the caller did not write", () => {
    // A patch that only reschedules must not claim the owner changed, which is
    // what comparing against an absent key would do.
    const changes = diffTaskFields(
      { assignee_id: "person-a", due_at: null },
      { due_at: "2026-11-02" },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("due_at");
  });

  it("treats empty string and null as the same absence", () => {
    // Form controls submit "" for a cleared date; the column holds null. That
    // is not a change, and recording it as one fills the history with noise.
    expect(diffTaskFields({ due_at: null }, { due_at: "" })).toEqual([]);
  });

  it("resolves people and projects to names, not identifiers", () => {
    const [change] = diffTaskFields(
      { assignee_id: null },
      { assignee_id: "person-a" },
      { "person-a": "Amara Okonkwo" },
    );
    expect(change.toLabel).toBe("Amara Okonkwo");
    expect(describeChange(change)).toBe("set Owner to Amara Okonkwo");
  });

  it("names statuses the way the interface does", () => {
    const [change] = diffTaskFields(
      { status: "not_started" },
      { status: "in_progress" },
    );
    expect(describeChange(change)).toBe("changed Status from Not started to In progress");
  });

  it("says what a cleared value used to be", () => {
    const [change] = diffTaskFields(
      { due_at: "2026-10-01" },
      { due_at: null },
    );
    expect(describeChange(change)).toBe("cleared Due date (was 2026-10-01)");
  });

  it("falls back to a plain summary when nothing tracked changed", () => {
    expect(summarizeChanges("Draft the report", [])).toBe("updated “Draft the report”");
  });

  it("summarizes several changes in one sentence", () => {
    const changes = diffTaskFields(
      { status: "ready", priority: "low" },
      { status: "in_progress", priority: "high" },
    );
    expect(summarizeChanges("Draft the report", changes)).toBe(
      "changed Status from Ready to In progress, changed Priority from Low to High on “Draft the report”",
    );
  });
});
