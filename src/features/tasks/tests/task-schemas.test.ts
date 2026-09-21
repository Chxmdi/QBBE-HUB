import { describe, expect, it } from "vitest";
import {
  BOARD_COLUMNS,
  BULK_STATUSES,
  TASK_STATUSES,
  blockedReasonError,
  bulkSchema,
  circularDependencyError,
  createLabelSchema,
  createTaskSchema,
  taskDependencySchema,
  taskLabelSchema,
} from "@/features/tasks/schemas";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const LABEL_ID = "22222222-2222-4222-8222-222222222222";

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

/**
 * #76: `label` and `task_label` shipped in `0001_core.sql` with correct
 * policies, the filter bar has offered a label picker since #30, and nothing
 * ever wrote a row to either table. These cover the schemas for the write path
 * that was missing.
 */
describe("label schemas", () => {
  it("rejects a label with no name", () => {
    expect(createLabelSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("trims the name, because the unique key is (organization, name)", () => {
    // Two labels differing only by surrounding space are one label to the
    // database and two to the reader.
    const parsed = createLabelSchema.safeParse({ name: "  Fundraising  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("Fundraising");
  });

  it("defaults the colour rather than requiring one", () => {
    const parsed = createLabelSchema.safeParse({ name: "Fundraising" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.color).toBe("neutral");
  });

  it("refuses a colour with no badge to render it", () => {
    expect(
      createLabelSchema.safeParse({ name: "Fundraising", color: "chartreuse" }).success,
    ).toBe(false);
  });

  it("requires both ids to attach a label to a task", () => {
    expect(taskLabelSchema.safeParse({ taskId: TASK_ID }).success).toBe(false);
    expect(
      taskLabelSchema.safeParse({ taskId: TASK_ID, labelId: LABEL_ID }).success,
    ).toBe(true);
  });

  it("refuses an id that is not a uuid", () => {
    expect(
      taskLabelSchema.safeParse({ taskId: TASK_ID, labelId: "all" }).success,
    ).toBe(false);
  });
});

describe("creating a task", () => {
  it("accepts an approver, which had a column and no control", () => {
    const parsed = createTaskSchema.safeParse({
      title: "Confirm the venue",
      approverId: LABEL_ID,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.approverId).toBe(LABEL_ID);
  });
});
