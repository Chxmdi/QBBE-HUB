import { describe, expect, it } from "vitest";
import { workflowMatches, workflowRecipients } from "@/features/admin/workflow-match";

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

  it("matches project-health and meeting-completion triggers", () => {
    expect(workflowMatches(
      { trigger_event: "project_health_changed", enabled: true, condition: { status: "at_risk" } },
      { type: "project_health_changed", status: "at_risk" },
    )).toBe(true);
    expect(workflowMatches(
      { trigger_event: "meeting_completed", enabled: true, condition: {} },
      { type: "meeting_completed" },
    )).toBe(true);
    expect(workflowMatches(
      { trigger_event: "event_assignment_created", enabled: true, condition: {} },
      { type: "event_assignment_created" },
    )).toBe(true);
  });

  it("resolves notify_assignee vs notify_admins without notifying the actor", () => {
    expect(
      workflowRecipients({
        actionType: "notify_assignee",
        assigneeId: "user-2",
        adminIds: ["admin-1"],
        actorId: "user-1",
      }),
    ).toEqual(["user-2"]);
    expect(
      workflowRecipients({
        actionType: "notify_admins",
        assigneeId: "user-2",
        adminIds: ["admin-1", "user-1"],
        actorId: "user-1",
      }),
    ).toEqual(["admin-1"]);
    expect(
      workflowRecipients({
        actionType: "notify_event_owner",
        assigneeId: "user-2",
        eventOwnerId: "owner-1",
        adminIds: ["admin-1"],
        actorId: "user-1",
      }),
    ).toEqual(["owner-1"]);
    expect(
      workflowRecipients({
        actionType: "notify_team",
        assigneeId: null,
        teamMemberIds: ["team-member-1", "user-1", "team-member-1"],
        adminIds: ["admin-1"],
        actorId: "user-1",
      }),
    ).toEqual(["team-member-1"]);
  });
});
