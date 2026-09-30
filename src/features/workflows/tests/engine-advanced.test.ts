import { describe, expect, it, vi } from "vitest";
import type { ActionResult, ObjectEvent } from "@/lib/objects/contracts";
import { runGraph, type EnginePorts } from "../engine";
import { MAX_LOOP_ITERATIONS, validateGraph, type WorkflowGraph } from "../graph";
import { eventScope, type RunScope } from "../scope";

const TASK = "11111111-1111-4111-8111-111111111111";
const SUB = "55555555-5555-4555-8555-555555555555";

const event: ObjectEvent = {
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: "44444444-4444-4444-8444-444444444444",
  object: { id: TASK, type: "task" },
  actor: { kind: "person", id: "22222222-2222-4222-8222-222222222222" },
  verb: "updated",
  changes: [{ property: "status", before: "in_progress", after: "blocked" }],
  summary: "",
  occurredAt: "2026-11-06T12:00:00.000Z",
};

const scope = (): RunScope => ({ event: eventScope(event), steps: {}, workflow: { id: "wf", name: "wf" } });
const ok: ActionResult = {
  ok: true,
  changeSet: { id: "cs", actionKey: "a", actor: { kind: "automation", id: "wf" }, createdAt: "", changes: [], undoOf: null },
};
const ports = () => ({
  runAction: vi.fn<EnginePorts["runAction"]>(async () => ok),
  checkAction: vi.fn<EnginePorts["checkAction"]>(async () => "ok"),
  runSubworkflow: vi.fn<NonNullable<EnginePorts["runSubworkflow"]>>(async () =>
    ({ outcome: "succeeded", runNumber: 7, error: null })),
}) satisfies EnginePorts;
const trigger = { objectTypes: [], verbs: [] };
const now = () => new Date("2026-11-06T12:00:00.000Z");

describe("branches", () => {
  const graph: WorkflowGraph = {
    version: 1,
    trigger,
    start: "is-blocked",
    steps: [
      { id: "is-blocked", kind: "branch", when: { path: "event.changes.status.after", op: "eq", value: "blocked" }, then: "raise", else: "lower" },
      { id: "raise", kind: "action", action: "task.set_priority", input: { priority: "high" }, next: null },
      { id: "lower", kind: "action", action: "task.set_priority", input: { priority: "low" }, next: null },
    ],
  };

  it("validates, and takes the matching path only", async () => {
    expect(validateGraph(graph).ok).toBe(true);
    const p = ports();
    const result = await runGraph(graph, scope(), p);
    expect(result.outcome).toBe("succeeded");
    expect(result.steps.map((step) => step.stepId)).toEqual(["trigger", "is-blocked", "raise"]);
    expect(result.steps[1].output).toEqual({ matched: true, next: "raise" });

    const s = scope();
    s.event.changes.status.after = "ready";
    const other = await runGraph(graph, s, p);
    expect(other.steps.map((step) => step.stepId)).toEqual(["trigger", "is-blocked", "lower"]);
  });
});

describe("loops", () => {
  const graph = (items = "steps.people"): WorkflowGraph => ({
    version: 1,
    trigger,
    start: "each",
    steps: [
      { id: "each", kind: "loop", items, body: "only-bob", next: "done" },
      { id: "only-bob", kind: "condition", when: { path: "loop.item", op: "neq", value: "bob" }, next: "notify" },
      { id: "notify", kind: "action", action: "notification.send", input: { userId: "{{loop.item}}", title: "#{{loop.index}}" }, next: null },
      { id: "done", kind: "action", action: "task.set_status", input: {}, next: null },
    ],
  });

  it("runs the body per item, a false condition skipping only that item", async () => {
    expect(validateGraph(graph()).ok).toBe(true);
    const p = ports();
    const result = await runGraph(graph(), scope(), p, {
      state: { steps: { people: ["ann", "bob", "cy"] }, stepsTaken: 0, depth: 0 },
    });
    expect(result.outcome).toBe("succeeded");
    const notified = p.runAction.mock.calls.filter(([key]) => key === "notification.send").map(([, input]) => input);
    expect(notified).toEqual([{ userId: "ann", title: "#0" }, { userId: "cy", title: "#2" }]);
    expect(p.runAction).toHaveBeenLastCalledWith("task.set_status", {});
    expect(result.state.steps.each).toEqual({ iterations: 3 });
  });

  it("refuses more items than the hard cap", async () => {
    const people = Array.from({ length: MAX_LOOP_ITERATIONS + 1 }, (_, index) => `p${index}`);
    const p = ports();
    const result = await runGraph(graph(), scope(), p, { state: { steps: { people }, stepsTaken: 0, depth: 0 } });
    expect(result.outcome).toBe("failed");
    expect(result.error).toMatch(/^loop_limit/);
    expect(p.runAction).not.toHaveBeenCalled();
  });

  it("treats a missing list as empty", async () => {
    const result = await runGraph(graph("steps.nothing"), scope(), ports());
    expect(result.outcome).toBe("succeeded");
  });

  it("rejects bodies that pause, nest, or are jumped into", () => {
    const withSub = graph();
    withSub.steps[2] = { id: "notify", kind: "subworkflow", workflowId: SUB, next: null };
    const nested = validateGraph(withSub);
    expect(nested.ok || nested.issues.map((issue) => issue.code)).toContain("loop_body");

    const jump: WorkflowGraph = { ...graph(), steps: [...graph().steps.slice(0, 3), { id: "done", kind: "action", action: "a", input: {}, next: "notify" }] };
    const jumped = validateGraph(jump);
    expect(jumped.ok || jumped.issues.map((issue) => issue.code)).toContain("loop_body");
  });

  it("counts body steps against the step limit", async () => {
    const result = await runGraph(graph(), scope(), ports(), {
      maxSteps: 4,
      state: { steps: { people: ["a", "b", "c"] }, stepsTaken: 0, depth: 0 },
    });
    expect(result.error).toMatch(/^step_limit/);
  });
});

