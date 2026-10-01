import { describe, expect, it } from "vitest";
import { workflowActionKeys } from "../actions-catalog";
import {
  actionFields,
  defaultActionFields,
  editorIssues,
  editorStepKinds,
  editorToGraph,
  emptyEditorState,
  END,
  FOLLOWING,
  graphToEditor,
  newStep,
  newStepId,
  removeStep,
  THIS_ITEM,
  typedScalar,
  type EditorState,
  type EditorStep,
} from "../editor-model";
import { validateGraph, type WorkflowGraph } from "../graph";
import { workflowsEn } from "../i18n/workflows.en";
import { workflowsFrCA } from "../i18n/workflows.fr-CA";

const meta = { name: "x", description: null, enabled: true };
const known = new Set(workflowActionKeys);

const state: EditorState = {
  ...emptyEditorState(),
  name: "Blocked tasks get attention",
  steps: [
    { id: "step-1", label: "", kind: "condition", when: { match: "all", tests: [{ path: "event.changes.status.after", op: "in", value: "blocked, waiting" }] }, next: FOLLOWING },
    { id: "step-2", label: "", kind: "action", action: "task.set_priority", fields: { taskId: THIS_ITEM, priority: "high" }, retry: null, next: FOLLOWING },
    { id: "step-3", label: "", kind: "action", action: "task.assign", fields: { taskId: THIS_ITEM, assigneeId: "" }, retry: null, next: FOLLOWING },
  ],
};

/** A graph that uses every step kind, as JSON mode alone could hold before. */
const everyKind: WorkflowGraph = {
  version: 1,
  trigger: { objectTypes: ["task"], verbs: ["updated"], changedProperty: "status" },
  start: "check",
  steps: [
    { id: "check", kind: "condition", label: "Only blocked", when: { or: [
      { path: "event.changes.status.after", op: "eq", value: "blocked" },
      { path: "event.changes.priority.after", op: "in", value: ["high", "critical"] },
    ] }, next: "route" },
    { id: "route", kind: "branch", when: { path: "event.changes.assignee.after", op: "is_empty" }, then: "each", else: "pause" },
    { id: "each", kind: "loop", items: "event.changes.watchers.after", body: "raise", next: "pause" },
    { id: "raise", kind: "action", action: "task.set_priority", input: { taskId: THIS_ITEM, priority: "high" }, retry: { attempts: 3, backoffSeconds: 30 }, next: null },
    { id: "pause", kind: "wait", seconds: 600, next: "until" },
    { id: "until", kind: "wait", until: "event.changes.due.after", next: "approve" },
    { id: "approve", kind: "approval", subjectType: "contract", title: "Approve {{event.summary}}", description: "Please look", next: "review" },
    { id: "review", kind: "review", reviewer: "{{event.actor.id}}", instructions: "Check the budget", next: "hook" },
    { id: "hook", kind: "webhook", url: "https://example.com/hook", body: { id: "{{event.object.id}}", nested: { n: 1 } }, retry: { attempts: 2, backoffSeconds: 10 }, next: "mail" },
    { id: "mail", kind: "email", to: "{{event.actor.email}}", subject: "Heads up", body: "Task {{event.object.id}} changed.", next: "sub" },
    { id: "sub", kind: "subworkflow", workflowId: "11111111-2222-4333-8444-555555555555", next: null },
  ],
};

