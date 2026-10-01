import { describe, expect, it } from "vitest";
import type { ActionContext, Change, ChangeSet, Uuid, WorkspaceCapability } from "@/lib/objects/contracts";
import { createActionRegistry, sameValue, type ChangeSetStore, type ObjectWriter } from "@/features/objects/actions/registry";
import { createSetPropertyAction, SET_PROPERTY_ACTION, BULK_EDIT_LIMIT } from "@/features/objects/actions/set-property";
import { statusForActionFailure } from "@/features/objects/actions/server";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

/** Property values in memory: `${id}:${property}` → value. */
function memoryWriter(initial: Record<string, unknown>, failOn?: string): ObjectWriter & { values: Map<string, unknown> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async apply(changes: Change[]) {
      for (const change of changes) {
        if (change.kind !== "update") throw new Error("unsupported");
        if (failOn && change.object.id === failOn && change.after !== initial[`${failOn}:${change.property}`]) {
          throw new Error("forbidden");
        }
        values.set(`${change.object.id}:${change.property}`, change.after);
      }
    },
    async read(change) {
      return values.get(`${change.object.id}:${change.property}`) ?? null;
    },
  };
}

function memoryStore(now: () => Date): ChangeSetStore & { sets: Map<Uuid, ChangeSet & { undoneAt: string | null }> } {
  const sets = new Map<Uuid, ChangeSet & { undoneAt: string | null }>();
  let n = 0;
  return {
    sets,
    begin: async () => n,
    async save({ actionKey, changes, context, undoOf }) {
      n += 1;
      const set = { id: `cs-${n}`, actionKey, actor: context.actor, createdAt: now().toISOString(), changes, undoOf, undoneAt: null };
      sets.set(set.id, set);
      if (undoOf) sets.get(undoOf)!.undoneAt = now().toISOString();
      return set;
    },
    load: async (id) => sets.get(id) ?? null,
  };
}

function context(denied: Uuid[] = []): ActionContext {
  return {
    actor: { kind: "person", id: "me" },
    can: async (id: Uuid, capability: WorkspaceCapability) => capability === "edit_content" && !denied.includes(id),
  };
}

function setup(initial: Record<string, unknown>, options: { failOn?: string; now?: Date } = {}) {
  let clock = options.now ?? new Date("2026-10-01T12:00:00Z");
  const now = () => clock;
  const writer = memoryWriter(initial, options.failOn);
  const store = memoryStore(now);
  const registry = createActionRegistry({ store, writer, now });
  registry.register(createSetPropertyAction(writer));
  return { writer, store, registry, advance: (days: number) => (clock = new Date(clock.getTime() + days * 86_400_000)) };
}

const input = (ids: Uuid[], value: unknown) => ({ objectIds: ids, objectType: "task", property: "status", value });

