import { describe, expect, it } from "vitest";
import type { ObjectEvent } from "@/lib/objects/contracts";
import { fakeDb, changeSetRow } from "@/lib/objects/testing/fake-db";
import { createRunPorts } from "../services/run";

const TASK = "11111111-1111-4111-8111-111111111111";
const ORG = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";
const RULE = "66666666-6666-4666-8666-666666666666";

const rule = {
  id: RULE,
  organization_id: ORG,
  name: "Close it",
  graph: { trigger: { objectTypes: ["task"], verbs: ["updated"] }, steps: [] } as never,
  run_as_user_id: OWNER,
  created_by: OWNER,
};

const event = {
  id: "ev-1",
  organizationId: ORG,
  object: { id: TASK, type: "task" },
  actor: { kind: "person", id: OWNER },
  verb: "updated",
  changes: [],
  summary: "",
} as unknown as ObjectEvent;

describe("workflow run ports", () => {
  it("records an action's change set as the automation and feeds the activity stream", async () => {
    const task = { id: TASK, organization_id: ORG, status: "ready" };
    const { db, rpcCalls, tableCalls } = fakeDb({
      table: (call) => (call.table === "task" ? { data: task, error: null } : { data: null, error: null }),
      rpc: ({ fn, args }) => {
        if (fn === "can_as") return { data: true, error: null };
        if (fn === "object_event_high_water") return { data: 12, error: null };
        if (fn === "apply_task_update_as") {
          Object.assign(task, args.p_patch as Record<string, unknown>);
          return { data: TASK, error: null };
        }
        if (fn === "record_change_set_as") return { data: changeSetRow("cs-9", { actor_kind: "automation", actor_id: RULE }), error: null };
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      },
    });
    const ports = createRunPorts(db, rule, "run-1", { event, test: false });
    const result = await ports.runAction("task.set_status", { taskId: TASK, status: "completed" });
    expect(result).toMatchObject({ ok: true, changeSet: { id: "cs-9" } });

    // The owner's permission at the two-step level, as before.
    expect(rpcCalls.find((c) => c.fn === "can_as")?.args).toMatchObject({ p_user: OWNER, p_object: TASK, p_capability: "edit_content", p_assurance: "aal2" });
    // The write and the change set both name the workflow.
    expect(rpcCalls.find((c) => c.fn === "apply_task_update_as")?.args).toMatchObject({ p_actor: `automation:${RULE}`, p_task: TASK });
    expect(rpcCalls.find((c) => c.fn === "record_change_set_as")?.args).toMatchObject({
      p_actor: `automation:${RULE}`,
      p_user: OWNER,
      p_assurance: "aal2",
      p_since_seq: 12,
      p_action_key: "task.set_status",
    });
    // The activity_event row stays for the feed, the follow fan-out and the trigger stream.
    const feed = tableCalls.find((c) => c.table === "activity_event" && c.action === "insert");
    expect(feed?.payload).toMatchObject({
      organization_id: ORG,
      actor_id: null,
      verb: "updated",
      source_type: "task",
      source_id: TASK,
      summary: 'Workflow "Close it" changed status.',
      metadata: { actor: { kind: "automation", id: RULE }, change_set_id: "cs-9", changes: [{ property: "status", before: "ready", after: "completed" }] },
    });
  });

  it("checks without writing when a step is only checked", async () => {
    const { db, rpcCalls } = fakeDb({ rpc: ({ fn }) => ({ data: fn === "can_as" ? false : null, error: null }) });
    const ports = createRunPorts(db, rule, "run-1", { event, test: true });
    expect(await ports.checkAction("task.set_status", { taskId: TASK, status: "completed" })).toBe("forbidden");
    expect(await ports.checkAction("task.nope", {})).toBe("unknown_action");
    expect(rpcCalls.map((c) => c.fn)).toEqual(["can_as"]);
  });
});
