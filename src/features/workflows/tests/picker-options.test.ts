import { describe, expect, it } from "vitest";
import type { LensCatalog } from "@/lib/query/catalog";
import { conditionOperators } from "../graph";
import {
  changedPropertyOptions,
  eventOptions,
  findPropertyOption,
  operatorsForKind,
  propertyOptions,
} from "../picker-options";
import { describeTestStep, printValue } from "../test-run-detail";
import { activityVerbsFor } from "../trigger";
import { conditionValues, eventScope } from "../scope";

const catalog: LensCatalog = {
  task: {
    key: "task",
    name: { en: "Task", fr: "Tâche" },
    properties: [
      { key: "status", kind: "select", propertyKind: "status", name: { en: "Status", fr: "Statut" }, sortable: true, groupable: true,
        choices: [{ key: "blocked", label: { en: "Blocked", fr: "Bloquée" } }] },
      { key: "assignee", kind: "person", propertyKind: "person", name: { en: "Assignee", fr: "Responsable" }, sortable: false, groupable: true },
      { key: "due", kind: "date", propertyKind: "date", name: { en: "Due", fr: "Échéance" }, sortable: true, groupable: false },
    ],
  },
  project: {
    key: "project",
    name: { en: "Project", fr: "Projet" },
    properties: [
      { key: "status", kind: "select", propertyKind: "status", name: { en: "Status", fr: "Statut" }, sortable: true, groupable: true },
      { key: "budget", kind: "number", propertyKind: "number", name: { en: "Budget", fr: "Budget" }, sortable: true, groupable: false },
    ],
  },
};

describe("property options", () => {
  it("lists the trigger type's paths grouped by kind, event facts first", () => {
    const groups = propertyOptions(catalog, ["task"], "en");
    expect(groups.map((group) => group.kind)).toEqual(["event", "select", "person", "date"]);
    expect(groups[1].options.map((option) => option.path)).toEqual([
      "event.changes.status.after",
      "event.changes.status.before",
    ]);
    expect(groups[1].options[0]).toMatchObject({ name: "Status", side: "after", choices: [{ key: "blocked", label: "Blocked" }] });
    expect(findPropertyOption(groups, "event.changes.budget.after")).toBeNull();
  });

  it("speaks French and lists every type once per key when no type is chosen", () => {
    const groups = propertyOptions(catalog, [], "fr-CA");
    const paths = groups.flatMap((group) => group.options.map((option) => option.path));
    expect(paths.filter((path) => path === "event.changes.status.after")).toHaveLength(1);
    expect(paths).toContain("event.changes.budget.after");
    expect(findPropertyOption(groups, "event.changes.status.after")?.choices[0].label).toBe("Bloquée");
  });

  it("offers the trigger's property keys", () => {
    expect(changedPropertyOptions(catalog, ["task"], "en").map((option) => option.key)).toEqual(["status", "assignee", "due"]);
  });
});

describe("operators by kind", () => {
  it("maps the lens operators to ones the engine runs", () => {
    expect(operatorsForKind("select")).toEqual(["eq", "neq", "in", "is_empty", "is_not_empty"]);
    expect(operatorsForKind("number")).toEqual(["eq", "neq", "lt", "lte", "gt", "gte", "is_empty", "is_not_empty"]);
    expect(operatorsForKind("date")).toEqual(["eq", "lt", "gt", "lte", "gte", "is_empty", "is_not_empty"]);
    expect(operatorsForKind("person")).toEqual(["neq", "eq", "contains", "is_empty", "is_not_empty"]);
    expect(operatorsForKind(null)).toEqual(conditionOperators);
    expect(operatorsForKind("event")).toEqual(conditionOperators);
  });

  it("only ever offers operators the engine knows", () => {
    for (const kind of ["text", "number", "date", "select", "multi_select", "person", "checkbox", "relation"] as const) {
      for (const op of operatorsForKind(kind)) expect(conditionOperators).toContain(op);
      expect(operatorsForKind(kind).length).toBeGreaterThan(0);
    }
  });
});