describe("editor model", () => {
  it("turns the list into a valid graph run top to bottom", () => {
    const graph = editorToGraph(state);
    expect(validateGraph(graph, known).ok).toBe(true);
    expect(graph.start).toBe("step-1");
    expect(graph.steps.map((step) => [step.id, (step as { next?: string | null }).next])).toEqual([
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
    expect(back?.steps).toEqual(state.steps);
  });

  it("drops the value for empty tests and accepts no steps", () => {
    const graph = editorToGraph({ ...state, steps: [{ id: "a", label: "", kind: "condition", when: { match: "all", tests: [{ path: "event.summary", op: "is_empty", value: "x" }] }, next: FOLLOWING }] });
    expect(graph.steps[0]).toMatchObject({ when: { path: "event.summary", op: "is_empty" } });
    expect("value" in (graph.steps[0] as { when: object }).when).toBe(false);
    expect(editorToGraph(emptyEditorState())).toMatchObject({ start: null, steps: [] });
  });

  it("shows every step kind in the list and round-trips it unchanged", () => {
    expect(validateGraph(everyKind, known).ok).toBe(true);
    const editor = graphToEditor(everyKind, meta);
    expect(editor).not.toBeNull();
    expect(new Set(editor!.steps.map((step) => step.kind))).toEqual(new Set(editorStepKinds));
    const back = editorToGraph(editor!);
    expect(validateGraph(back, known).ok).toBe(true);
    expect(back).toEqual(everyKind);
  });

  it.each(editorStepKinds)("a new %s step saves as a valid graph and comes back the same", (kind) => {
    const steps: EditorStep[] = [];
    const step = newStep(kind, steps);
    // Fill what a person must type before saving.
    if (step.kind === "loop") {
      steps.push({ ...step, items: "event.changes.watchers.after", body: FOLLOWING, next: END });
      steps.push({ ...newStep("action", steps), next: END } as EditorStep);
    } else {
      if (step.kind === "subworkflow") step.workflowId = "11111111-2222-4333-8444-555555555555";
      if (step.kind === "approval") step.title = "Approve";
      if (step.kind === "review") Object.assign(step, { reviewer: THIS_ITEM, instructions: "Look" });
      if (step.kind === "webhook") step.url = "https://example.com/x";
      if (step.kind === "email") Object.assign(step, { to: "a@example.com", subject: "s", body: "b" });
      steps.push(step);
    }
    const editor: EditorState = { ...emptyEditorState(), name: "n", steps };
    expect(editorIssues(editor)).toEqual([]);
    const graph = editorToGraph(editor);
    const checked = validateGraph(graph, known);
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
    const back = graphToEditor(graph, meta);
    expect(back?.steps.map((item) => item.kind)).toEqual(steps.map((item) => item.kind));
    expect(editorToGraph(back!)).toEqual(graph);
  });

  it("keeps jumps to named steps and the end", () => {
    const editor = graphToEditor(everyKind, meta)!;
    const route = editor.steps.find((step) => step.id === "route");
    expect(route).toMatchObject({ kind: "branch", then: FOLLOWING, else: { to: "step", id: "pause" } });
    const raise = editor.steps.find((step) => step.id === "raise");
    expect(raise).toMatchObject({ next: END, retry: { attempts: 3, backoffSeconds: 30 } });
  });

  it("refuses to show a condition with a group inside a group", () => {
    const graph = editorToGraph(state);
    const nested = { ...graph, steps: [{ ...graph.steps[0], when: { and: [{ or: [{ path: "a", op: "eq" as const, value: 1 }] }] } }, ...graph.steps.slice(1)] };
    expect(graphToEditor(nested as WorkflowGraph, meta)).toBeNull();
  });

  it("names what the list can see is wrong before saving", () => {
    const steps: EditorStep[] = [
      { ...newStep("webhook", []), id: "w", body: "{ not json" } as EditorStep,
      { ...newStep("loop", []), id: "l", body: END } as EditorStep,
      { ...newStep("subworkflow", []), id: "s" } as EditorStep,
      { ...newStep("condition", []), id: "c", when: { match: "all", tests: [] } } as EditorStep,
    ];
    expect(editorIssues({ ...emptyEditorState(), steps }).map((issue) => issue.code)).toEqual([
      "webhook_body_json", "loop_body", "subworkflow_missing", "condition_empty",
    ]);
  });

  it("gives new steps ids no step uses yet", () => {
    expect(newStepId([{ id: "step-1" }, { id: "step-3" }])).toBe("step-4");
    expect(newStepId([{ id: "step-2" }])).toBe("step-3");
    expect(newStepId([])).toBe("step-1");
  });

  it("saves numbers and yes-or-no as typed values, and keeps them typed", () => {
    expect([typedScalar("5"), typedScalar("-2.5"), typedScalar("true"), typedScalar("false"), typedScalar(" blocked ")])
      .toEqual([5, -2.5, true, false, "blocked"]);
    const graph: WorkflowGraph = { ...everyKind, start: "c", steps: [
      { id: "c", kind: "condition", when: { and: [
        { path: "event.changes.estimate.after", op: "gt", value: 5 },
        { path: "event.changes.done.after", op: "eq", value: true },
        { path: "event.changes.n.after", op: "in", value: [1, "two"] },
      ] }, next: null },
    ] };
    expect(editorToGraph(graphToEditor(graph, meta)!)).toEqual(graph);
  });

  it("keeps the end of a loop body as the end, so an added step does not join the loop", () => {
    const graph: WorkflowGraph = { ...everyKind, start: "each", steps: [
      { id: "each", kind: "loop", items: "event.changes.list.after", body: "raise", next: "pause" },
      { id: "pause", kind: "wait", seconds: 60, next: null },
      { id: "raise", kind: "action", action: "task.set_priority", input: { taskId: THIS_ITEM, priority: "high" }, next: null },
    ] };
    const editor = graphToEditor(graph, meta)!;
    expect(editor.steps.find((step) => step.id === "raise")).toMatchObject({ next: END });
    const added = { ...editor, steps: [...editor.steps, newStep("action", editor.steps)] };
    const saved = editorToGraph(added);
    expect(saved.steps.find((step) => step.id === "raise")).toMatchObject({ next: null });
    expect(saved.steps.find((step) => step.id === "pause")).toMatchObject({ next: null });
  });

  it("keeps every trigger type a stored graph names", () => {
    const graph: WorkflowGraph = { ...everyKind, trigger: { objectTypes: ["task", "project"], verbs: [] } };
    expect(editorToGraph(graphToEditor(graph, meta)!).trigger.objectTypes).toEqual(["task", "project"]);
  });

  it("ends the links that went to a removed step and never reuses its id", () => {
    const steps: EditorStep[] = [
      { ...newStep("condition", []), id: "step-1", next: { to: "step", id: "step-3" } } as EditorStep,
      { ...newStep("branch", []), id: "step-2", then: { to: "step", id: "step-3" } } as EditorStep,
      { ...newStep("wait", []), id: "step-3" } as EditorStep,
    ];
    const left = removeStep(steps, 2);
    expect(left.map((step) => step.id)).toEqual(["step-1", "step-2"]);
    expect(left[0]).toMatchObject({ next: END });
    expect(left[1]).toMatchObject({ then: END });
    expect(newStepId([...left, { id: "step-7" }])).toBe("step-8");
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

  it("labels every action and step kind in both languages", () => {
    for (const key of workflowActionKeys) {
      expect(workflowsEn.actions[key]).toBeTruthy();
      expect(workflowsFrCA.actions[key]).toBeTruthy();
      expect(workflowsEn.test.wouldHave[key]).toBeTruthy();
      expect(workflowsFrCA.test.wouldHave[key]).toBeTruthy();
    }
    for (const kind of editorStepKinds) {
      expect(workflowsEn.steps.kinds[kind]).toBeTruthy();
      expect(workflowsFrCA.steps.kinds[kind]).toBeTruthy();
    }
  });
});
