import { describe, expect, it } from "vitest";
import { workflowActionKeys } from "../actions-catalog";
import {
  actionFields,
  defaultActionFields,
  editorToGraph,
  emptyEditorState,
  graphToEditor,
  THIS_ITEM,
  type EditorState,
} from "../editor-model";
import { validateGraph } from "../graph";
import { workflowsEn } from "../i18n/workflows.en";
import { workflowsFrCA } from "../i18n/workflows.fr-CA";

const state: EditorState = {
  ...emptyEditorState(),
  name: "Blocked tasks get attention",
  steps: [
    { kind: "condition", path: "event.changes.status.after", op: "in", value: "blocked, waiting" },
    { kind: "action", action: "task.set_priority", fields: { taskId: THIS_ITEM, priority: "high" } },
    { kind: "action", action: "task.assign", fields: { taskId: THIS_ITEM, assigneeId: "" } },
  ],
};

describe("editor model", () => {
  it("turns the list into a valid graph run top to bottom", () => {
    const graph = editorToGraph(state);
    expect(validateGraph(graph, new Set(workflowActionKeys)).ok).toBe(true);
    expect(graph.start).toBe("step-1");
    expect(graph.steps.map((step) => [step.id, step.next])).toEqual([
      ["step-1", "step-2"],
      ["step-2", "step-3"],
      ["step-3", null],
    ]);
    expect(graph.steps[0]).toMatchObject({ when: { op: "in", value: ["blocked", "waiting"] } });
    expect(graph.steps[2]).toMatchObject({ input: { taskId: THIS_ITEM, assigneeId: null } });
    expect(graph.trigger).toEqual({ objectTypes: ["task"], verbs: ["updated"], changedProperty: "status" });
  });

  it("round-trips through a stored graph", () => {
    const back = graphToEditor(editorToGraph(state), { name: state.name, description: null, enabled: true });
    expect(back?.steps).toEqual([
      { kind: "condition", path: "event.changes.status.after", op: "in", value: "blocked, waiting" },
      { kind: "action", action: "task.set_priority", fields: { taskId: THIS_ITEM, priority: "high" } },
      { kind: "action", action: "task.assign", fields: { taskId: THIS_ITEM, assigneeId: "" } },
    ]);
  });

  it("drops the value for empty tests and accepts no steps", () => {
    const graph = editorToGraph({ ...state, steps: [{ kind: "condition", path: "event.summary", op: "is_empty", value: "x" }] });
    expect(graph.steps[0]).toMatchObject({ when: { path: "event.summary", op: "is_empty" } });
    expect("value" in (graph.steps[0] as { when: object }).when).toBe(false);
    expect(editorToGraph(emptyEditorState())).toMatchObject({ start: null, steps: [] });
  });

  it("refuses to show a graph the list editor cannot represent", () => {
    const graph = editorToGraph(state);
    const nested = { ...graph, steps: [{ ...graph.steps[0], when: { and: [{ path: "a", op: "eq" as const, value: 1 }] } }, ...graph.steps.slice(1)] };
    expect(graphToEditor(nested, { name: "", description: null, enabled: true })).toBeNull();
  });

  it("offers defaults for every action field", () => {
    for (const key of workflowActionKeys) {
      expect(Object.keys(defaultActionFields(key))).toEqual(actionFields[key].map((field) => field.key));
    }
  });
});

describe("dictionaries", () => {
  function leaves(value: unknown, prefix = ""): string[] {
    if (typeof value === "string") return [prefix];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leaves(child, prefix ? `${prefix}.${key}` : key));
  }

  it("has every English string in French, filled in", () => {
    expect(leaves(workflowsFrCA).sort()).toEqual(leaves(workflowsEn).sort());
    const values = (value: unknown): string[] =>
      typeof value === "string" ? [value] : Object.values(value as Record<string, unknown>).flatMap(values);
    for (const text of values(workflowsFrCA)) expect(text.trim()).not.toBe("");
  });

  it("labels every action in both languages", () => {
    for (const key of workflowActionKeys) {
      expect(workflowsEn.actions[key]).toBeTruthy();
      expect(workflowsFrCA.actions[key]).toBeTruthy();
    }
  });
});
