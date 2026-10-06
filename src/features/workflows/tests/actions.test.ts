import { describe, expect, it } from "vitest";
import { fakeDb, changeSetRow, type RpcCall } from "@/lib/objects/testing/fake-db";
import { actorSetting, createWorkflowActionRegistry, workflowActionKeys, workflowActionLabels } from "../actions";

const TASK = "11111111-1111-4111-8111-111111111111";
const ORG = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";

/**
 * Just enough of the database for the task actions: the task row, the service
 * role write (apply_task_update_as) and the change set functions.
 */
function setup(task: Record<string, unknown> | null, options: { changeSets?: Record<string, unknown>[] } = {}) {
  const patches: Record<string, unknown>[] = [];
  const stored = options.changeSets ?? [];
  const { db, rpcCalls } = fakeDb({
    table: (call) => {
      if (call.table === "task") return { data: task, error: null };
      if (call.table === "change_set") {
        const id = call.filters.find((f) => f.column === "id")?.value;
        return { data: stored.find((row) => row.id === id) ?? null, error: null };
      }
      if (call.table === "change_set_item") {
        const id = call.filters.find((f) => f.column === "change_set_id")?.value;
        const set = stored.find((row) => row.id === id) as { items?: unknown[] } | undefined;
        return { data: set?.items ?? [], error: null };
      }
      return { data: null, error: null };
    },
    rpc: ({ fn, args }) => {
      if (fn === "apply_task_update_as") {
        if (!task || task.organization_id !== args.p_organization) return { data: null, error: null };
        patches.push(args.p_patch as Record<string, unknown>);
        Object.assign(task, args.p_patch);
        return { data: TASK, error: null };
      }
      if (fn === "object_event_high_water") return { data: 7, error: null };
      if (fn === "record_change_set_as") {
        return { data: changeSetRow(`cs-${rpcCalls.filter((c) => c.fn === fn).length}`, { actor_kind: "automation", actor_id: "wf" }), error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  });
  const registry = createWorkflowActionRegistry({
    db,
    organizationId: ORG,
    workflowId: "wf",
    runId: "run",
    runAs: { userId: OWNER, assurance: "aal2" },
  });
  const recorded = () => rpcCalls.filter((c): c is RpcCall => c.fn === "record_change_set_as");
  return { registry, patches, rpcCalls, recorded };
}

const allow = { actor: { kind: "automation" as const, id: "wf" }, can: async () => true };
const deny = { ...allow, can: async () => false };

describe("workflow action registry", () => {
  it("labels every action in both languages", () => {
    for (const key of workflowActionKeys) {
      expect(workflowActionLabels[key].en).toBeTruthy();
      expect(workflowActionLabels[key].fr).toBeTruthy();
    }
  });

  it("spells the actor as app.actor reads it", () => {
    expect(actorSetting({ kind: "automation", id: "wf" })).toBe("automation:wf");
    expect(actorSetting({ kind: "integration", id: "api:tok" })).toBe("integration:api:tok");
  });

  it("changes a task as the automation and records the change set for the owner", async () => {
    const { registry, patches, rpcCalls, recorded } = setup({ id: TASK, organization_id: ORG, priority: "low" });
    const result = await registry.run("task.set_priority", { taskId: TASK, priority: "high" }, allow);
    expect(result).toMatchObject({
      ok: true,
      changeSet: {
        id: "cs-1",
        actionKey: "task.set_priority",
        actor: { kind: "automation", id: "wf" },
        changes: [{ kind: "update", property: "priority", before: "low", after: "high" }],
      },
    });
    expect(patches).toEqual([{ priority: "high" }]);
    // The write carries the actor, so the task trigger's object_event names the workflow.
    expect(rpcCalls.find((c) => c.fn === "apply_task_update_as")?.args).toEqual({
      p_actor: "automation:wf",
      p_organization: ORG,
      p_task: TASK,
      p_patch: { priority: "high" },
    });
    // The change set is recorded as the automation, checked for the owner at aal2,
    // and claims the events since the marker.
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0].args).toEqual({
      p_actor: "automation:wf",
      p_user: OWNER,
      p_assurance: "aal2",
      p_action_key: "task.set_priority",
      p_changes: [{ kind: "update", object: { id: TASK, type: "task" }, property: "priority", before: "low", after: "high" }],
      p_since_seq: 7,
      p_undo_of: null,
    });
  });

  it("is refused when the workflow's owner may not edit the task", async () => {
    const { registry, patches, recorded } = setup({ id: TASK, organization_id: ORG, status: "ready" });
    const result = await registry.run("task.set_status", { taskId: TASK, status: "completed" }, deny);
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(patches).toEqual([]);
    expect(recorded()).toEqual([]);
  });

  it("refuses a task from another organization and bad input", async () => {
    const { registry } = setup({ id: TASK, organization_id: "someone-else", status: "ready" });
    expect(await registry.run("task.set_status", { taskId: TASK, status: "completed" }, allow))
      .toMatchObject({ ok: false, reason: "failed", message: "The task does not exist." });
    expect(await registry.run("task.set_status", { taskId: TASK, status: "exploded" }, allow))
      .toMatchObject({ ok: false, reason: "failed" });
    expect(await registry.run("task.nope", {}, allow)).toEqual({ ok: false, reason: "unknown_action" });
  });

  it("sets completed_at with a completed status and records nothing when unchanged", async () => {
    const { registry, patches, recorded } = setup({ id: TASK, organization_id: ORG, status: "ready" });
    await registry.run("task.set_status", { taskId: TASK, status: "completed" }, allow);
    expect(patches[0]).toMatchObject({ status: "completed" });
    expect(typeof patches[0].completed_at).toBe("string");
    const again = await registry.run("task.set_status", { taskId: TASK, status: "completed" }, allow);
    expect(again.ok && again.changeSet.changes).toEqual([]);
    // A step that changed nothing succeeds but has no change set to store.
    expect(recorded()).toHaveLength(1);
  });

  it("undoes a recorded change set through the same labelled write", async () => {
    const task = { id: TASK, organization_id: ORG, priority: "high" };
    const { registry, patches, rpcCalls, recorded } = setup(task, {
      changeSets: [{
        ...changeSetRow("cs-1", { actor_kind: "automation", actor_id: "wf", action_key: "task.set_priority" }),
        items: [{ position: 0, kind: "update", object_id: TASK, object_type: "task", property: "priority", before: "low", after: "high", relation_type_key: null, to_id: null, to_type: null }],
      }],
    });
    const undone = await registry.undo("cs-1", allow);
    expect(undone).toMatchObject({ ok: true, changeSet: { undoOf: "cs-1", changes: [{ property: "priority", before: "high", after: "low" }] } });
    expect(patches).toEqual([{ priority: "low" }]);
    expect(rpcCalls.find((c) => c.fn === "apply_task_update_as")?.args.p_actor).toBe("automation:wf");
    expect(recorded()[0].args).toMatchObject({ p_undo_of: "cs-1", p_actor: "automation:wf", p_user: OWNER });
  });

  it("stops an undo when the value changed since", async () => {
    const { registry, patches } = setup({ id: TASK, organization_id: ORG, priority: "critical" }, {
      changeSets: [{
        ...changeSetRow("cs-1", { actor_kind: "automation", actor_id: "wf", action_key: "task.set_priority" }),
        items: [{ position: 0, kind: "update", object_id: TASK, object_type: "task", property: "priority", before: "low", after: "high", relation_type_key: null, to_id: null, to_type: null }],
      }],
    });
    expect(await registry.undo("cs-1", allow)).toMatchObject({ ok: false, reason: "failed", message: `conflict:${TASK}:priority` });
    expect(patches).toEqual([]);
  });

  it("fails rather than record an automation's change set without the person it acts as", async () => {
    const { db } = fakeDb({
      table: () => ({ data: { id: TASK, organization_id: ORG, priority: "low" }, error: null }),
      rpc: ({ fn }) => ({ data: fn === "apply_task_update_as" ? TASK : 3, error: null }),
    });
    const registry = createWorkflowActionRegistry({ db, organizationId: ORG, workflowId: "wf", runId: "run", runAs: { userId: null, assurance: "aal2" } });
    const result = await registry.run("task.set_priority", { taskId: TASK, priority: "high" }, allow);
    expect(result).toMatchObject({ ok: false, reason: "failed", message: expect.stringContaining("runAs") });
  });
});
