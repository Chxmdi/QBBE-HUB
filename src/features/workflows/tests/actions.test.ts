import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createWorkflowActionRegistry, workflowActionKeys, workflowActionLabels } from "../actions";

const TASK = "11111111-1111-4111-8111-111111111111";
const ORG = "44444444-4444-4444-8444-444444444444";

/** Just enough of the query builder for the task actions. */
function fakeDb(task: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const builder = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: table === "task" ? task : null, error: null }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        if (task) Object.assign(task, patch);
        return { eq: async () => ({ error: null }) };
      },
    };
    return chain;
  };
  return { db: { from: builder } as unknown as SupabaseClient, updates };
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

  it("changes a task and reports the change", async () => {
    const { db, updates } = fakeDb({ id: TASK, organization_id: ORG, priority: "low" });
    const registry = createWorkflowActionRegistry({ db, organizationId: ORG, workflowId: "wf", runId: "run" });
    const result = await registry.run("task.set_priority", { taskId: TASK, priority: "high" }, allow);
    expect(result).toMatchObject({
      ok: true,
      changeSet: { changes: [{ kind: "update", property: "priority", before: "low", after: "high" }] },
    });
    expect(updates).toEqual([{ priority: "high" }]);
  });

  it("is refused when the workflow's owner may not edit the task", async () => {
    const { db, updates } = fakeDb({ id: TASK, organization_id: ORG, status: "ready" });
    const registry = createWorkflowActionRegistry({ db, organizationId: ORG, workflowId: "wf", runId: "run" });
    const result = await registry.run("task.set_status", { taskId: TASK, status: "completed" }, deny);
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(updates).toEqual([]);
  });

  it("refuses a task from another organization and bad input", async () => {
    const { db } = fakeDb({ id: TASK, organization_id: "someone-else", status: "ready" });
    const registry = createWorkflowActionRegistry({ db, organizationId: ORG, workflowId: "wf", runId: "run" });
    expect(await registry.run("task.set_status", { taskId: TASK, status: "completed" }, allow))
      .toMatchObject({ ok: false, reason: "failed", message: "The task does not exist." });
    expect(await registry.run("task.set_status", { taskId: TASK, status: "exploded" }, allow))
      .toMatchObject({ ok: false, reason: "failed" });
    expect(await registry.run("task.nope", {}, allow)).toEqual({ ok: false, reason: "unknown_action" });
  });

  it("sets completed_at with a completed status and records nothing when unchanged", async () => {
    const { db, updates } = fakeDb({ id: TASK, organization_id: ORG, status: "ready" });
    const registry = createWorkflowActionRegistry({ db, organizationId: ORG, workflowId: "wf", runId: "run" });
    await registry.run("task.set_status", { taskId: TASK, status: "completed" }, allow);
    expect(updates[0]).toMatchObject({ status: "completed" });
    expect(typeof updates[0].completed_at).toBe("string");
    const again = await registry.run("task.set_status", { taskId: TASK, status: "completed" }, allow);
    expect(again.ok && again.changeSet.changes).toEqual([]);
  });
});
