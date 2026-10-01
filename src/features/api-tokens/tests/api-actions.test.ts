import { describe, expect, it } from "vitest";
import { fakeDb, changeSetRow } from "@/lib/objects/testing/fake-db";
import { runAction } from "../services/actions";
import type { ApiIdentity } from "../services/api-handler";

const TASK = "11111111-1111-4111-8111-111111111111";
const ORG = "44444444-4444-4444-8444-444444444444";
const PERSON = "55555555-5555-4555-8555-555555555555";

const identity = { tokenId: "tok-1", userId: PERSON, organizationId: ORG, scopes: ["actions:run"] } as unknown as ApiIdentity;

describe("API actions", () => {
  it("runs the action as the integration, records its change set for the token's person and feeds the stream", async () => {
    const task = { id: TASK, organization_id: ORG, priority: "low" };
    const { db, rpcCalls, tableCalls } = fakeDb({
      table: (call) => (call.table === "task" ? { data: task, error: null } : { data: null, error: null }),
      rpc: ({ fn, args }) => {
        if (fn === "can_as") return { data: true, error: null };
        if (fn === "object_event_high_water") return { data: 3, error: null };
        if (fn === "apply_task_update_as") {
          Object.assign(task, args.p_patch as Record<string, unknown>);
          return { data: TASK, error: null };
        }
        if (fn === "record_change_set_as") return { data: changeSetRow("cs-4", { actor_kind: "integration", actor_id: "api:tok-1" }), error: null };
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      },
    });
    const request = new Request("https://hub.test/api/v1/actions/task.set_priority", {
      method: "POST",
      body: JSON.stringify({ input: { taskId: TASK, priority: "high" } }),
    });
    const response = await runAction(db, identity, "task.set_priority", request);
    expect(response).toEqual({
      data: {
        changeSetId: "cs-4",
        changes: [{ kind: "update", object: { id: TASK, type: "task" }, property: "priority", before: "low", after: "high" }],
      },
    });
    expect(rpcCalls.find((c) => c.fn === "can_as")?.args).toMatchObject({ p_user: PERSON, p_object: TASK, p_assurance: "aal1" });
    expect(rpcCalls.find((c) => c.fn === "apply_task_update_as")?.args).toMatchObject({ p_actor: "integration:api:tok-1", p_task: TASK, p_patch: { priority: "high" } });
    expect(rpcCalls.find((c) => c.fn === "record_change_set_as")?.args).toMatchObject({
      p_actor: "integration:api:tok-1",
      p_user: PERSON,
      p_assurance: "aal1",
      p_since_seq: 3,
    });
    const feed = tableCalls.find((c) => c.table === "activity_event" && c.action === "insert");
    expect(feed?.payload).toMatchObject({
      actor_id: null,
      source_id: TASK,
      summary: "Changed priority through the API.",
      metadata: { actor: { kind: "integration", id: "api:tok-1" }, change_set_id: "cs-4" },
    });
  });

  it("answers 403 when the token's person may not edit the task, writing nothing", async () => {
    const { db, rpcCalls, tableCalls } = fakeDb({
      table: () => ({ data: { id: TASK, organization_id: ORG, priority: "low" }, error: null }),
      rpc: ({ fn }) => ({ data: fn === "can_as" ? false : null, error: null }),
    });
    const request = new Request("https://hub.test/api/v1/actions/task.set_priority", {
      method: "POST",
      body: JSON.stringify({ input: { taskId: TASK, priority: "high" } }),
    });
    await expect(runAction(db, identity, "task.set_priority", request)).rejects.toMatchObject({ status: 403 });
    expect(rpcCalls.map((c) => c.fn)).toEqual(["can_as"]);
    expect(tableCalls.filter((c) => c.action !== "select")).toEqual([]);
  });
});