describe("action registry", () => {
  it("runs bulk edit as one change set holding only what changed", async () => {
    const { registry, writer } = setup({ [`${A}:status`]: "ready", [`${B}:status`]: "blocked", [`${C}:status`]: "completed" });
    const result = await registry.run(SET_PROPERTY_ACTION, input([A, B, C, A], "completed"), context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changeSet.changes).toEqual([
      { kind: "update", object: { id: A, type: "task" }, property: "status", before: "ready", after: "completed" },
      { kind: "update", object: { id: B, type: "task" }, property: "status", before: "blocked", after: "completed" },
    ]);
    expect(writer.values.get(`${A}:status`)).toBe("completed");
  });

  it("refuses the whole edit when any target is not editable", async () => {
    const { registry, writer } = setup({ [`${A}:status`]: "ready", [`${B}:status`]: "ready" });
    const result = await registry.run(SET_PROPERTY_ACTION, input([A, B], "completed"), context([B]));
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(writer.values.get(`${A}:status`)).toBe("ready");
  });

  it("puts back what it changed when a later write fails (all or nothing)", async () => {
    const { registry, writer, store } = setup({ [`${A}:status`]: "ready", [`${B}:status`]: "ready" }, { failOn: B });
    const result = await registry.run(SET_PROPERTY_ACTION, input([A, B], "completed"), context());
    expect(result.ok).toBe(false);
    expect(writer.values.get(`${A}:status`)).toBe("ready");
    expect(store.sets.size).toBe(0);
  });

  it("answers unknown actions, invalid input and empty edits", async () => {
    const { registry } = setup({ [`${A}:status`]: "ready" });
    expect(await registry.run("nope.nope", {}, context())).toEqual({ ok: false, reason: "unknown_action" });
    expect((await registry.run(SET_PROPERTY_ACTION, input(["not-a-uuid"], "x"), context())).ok).toBe(false);
    const tooMany = Array.from({ length: BULK_EDIT_LIMIT + 1 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    expect((await registry.run(SET_PROPERTY_ACTION, input(tooMany, "x"), context())).ok).toBe(false);
    expect(await registry.run(SET_PROPERTY_ACTION, input([A], "ready"), context())).toEqual({
      ok: false,
      reason: "failed",
      message: "Nothing changed.",
    });
  });

  it("refuses to register the same key twice", () => {
    const { registry, writer } = setup({});
    expect(() => registry.register(createSetPropertyAction(writer))).toThrow();
  });
});

describe("undo", () => {
  it("restores every value, records undo_of, and cannot run twice", async () => {
    const { registry, writer } = setup({ [`${A}:status`]: "ready", [`${B}:status`]: "blocked" });
    const run = await registry.run(SET_PROPERTY_ACTION, input([A, B], "completed"), context());
    if (!run.ok) throw new Error("run failed");
    const undo = await registry.undo(run.changeSet.id, context());
    expect(undo.ok && undo.changeSet.undoOf).toBe(run.changeSet.id);
    expect(writer.values.get(`${A}:status`)).toBe("ready");
    expect(writer.values.get(`${B}:status`)).toBe("blocked");
    expect(await registry.undo(run.changeSet.id, context())).toMatchObject({ ok: false, message: "Already undone." });
  });

  it("stops, and says what differs, when someone changed a value since", async () => {
    const { registry, writer } = setup({ [`${A}:status`]: "ready", [`${B}:status`]: "ready" });
    const run = await registry.run(SET_PROPERTY_ACTION, input([A, B], "completed"), context());
    if (!run.ok) throw new Error("run failed");
    writer.values.set(`${B}:status`, "cancelled");
    const undo = await registry.undo(run.changeSet.id, context());
    expect(undo).toEqual({ ok: false, reason: "failed", message: `conflict:${B}:status` });
    expect(writer.values.get(`${A}:status`)).toBe("completed");
    expect(statusForActionFailure("failed", `conflict:${B}:status`)).toBe(409);
  });

  it("needs the capability again on everything touched", async () => {
    const { registry } = setup({ [`${A}:status`]: "ready" });
    const run = await registry.run(SET_PROPERTY_ACTION, input([A], "completed"), context());
    if (!run.ok) throw new Error("run failed");
    expect(await registry.undo(run.changeSet.id, context([A]))).toEqual({ ok: false, reason: "forbidden" });
  });

  it("is offered for 30 days", async () => {
    const { registry, advance } = setup({ [`${A}:status`]: "ready" });
    const run = await registry.run(SET_PROPERTY_ACTION, input([A], "completed"), context());
    if (!run.ok) throw new Error("run failed");
    advance(31);
    expect(await registry.undo(run.changeSet.id, context())).toMatchObject({ ok: false, reason: "failed" });
  });

  it("compares values structurally", () => {
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue("1", 1)).toBe(false);
  });
});

describe("an action that changes nothing", () => {
  const noop = {
    key: "notification.send",
    label: { en: "Send", fr: "Envoyer" },
    capability: "edit_content" as const,
    targets: () => [A],
    run: async (): Promise<Change[]> => [],
  };

  it("runs an action with no targets and leaves the decision to the action itself", async () => {
    const { registry } = setup({});
    let ran = false;
    registry.register({
      ...noop,
      key: "object.request_approval",
      targets: () => [],
      run: async (): Promise<Change[]> => {
        ran = true;
        return [{ kind: "create", object: { id: B, type: "approval_item" }, values: {} }];
      },
    });
    expect(await registry.run("object.request_approval", {}, context([A, B]))).toMatchObject({ ok: true });
    expect(ran).toBe(true);
  });

  it("fails by default, so a bulk edit never records an empty change set", async () => {
    const { registry, store } = setup({});
    registry.register(noop);
    expect(await registry.run("notification.send", {}, context())).toMatchObject({ ok: false, reason: "failed", message: "Nothing changed." });
    expect(store.sets.size).toBe(0);
  });

  it("succeeds with an empty, unstored change set when the runner asks for it", async () => {
    const { store, writer } = setup({});
    const registry = createActionRegistry({ store, writer, onEmpty: "ok" });
    registry.register(noop);
    const result = await registry.run("notification.send", {}, context());
    expect(result).toMatchObject({ ok: true, changeSet: { actionKey: "notification.send", changes: [], undoOf: null } });
    expect(store.sets.size).toBe(0);
  });
});
