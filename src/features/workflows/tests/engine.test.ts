import { describe, expect, it, vi } from "vitest";
import type { ActionResult, ObjectEvent } from "@/lib/objects/contracts";
import { MAX_STEPS_PER_RUN, runGraph, type EnginePorts } from "../engine";
import { validateGraph, type WorkflowGraph } from "../graph";
import { eventScope, evaluateCondition, renderTemplate, resolvePath, type RunScope } from "../scope";
import { activityRowToEvent, isAutomationEvent, matchesTrigger } from "../trigger";
import { rulesForEvent } from "../services/event-runner";
import type { GraphRule } from "../services/run";

const TASK = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";

const event: ObjectEvent = {
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: "44444444-4444-4444-8444-444444444444",
  object: { id: TASK, type: "task" },
  actor: { kind: "person", id: PERSON },
  verb: "updated",
  changes: [{ property: "status", before: "in_progress", after: "blocked" }],
  summary: "Task blocked",
  occurredAt: "2026-11-06T12:00:00.000Z",
};

function scope(): RunScope {
  return { event: eventScope(event), steps: {}, workflow: { id: "wf", name: "Blocked tasks" } };
}

const graph: WorkflowGraph = {
  version: 1,
  trigger: { objectTypes: ["task"], verbs: ["updated"], changedProperty: "status" },
  start: "is-blocked",
  steps: [
    {
      id: "is-blocked",
      kind: "condition",
      when: { path: "event.changes.status.after", op: "eq", value: "blocked" },
      next: "raise",
    },
    {
      id: "raise",
      kind: "action",
      action: "task.set_priority",
      input: { taskId: "{{event.object.id}}", priority: "high" },
      next: null,
    },
  ],
};

function ports(result: ActionResult = {
  ok: true,
  changeSet: { id: "cs", actionKey: "task.set_priority", actor: { kind: "automation", id: "wf" }, createdAt: "", changes: [], undoOf: null },
}): EnginePorts & { runAction: ReturnType<typeof vi.fn>; checkAction: ReturnType<typeof vi.fn> } {
  return {
    runAction: vi.fn(async () => result),
    checkAction: vi.fn(async () => "ok" as const),
  };
}

