import { describe, expect, it } from "vitest";
import {
  BOARD_COLUMNS,
  BULK_STATUSES,
  TASK_STATUSES,
  blockedReasonError,
  bulkSchema,
  circularDependencyError,
  createTaskSchema,
  taskDependencySchema,
} from "@/features/tasks/schemas";

describe("createTaskSchema", () => {
  it("rejects an empty title", () => {
    const parsed = createTaskSchema.safeParse({ title: "   " });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/title/i);
    }
  });

  it("accepts a minimal valid task", () => {
    const parsed = createTaskSchema.safeParse({ title: "Prep workshop" });
    expect(parsed.success).toBe(true);
  });
});

describe("blockedReasonError", () => {
  it("requires a reason when moving to blocked", () => {
    expect(blockedReasonError("blocked", "")).toMatch(/reason/);
    expect(blockedReasonError("blocked", "   ")).toMatch(/reason/);
    expect(blockedReasonError("blocked", "Waiting on venue")).toBeNull();
  });

  it("does not require a reason for other statuses", () => {
    expect(blockedReasonError("waiting")).toBeNull();
    expect(blockedReasonError("cancelled")).toBeNull();
  });
});

describe("canonical statuses", () => {
  it("exposes every P0-TSK-02 status on the board", () => {
    expect(BOARD_COLUMNS).toEqual([...TASK_STATUSES]);
    expect(BOARD_COLUMNS).toContain("waiting");
    expect(BOARD_COLUMNS).toContain("cancelled");
  });

  it("excludes blocked from bulk status changes", () => {
    expect(BULK_STATUSES).not.toContain("blocked");
    expect(BULK_STATUSES).toContain("waiting");
    const parsed = bulkSchema.safeParse({
      taskIds: ["11111111-1111-1111-1111-111111111111"],
      action: "status",
      status: "blocked",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("circularDependencyError", () => {
  it("rejects self-dependencies and two-node cycles", () => {
    expect(
      circularDependencyError("a", "a", []),
    ).toMatch(/itself/);
    expect(
      circularDependencyError("a", "b", [
        { blocking_task_id: "b", blocked_task_id: "a" },
      ]),
    ).toMatch(/cycle/);
    expect(circularDependencyError("a", "b", [])).toBeNull();
  });

  it("validates dependency ids", () => {
    expect(taskDependencySchema.safeParse({ blockingTaskId: "nope", blockedTaskId: "nope" }).success).toBe(false);
  });
});
