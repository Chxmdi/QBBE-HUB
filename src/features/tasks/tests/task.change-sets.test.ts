import { describe, expect, it, vi } from "vitest";
import {
  TASK_CREATE_ACTION,
  recordTaskChangeSet,
  taskCreateChange,
  taskUpdateChanges,
} from "../services/task.change-sets";

const TASK = "11111111-1111-4111-8111-111111111111";

describe("task change sets", () => {
  it("records one update per registered property that changed, nothing for the rest", () => {
    const changes = taskUpdateChanges(
      TASK,
      { title: "Book the hall", due_at: "2026-10-21", assignee_id: null, status: "not_started", priority: "medium" },
      { title: "Book the hall", due_at: "2026-10-28", assignee_id: "", status: "not_started", priority: "high" },
    );
    expect(changes).toEqual([
      { kind: "update", object: { id: TASK, type: "task" }, property: "due", before: "2026-10-21", after: "2026-10-28" },
      { kind: "update", object: { id: TASK, type: "task" }, property: "priority", before: "medium", after: "high" },
    ]);
  });

  it("ignores columns the screen did not send", () => {
    expect(taskUpdateChanges(TASK, { status: "blocked" }, { due_at: "2026-10-28" })).toEqual([
      { kind: "update", object: { id: TASK, type: "task" }, property: "due", before: null, after: "2026-10-28" },
    ]);
  });

  it("records a creation with the values the row started with, empties left out", () => {
    expect(taskCreateChange(TASK, { title: "Order chairs", assignee_id: null, due_at: "", status: "not_started" })).toEqual({
      kind: "create",
      object: { id: TASK, type: "task" },
      values: { title: "Order chairs", status: "not_started" },
    });
  });

  it("writes through record_change_set and never fails the save", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "cs-1" }, error: null });
    const id = await recordTaskChangeSet({ rpc } as never, TASK_CREATE_ACTION, [taskCreateChange(TASK, { title: "x" })]);
    expect(id).toBe("cs-1");
    expect(rpc).toHaveBeenCalledWith("record_change_set", {
      p_action_key: "task.create",
      p_changes: [{ kind: "create", object: { id: TASK, type: "task" }, values: { title: "x" } }],
    });

    const failing = vi.fn().mockResolvedValue({ data: null, error: { message: "nope" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await recordTaskChangeSet({ rpc: failing } as never, TASK_CREATE_ACTION, [taskCreateChange(TASK, { title: "x" })])).toBeNull();
    spy.mockRestore();
  });

  it("records nothing when nothing changed", async () => {
    const rpc = vi.fn();
    expect(await recordTaskChangeSet({ rpc } as never, TASK_CREATE_ACTION, [])).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