describe("retries with backoff and resuming", () => {
  const graph: WorkflowGraph = {
    version: 1,
    trigger,
    start: "call",
    steps: [
      { id: "call", kind: "action", action: "task.set_status", input: {}, retry: { attempts: 3, backoffSeconds: 60 }, next: "after" },
      { id: "after", kind: "action", action: "task.set_priority", input: {}, next: null },
    ],
  };

  it("pauses after a failure with the next attempt and a doubling backoff", async () => {
    const p = ports();
    p.runAction.mockResolvedValueOnce({ ok: false, reason: "failed", message: "busy" });
    const first = await runGraph(graph, scope(), p, { now });
    expect(first.outcome).toBe("waiting");
    expect(first.resume).toEqual({ stepId: "call", attempt: 2, at: "2026-11-06T12:01:00.000Z", reason: "retry" });
    expect(first.steps.at(-1)).toMatchObject({ status: "failed", attempt: 1, error: "failed: busy" });

    // Resumed at attempt 2, which fails again: the wait doubles.
    p.runAction.mockResolvedValueOnce({ ok: false, reason: "failed", message: "busy" });
    const second = await runGraph(graph, scope(), p, {
      now, startAt: first.resume!, state: first.state, positionOffset: first.steps.length,
    });
    expect(second.resume).toMatchObject({ attempt: 3, at: "2026-11-06T12:02:00.000Z" });
    expect(second.steps[0]).toMatchObject({ position: 2, stepId: "call", attempt: 2 });

    // Attempt 3 succeeds and the run carries on, with no second trigger step.
    const third = await runGraph(graph, scope(), p, {
      now, startAt: second.resume!, state: second.state, positionOffset: 3,
    });
    expect(third.outcome).toBe("succeeded");
    expect(third.steps.map((step) => [step.stepId, step.attempt])).toEqual([["call", 3], ["after", 1]]);
  });

  it("fails for good after the last attempt", async () => {
    const p = ports();
    p.runAction.mockResolvedValue({ ok: false, reason: "failed", message: "down" });
    const last = await runGraph(graph, scope(), p, { startAt: { stepId: "call", attempt: 3 } });
    expect(last).toMatchObject({ outcome: "failed", resume: null, error: "failed: down" });
  });

  it("never retries a refusal-free test run by waiting", async () => {
    const p = ports();
    p.checkAction.mockResolvedValueOnce("forbidden");
    const result = await runGraph(graph, scope(), p, { dryRun: true });
    expect(result.outcome).toBe("failed");
    expect(result.resume).toBeNull();
  });

  it("carries the step count across resumptions", async () => {
    const result = await runGraph(graph, scope(), ports(), {
      startAt: { stepId: "call", attempt: 1 },
      state: { steps: {}, stepsTaken: 100, depth: 0 },
    });
    expect(result.error).toMatch(/^step_limit/);
  });
});

describe("sub-workflows", () => {
  const graph: WorkflowGraph = {
    version: 1,
    trigger,
    start: "sub",
    steps: [{ id: "sub", kind: "subworkflow", workflowId: SUB, next: null }],
  };

  it("runs the other workflow one level deeper and keeps its outcome", async () => {
    const p = ports();
    const result = await runGraph(graph, scope(), p);
    expect(p.runSubworkflow).toHaveBeenCalledWith(SUB, 1);
    expect(result.steps.at(-1)?.output).toEqual({ outcome: "succeeded", runNumber: 7, error: null });
  });

  it("fails when the other workflow fails, and past the depth limit", async () => {
    const p = ports();
    p.runSubworkflow.mockResolvedValueOnce({ outcome: "failed", runNumber: 8, error: "failed: boom" });
    expect((await runGraph(graph, scope(), p)).error).toBe("failed: boom");
    const deep = await runGraph(graph, scope(), p, { state: { steps: {}, stepsTaken: 0, depth: 3 } });
    expect(deep.error).toMatch(/^depth_limit/);
  });

  it("does not start other workflows in a test run", async () => {
    const p = ports();
    const result = await runGraph(graph, scope(), p, { dryRun: true });
    expect(result.outcome).toBe("succeeded");
    expect(p.runSubworkflow).not.toHaveBeenCalled();
  });
});
