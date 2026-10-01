import { describe, expect, it } from "vitest";
import type { ActionContext, ChangeSet, Uuid } from "@/lib/objects/contracts";
import { createActionRegistry, type ChangeSetStore, type ObjectWriter } from "@/features/objects/actions/registry";
import { createTaskCreateAction, TASK_CREATE_ACTION } from "@/features/objects/actions/task-create";

const TASK = "44444444-4444-4444-4444-444444444444";

function setup(create?: Parameters<typeof createTaskCreateAction>[0]) {
  const saved: ChangeSet[] = [];
  const store: ChangeSetStore = {
    begin: async () => 0,
    async save({ actionKey, changes, context, undoOf }) {
      const set = { id: `cs-${saved.length + 1}`, actionKey, actor: context.actor, createdAt: "2026-10-01T12:00:00Z", changes, undoOf };
      saved.push(set);
      return set;
    },
    load: async () => null,
  };
  const writer: ObjectWriter = { apply: async () => undefined, read: async () => null };
  const registry = createActionRegistry({ store, writer });
  registry.register(createTaskCreateAction(create));
  return { registry, saved };
}

const context: ActionContext = { actor: { kind: "person", id: "me" }, can: async (_id: Uuid) => false };

describe("task.create action", () => {
  it("is refused forward when no creator is given, as for the undo route", async () => {
    const { registry, saved } = setup();
    const result = await registry.run(TASK_CREATE_ACTION, { title: "x" }, context);
    expect(result.ok).toBe(false);
    expect(saved).toEqual([]);
  });

  it("runs forward with a creator and records its change set (a button block)", async () => {
    const calls: unknown[] = [];
    const { registry, saved } = setup(async (_context, input) => {
      calls.push(input);
      return [{ kind: "create", object: { id: TASK, type: "task" }, values: { title: input.title } }];
    });
    const result = await registry.run(TASK_CREATE_ACTION, { title: "Call the donor", projectId: TASK }, context);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ title: "Call the donor", projectId: TASK }]);
    expect(saved).toHaveLength(1);
    expect(saved[0].actionKey).toBe(TASK_CREATE_ACTION);
    expect(saved[0].changes[0]).toMatchObject({ kind: "create", object: { id: TASK, type: "task" } });
  });

  it("fails cleanly when the creation is refused", async () => {
    const { registry, saved } = setup(async () => {
      throw new Error("failed");
    });
    const result = await registry.run(TASK_CREATE_ACTION, { title: "x" }, context);
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(saved).toEqual([]);
  });
});