describe("example events", () => {
  it("describes each event with what changed", () => {
    const options = eventOptions([{
      id: "e1", verb: "updated", objectType: "task", objectId: "t1", summary: "Task blocked",
      occurredAt: "2026-10-01T10:00:00Z", changes: [{ property: "status", before: "in_progress", after: "blocked" }],
    }], { dateTime: () => "Oct 1", verb: (verb) => verb.toUpperCase() });
    expect(options[0]).toMatchObject({ id: "e1", label: "Task blocked", description: "UPDATED · Oct 1 · status: in_progress → blocked" });
  });

  it("reads back the raw verbs that become a contract verb", () => {
    expect(activityVerbsFor(["updated"]).sort()).toEqual(["assigned", "completed", "health_changed", "published", "status_changed", "updated"]);
    expect(activityVerbsFor(["deleted"]).sort()).toEqual(["deleted", "removed"]);
  });
});

describe("test run detail", () => {
  const scope = {
    event: eventScope({
      id: "e", organizationId: "o", object: { id: "t", type: "task" }, actor: { kind: "person", id: "u" },
      verb: "updated", changes: [{ property: "status", before: "in_progress", after: "blocked" }], summary: "s", occurredAt: "2026-10-01T00:00:00Z",
    }),
    steps: {},
    workflow: { id: "w", name: "w" },
  };

  it("resolves every path of a condition", () => {
    expect(conditionValues({ or: [
      { path: "event.changes.status.after", op: "eq", value: "blocked" },
      { path: "event.changes.missing.after", op: "is_empty" },
    ] }, scope)).toEqual({ "event.changes.status.after": "blocked", "event.changes.missing.after": null });
  });

  it("puts each test next to the value it saw", () => {
    const detail = describeTestStep({
      stepId: "c", kind: "condition", status: "succeeded", error: null,
      input: { and: [{ path: "event.changes.status.after", op: "eq", value: "blocked" }, { path: "event.summary", op: "is_not_empty" }] },
      output: { matched: true, values: { "event.changes.status.after": "blocked", "event.summary": "s" } },
    });
    expect(detail).toEqual({
      kind: "condition", matched: true, match: "all", next: undefined,
      tests: [
        { path: "event.changes.status.after", op: "eq", value: "blocked", actual: "blocked" },
        { path: "event.summary", op: "is_not_empty", value: null, actual: "s" },
      ],
    });
  });

  it("describes the trigger, an action, a branch and outbound steps", () => {
    expect(describeTestStep({ stepId: "trigger", kind: "trigger", status: "succeeded", error: null, input: null, output: scope.event }))
      .toEqual({ kind: "trigger", verb: "updated", objectType: "task", objectId: "t", changes: [{ property: "status", before: "in_progress", after: "blocked" }] });
    expect(describeTestStep({ stepId: "a", kind: "action", status: "failed", error: "forbidden: x",
      input: { taskId: "t", priority: "high" }, output: { dryRun: true, action: "task.set_priority", check: "forbidden" } }))
      .toEqual({ kind: "action", action: "task.set_priority", input: { taskId: "t", priority: "high" }, check: "forbidden" });
    expect(describeTestStep({ stepId: "b", kind: "branch", status: "succeeded", error: null,
      input: { path: "x", op: "eq", value: 1 }, output: { matched: false, next: null, values: { x: 2 } } }))
      .toMatchObject({ kind: "branch", matched: false, next: null, tests: [{ actual: 2 }] });
    expect(describeTestStep({ stepId: "w", kind: "webhook", status: "succeeded", error: null, input: { url: "https://x", body: { a: 1 } }, output: {} }))
      .toEqual({ kind: "webhook", url: "https://x", body: { a: 1 } });
    expect(describeTestStep({ stepId: "e", kind: "email", status: "succeeded", error: null, input: { to: "a", subject: "b", body: "c" }, output: {} }))
      .toEqual({ kind: "email", to: "a", subject: "b", body: "c" });
  });

  it("prints values plainly", () => {
    expect(printValue(null)).toBe("—");
    expect(printValue(["a", 1])).toBe("a, 1");
    expect(printValue({ a: 1 })).toBe('{"a":1}');
  });
});
