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

/**
 * #76: the diff covered five fields, so moving a task to another milestone or
 * changing who approves it recorded a bare "updated" with empty metadata.
 * P0-TSK-05 is about material changes being answerable afterwards, and those
 * are material — the approver column is read by `app.has_task_capability`.
 */
describe("the fields a task history can answer for", () => {
  it("records a milestone move with both names", () => {
    const changes = diffTaskFields(
      { milestone_id: "m-1" },
      { milestone_id: "m-2" },
      { "m-1": "Venue confirmed", "m-2": "Registration open" },
    );
    expect(changes).toHaveLength(1);
    expect(describeChange(changes[0])).toBe(
      "changed Milestone from Venue confirmed to Registration open",
    );
  });

  it("records naming a reviewer and an approver", () => {
    const changes = diffTaskFields(
      { reviewer_id: null, approver_id: null },
      { reviewer_id: "u-1", approver_id: "u-2" },
      { "u-1": "Dana Reyes", "u-2": "Sam Okafor" },
    );
    expect(changes.map(describeChange)).toEqual([
      "set Reviewer to Dana Reyes",
      "set Approver to Sam Okafor",
    ]);
  });

  it("records clearing an approver, not just setting one", () => {
    const changes = diffTaskFields(
      { approver_id: "u-2" },
      { approver_id: null },
      { "u-2": "Sam Okafor" },
    );
    expect(describeChange(changes[0])).toBe("cleared Approver (was Sam Okafor)");
  });

  it("shortens long free text so one field cannot swallow the entry", () => {
    const criteria =
      "Every registrant has been emailed, the attendance sheet is filed, " +
      "and the final headcount is recorded against the grant report.";
    const changes = diffTaskFields(
      { completion_criteria: null },
      { completion_criteria: criteria },
    );
    const described = describeChange(changes[0]);
    expect(described.startsWith("set Completion criteria to ")).toBe(true);
    expect(described).toContain("…");
    // The full value stays in the change record even though the sentence is cut.
    expect(changes[0].to).toBe(criteria);
    expect(described.length).toBeLessThan(criteria.length);
  });

  it("records a blocked reason arriving and being cleared", () => {
    const set = diffTaskFields(
      { blocked_reason: null },
      { blocked_reason: "Waiting on the signed venue contract." },
    );
    expect(describeChange(set[0])).toBe(
      "set Blocked reason to Waiting on the signed venue contract.",
    );
    const cleared = diffTaskFields(
      { blocked_reason: "Waiting on the signed venue contract." },
      { blocked_reason: null },
    );
    expect(describeChange(cleared[0])).toBe(
      "cleared Blocked reason (was Waiting on the signed venue contract.)",
    );
  });

  it("reports a bulk unblock as a status change and a cleared reason together", () => {
    // The bulk path used to write only the status, leaving the old reason on
    // the row and out of the history at the same time.
    const changes = diffTaskFields(
      { status: "blocked", blocked_reason: "Waiting on the venue." },
      { status: "in_progress", blocked_reason: null },
    );
    expect(summarizeChanges("Book the hall", changes)).toBe(
      "changed Status from Blocked to In progress, " +
        "cleared Blocked reason (was Waiting on the venue.) on “Book the hall”",
    );
  });
});
