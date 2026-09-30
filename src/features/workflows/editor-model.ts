import { z } from "zod";
import { conditionOperators, objectEventVerbs, type ConditionScalar, type WorkflowGraph } from "./graph";
import { workflowActionKeys, type WorkflowActionKey } from "./actions-catalog";

/**
 * The workflow screen edits a list of steps run top to bottom; this turns that
 * list into a graph and back (M14c). Kept free of React and I/O so the same
 * conversion is unit-tested and used by the server action.
 */

export const editorObjectTypes = [
  "task",
  "project",
  "meeting",
  "decision",
  "risk",
  "event",
  "document",
  "contact",
] as const;

export type EditorOperator = (typeof conditionOperators)[number];

export interface EditorConditionStep {
  kind: "condition";
  path: string;
  op: EditorOperator;
  /** As typed. A list for `in` is comma-separated. */
  value: string;
}

export interface EditorActionStep {
  kind: "action";
  action: WorkflowActionKey;
  /** Field values as typed, by input key. */
  fields: Record<string, string>;
}

export type EditorStep = EditorConditionStep | EditorActionStep;

export interface EditorState {
  name: string;
  description: string;
  enabled: boolean;
  maxRunsPerHour: number;
  objectType: string;
  verbs: string[];
  changedProperty: string;
  steps: EditorStep[];
}

/** The fields each action shows, in order. Optional ones may be left empty. */
export const actionFields: Record<WorkflowActionKey, { key: string; optional?: boolean }[]> = {
  "task.set_status": [{ key: "taskId" }, { key: "status" }],
  "task.set_priority": [{ key: "taskId" }, { key: "priority" }],
  "task.assign": [{ key: "taskId" }, { key: "assigneeId", optional: true }],
  "notification.send": [{ key: "userId" }, { key: "title" }, { key: "link", optional: true }],
};

export const THIS_ITEM = "{{event.object.id}}";

export function defaultActionFields(action: WorkflowActionKey): Record<string, string> {
  const defaults: Record<string, string> = { taskId: THIS_ITEM, status: "completed", priority: "high" };
  return Object.fromEntries(actionFields[action].map(({ key }) => [key, defaults[key] ?? ""]));
}

export function emptyEditorState(): EditorState {
  return {
    name: "",
    description: "",
    enabled: true,
    maxRunsPerHour: 60,
    objectType: "task",
    verbs: ["updated"],
    changedProperty: "status",
    steps: [],
  };
}

function conditionValue(step: EditorConditionStep): ConditionScalar | ConditionScalar[] | undefined {
  if (step.op === "is_empty" || step.op === "is_not_empty") return undefined;
  if (step.op === "in") {
    return step.value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return step.value.trim();
}

/** Step ids are positional, so the graph is the list in order. */
export function editorToGraph(state: EditorState): WorkflowGraph {
  const ids = state.steps.map((_, index) => `step-${index + 1}`);
  return {
    version: 1,
    trigger: {
      objectTypes: state.objectType ? [state.objectType] : [],
      verbs: state.verbs.filter((verb): verb is (typeof objectEventVerbs)[number] =>
        (objectEventVerbs as readonly string[]).includes(verb)),
      ...(state.changedProperty.trim() ? { changedProperty: state.changedProperty.trim() } : {}),
    },
    start: ids[0] ?? null,
    steps: state.steps.map((step, index) => {
      const id = ids[index];
      const next = ids[index + 1] ?? null;
      if (step.kind === "condition") {
        const value = conditionValue(step);
        return {
          id,
          kind: "condition" as const,
          when: { path: step.path.trim(), op: step.op, ...(value === undefined ? {} : { value }) },
          next,
        };
      }
      const input: Record<string, unknown> = {};
      for (const { key, optional } of actionFields[step.action]) {
        const raw = (step.fields[key] ?? "").trim();
        if (raw === "") {
          if (key === "assigneeId") input[key] = null;
          else if (!optional) input[key] = "";
          continue;
        }
        input[key] = raw;
      }
      return { id, kind: "action" as const, action: step.action, input, next };
    }),
  };
}

function stringOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(stringOf).join(", ");
  return String(value);
}

/**
 * The editor's view of a stored graph, walking from `start`. A graph the list
 * editor cannot show (a step kind added later) returns null, and the screen
 * says so instead of silently dropping steps.
 */
export function graphToEditor(
  graph: WorkflowGraph,
  meta: { name: string; description: string | null; enabled: boolean; maxRunsPerHour?: number },
): EditorState | null {
  const byId = new Map(graph.steps.map((step) => [step.id, step]));
  const steps: EditorStep[] = [];
  const seen = new Set<string>();
  let current = graph.start;
  while (current) {
    const step = byId.get(current);
    if (!step || seen.has(current)) return null;
    seen.add(current);
    if (step.kind === "condition") {
      if ("and" in step.when || "or" in step.when) return null;
      steps.push({ kind: "condition", path: step.when.path, op: step.when.op, value: stringOf(step.when.value) });
    } else if (step.kind === "action") {
      if (!(workflowActionKeys as readonly string[]).includes(step.action)) return null;
      const action = step.action as WorkflowActionKey;
      steps.push({
        kind: "action",
        action,
        fields: Object.fromEntries(actionFields[action].map(({ key }) => [key, stringOf(step.input[key])])),
      });
    } else {
      return null;
    }
    current = step.next;
  }
  if (seen.size !== graph.steps.length) return null;
  return {
    name: meta.name,
    description: meta.description ?? "",
    enabled: meta.enabled,
    maxRunsPerHour: meta.maxRunsPerHour ?? 60,
    objectType: graph.trigger.objectTypes[0] ?? "",
    verbs: [...graph.trigger.verbs],
    changedProperty: graph.trigger.changedProperty ?? "",
    steps,
  };
}

const uuid = z.string().uuid();

/** What the screen submits. The graph itself is re-validated on the server. */
export const saveWorkflowSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  enabled: z.boolean(),
  maxRunsPerHour: z.number().int().min(1).max(1000).default(60),
  graph: z.unknown(),
});

export const stopSchema = z.object({ id: uuid, stop: z.boolean() });
export const retrySchema = z.object({ executionId: uuid, stepId: z.string().trim().min(1).max(64) });

export const testRunSchema = z.object({
  id: uuid,
  objectId: uuid,
  before: z.string().trim().max(200).default(""),
  after: z.string().trim().max(200).default(""),
});