describe("validateGraph", () => {
  it("accepts a well-formed graph", () => {
    expect(validateGraph(graph)).toEqual({ ok: true, graph });
  });

  it("rejects duplicate ids, missing targets, an unknown start and unreachable steps", () => {
    const duplicate = validateGraph({ ...graph, steps: [graph.steps[0], { ...graph.steps[0] }] });
    expect(duplicate.ok || duplicate.issues.map((issue) => issue.code)).toContain("duplicate_step");

    const missing = validateGraph({ ...graph, steps: [graph.steps[0]] });
    expect(missing.ok || missing.issues.map((issue) => issue.code)).toContain("unknown_next");

    const start = validateGraph({ ...graph, start: "nowhere" });
    expect(start.ok || start.issues.map((issue) => issue.code)).toContain("unknown_start");

    const unreachable = validateGraph({ ...graph, start: "raise" });
    expect(unreachable.ok || unreachable.issues.map((issue) => issue.code)).toContain("unreachable");
  });

  it("rejects a cycle", () => {
    const looped = validateGraph({
      ...graph,
      steps: [graph.steps[0], { ...graph.steps[1], next: "is-blocked" }],
    });
    expect(looped.ok || looped.issues.map((issue) => issue.code)).toContain("cycle");
  });

  it("rejects an action the registry does not have, when told the registry", () => {
    const result = validateGraph(graph, new Set(["task.set_status"]));
    expect(result.ok || result.issues.map((issue) => issue.code)).toEqual(["unknown_action"]);
  });

  it("rejects malformed input with a path to the problem", () => {
    const result = validateGraph({ version: 1, trigger: {}, start: null, steps: [{ id: "Bad Id", kind: "action" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe("invalid");
  });
});

describe("scope", () => {
  it("resolves paths into the event, steps and arrays", () => {
    const s = scope();
    s.steps.lookup = { people: [{ id: PERSON }] };
    expect(resolvePath(s, "event.changes.status.after")).toBe("blocked");
    expect(resolvePath(s, "steps.lookup.people.0.id")).toBe(PERSON);
    expect(resolvePath(s, "event.nothing.here")).toBeUndefined();
    expect(resolvePath(s, "event.constructor")).toBeUndefined();
  });

  it("evaluates every operator", () => {
    const s = scope();
    const at = (op: Parameters<typeof evaluateCondition>[0]) => evaluateCondition(op, s);
    expect(at({ path: "event.verb", op: "eq", value: "updated" })).toBe(true);
    expect(at({ path: "event.verb", op: "neq", value: "updated" })).toBe(false);
    expect(at({ path: "event.changes.status.after", op: "in", value: ["blocked", "waiting"] })).toBe(true);
    expect(at({ path: "event.summary", op: "contains", value: "BLOCK" })).toBe(true);
    expect(at({ path: "event.changes.priority", op: "is_empty" })).toBe(true);
    expect(at({ path: "event.changes.status", op: "is_not_empty" })).toBe(true);
    expect(at({ path: "event.occurredAt", op: "gt", value: "2026-01-01" })).toBe(true);
    expect(at({ path: "event.occurredAt", op: "lt", value: "2026-01-01" })).toBe(false);
    expect(at({ and: [{ path: "event.verb", op: "eq", value: "updated" }, { path: "event.object.type", op: "eq", value: "project" }] })).toBe(false);
    expect(at({ or: [{ path: "event.verb", op: "eq", value: "created" }, { path: "event.object.type", op: "eq", value: "task" }] })).toBe(true);
  });

  it("compares numbers stored as text", () => {
    const s = scope();
    s.steps.count = { value: "5" };
    expect(evaluateCondition({ path: "steps.count.value", op: "eq", value: 5 }, s)).toBe(true);
    expect(evaluateCondition({ path: "steps.count.value", op: "gte", value: 6 }, s)).toBe(false);
  });

  it("fills templates, keeping a whole placeholder's type", () => {
    const s = scope();
    s.steps.n = { value: 3 };
    expect(renderTemplate({ id: "{{event.object.id}}", n: "{{steps.n.value}}", text: "Task {{event.object.id}}!", none: "{{missing}}" }, s))
      .toEqual({ id: TASK, n: 3, text: `Task ${TASK}!`, none: null });
  });
});

describe("runGraph", () => {
  it("runs the trigger, condition and action and records each step", async () => {
    const p = ports();
    const result = await runGraph(graph, scope(), p);
    expect(result.outcome).toBe("succeeded");
    expect(result.steps.map((step) => [step.stepId, step.kind, step.status])).toEqual([
      ["trigger", "trigger", "succeeded"],
      ["is-blocked", "condition", "succeeded"],
      ["raise", "action", "succeeded"],
    ]);
    expect(p.runAction).toHaveBeenCalledWith("task.set_priority", { taskId: TASK, priority: "high" });
    expect(result.steps[2].input).toEqual({ taskId: TASK, priority: "high" });
    expect(result.steps.every((step, index) => step.position === index)).toBe(true);
  });

  it("ends as skipped when a condition does not hold, without running the action", async () => {
    const p = ports();
    const s = scope();
    s.event.changes.status.after = "completed";
    const result = await runGraph(graph, s, p);
    expect(result.outcome).toBe("skipped");
    expect(result.steps.at(-1)?.output).toEqual({ matched: false });
    expect(p.runAction).not.toHaveBeenCalled();
  });

  it("records a refused action as a failed step with the reason", async () => {
    const result = await runGraph(graph, scope(), ports({ ok: false, reason: "forbidden" }));
    expect(result.outcome).toBe("failed");
    expect(result.steps.at(-1)?.status).toBe("failed");
    expect(result.error).toMatch(/^forbidden/);
  });

  it("turns a thrown action into a failed step", async () => {
    const p = ports();
    p.runAction.mockRejectedValueOnce(new Error("database down"));
    const result = await runGraph(graph, scope(), p);
    expect(result.outcome).toBe("failed");
    expect(result.error).toBe("failed: database down");
  });

  it("checks but never runs actions in a test run", async () => {
    const p = ports();
    const result = await runGraph(graph, scope(), p, { dryRun: true });
    expect(result.outcome).toBe("succeeded");
    expect(p.runAction).not.toHaveBeenCalled();
    expect(p.checkAction).toHaveBeenCalledOnce();
    expect(result.steps.at(-1)?.output).toMatchObject({ dryRun: true, check: "ok" });

    p.checkAction.mockResolvedValueOnce("forbidden");
    const refused = await runGraph(graph, scope(), p, { dryRun: true });
    expect(refused.outcome).toBe("failed");
    expect(refused.error).toMatch(/^forbidden/);
  });

  it("stops at the step limit", async () => {
    const chain: WorkflowGraph = {
      ...graph,
      start: "s0",
      steps: Array.from({ length: 5 }, (_, index) => ({
        id: `s${index}`,
        kind: "condition" as const,
        when: { path: "event.verb", op: "eq" as const, value: "updated" },
        next: index < 4 ? `s${index + 1}` : null,
      })),
    };
    const result = await runGraph(chain, scope(), ports(), { maxSteps: 3 });
    expect(result.outcome).toBe("failed");
    expect(result.error).toMatch(/^step_limit/);
    expect(result.steps).toHaveLength(4);
    expect(MAX_STEPS_PER_RUN).toBeGreaterThanOrEqual(3);
  });

  it("finishes at once when there are no steps", async () => {
    const result = await runGraph({ ...graph, start: null, steps: [] }, scope(), ports());
    expect(result).toMatchObject({ outcome: "succeeded", error: null });
    expect(result.steps).toHaveLength(1);
  });
});

describe("triggers and the event source", () => {
  it("matches on type, verb and changed property", () => {
    expect(matchesTrigger(graph.trigger, event)).toBe(true);
    expect(matchesTrigger({ ...graph.trigger, objectTypes: ["project"] }, event)).toBe(false);
    expect(matchesTrigger({ ...graph.trigger, verbs: ["created"] }, event)).toBe(false);
    expect(matchesTrigger({ ...graph.trigger, changedProperty: "priority" }, event)).toBe(false);
    expect(matchesTrigger({ objectTypes: [], verbs: [] }, event)).toBe(true);
  });

  it("reads an activity row as an object event", () => {
    const converted = activityRowToEvent({
      id: event.id,
      organization_id: event.organizationId,
      actor_id: PERSON,
      verb: "completed",
      source_type: "task",
      source_id: TASK,
      project_id: null,
      program_id: null,
      summary: "Done",
      metadata: { status: "completed", from: "in_progress" },
      created_at: event.occurredAt,
    });
    expect(converted).toMatchObject({
      verb: "updated",
      actor: { kind: "person", id: PERSON },
      changes: [{ property: "status", before: "in_progress", after: "completed" }],
    });
  });

  it("keeps the event stub's actor and changes, and drops unknown verbs", () => {
    const base = {
      id: event.id, organization_id: event.organizationId, actor_id: null, source_type: "task",
      source_id: TASK, project_id: null, program_id: null, summary: "", created_at: event.occurredAt,
    };
    const automated = activityRowToEvent({
      ...base,
      verb: "updated",
      metadata: { actor: { kind: "automation", id: "wf" }, changes: [{ property: "priority", before: "low", after: "high" }] },
    });
    expect(automated && isAutomationEvent(automated)).toBe(true);
    expect(automated?.changes).toEqual([{ property: "priority", before: "low", after: "high" }]);
    expect(activityRowToEvent({ ...base, verb: "exploded", metadata: {} })).toBeNull();
  });

  it("never lets a workflow's own change start a workflow", () => {
    const rule: GraphRule = {
      id: "wf", organization_id: event.organizationId, name: "r", graph, run_as_user_id: PERSON, created_by: PERSON,
    };
    expect(rulesForEvent([rule], event)).toEqual([rule]);
    expect(rulesForEvent([rule], { ...event, actor: { kind: "automation", id: "other" } })).toEqual([]);
    expect(rulesForEvent([{ ...rule, organization_id: "other-org" }], event)).toEqual([]);
  });
});
