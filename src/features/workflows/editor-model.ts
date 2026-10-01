import { z } from "zod";
import {
  approvalSubjectTypes,
  conditionOperators,
  objectEventVerbs,
  type ConditionLeaf,
  type ConditionNode,
  type ConditionScalar,
  type WorkflowGraph,
  type WorkflowStep,
} from "./graph";
import { workflowActionKeys, type WorkflowActionKey } from "./actions-catalog";

/**
 * The workflow screen edits a list of steps; this turns that list into a graph
 * and back (M14c, U10). Kept free of React and I/O so the same conversion is
 * unit-tested and used by the server action.
 *
 * Every step kind has a list form. A step keeps its graph id, and says where
 * the run goes after it: the step below it in the list (the default), a named
 * step, or the end of the run. So a branch, a loop body or a retry is a plain
 * list entry, and JSON mode is only needed for what the list still cannot
 * show: a condition with groups inside groups.
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

export const editorStepKinds = [
  "condition",
  "action",
  "branch",
  "loop",
  "subworkflow",
  "wait",
  "approval",
  "review",
  "webhook",
  "email",
] as const;
export type EditorStepKind = (typeof editorStepKinds)[number];

export type EditorOperator = (typeof conditionOperators)[number];

/** Where a run goes after a step. */
export type EditorLink = { to: "following" } | { to: "end" } | { to: "step"; id: string };

export const FOLLOWING: EditorLink = { to: "following" };
export const END: EditorLink = { to: "end" };

export interface EditorTest {
  path: string;
  op: EditorOperator;
  /** As typed. A list for `in` is comma-separated. */
  value: string;
}

/** One test, or several that must all (or any) pass. */
export interface EditorCondition {
  match: "all" | "any";
  tests: EditorTest[];
}

export interface EditorRetry {
  attempts: number;
  backoffSeconds: number;
}

interface EditorStepBase {
  id: string;
  label: string;
}

export interface EditorConditionStep extends EditorStepBase {
  kind: "condition";
  when: EditorCondition;
  next: EditorLink;
}

export interface EditorActionStep extends EditorStepBase {
  kind: "action";
  action: WorkflowActionKey;
  /** Field values as typed, by input key. */
  fields: Record<string, string>;
  retry: EditorRetry | null;
  next: EditorLink;
}

export interface EditorBranchStep extends EditorStepBase {
  kind: "branch";
  when: EditorCondition;
  then: EditorLink;
  else: EditorLink;
}

export interface EditorLoopStep extends EditorStepBase {
  kind: "loop";
  items: string;
  body: EditorLink;
  next: EditorLink;
}

export interface EditorSubworkflowStep extends EditorStepBase {
  kind: "subworkflow";
  workflowId: string;
  next: EditorLink;
}

export interface EditorWaitStep extends EditorStepBase {
  kind: "wait";
  mode: "seconds" | "until";
  seconds: string;
  until: string;
  next: EditorLink;
}

export interface EditorApprovalStep extends EditorStepBase {
  kind: "approval";
  subjectType: (typeof approvalSubjectTypes)[number];
  title: string;
  description: string;
  next: EditorLink;
}

export interface EditorReviewStep extends EditorStepBase {
  kind: "review";
  reviewer: string;
  instructions: string;
  next: EditorLink;
}

export interface EditorWebhookStep extends EditorStepBase {
  kind: "webhook";
  url: string;
  /** The JSON body as text. */
  body: string;
  retry: EditorRetry | null;
  next: EditorLink;
}

export interface EditorEmailStep extends EditorStepBase {
  kind: "email";
  to: string;
  subject: string;
  body: string;
  retry: EditorRetry | null;
  next: EditorLink;
}

export type EditorStep =
  | EditorConditionStep
  | EditorActionStep
  | EditorBranchStep
  | EditorLoopStep
  | EditorSubworkflowStep
  | EditorWaitStep
  | EditorApprovalStep
  | EditorReviewStep
  | EditorWebhookStep
  | EditorEmailStep;

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

export const DEFAULT_TEST: EditorTest = { path: "event.changes.status.after", op: "eq", value: "" };

export function emptyCondition(): EditorCondition {
  return { match: "all", tests: [{ ...DEFAULT_TEST }] };
}

/** The first `step-N` no step uses yet. */
export function newStepId(steps: readonly { id: string }[]): string {
  const taken = new Set(steps.map((step) => step.id));
  let number = steps.length + 1;
  while (taken.has(`step-${number}`)) number += 1;
  return `step-${number}`;
}

/** A fresh step of a kind, with sensible defaults, placed after the current steps. */
export function newStep(kind: EditorStepKind, steps: readonly { id: string }[]): EditorStep {
  const base = { id: newStepId(steps), label: "" };
  switch (kind) {
    case "condition":
      return { ...base, kind, when: emptyCondition(), next: FOLLOWING };
    case "action":
      return { ...base, kind, action: "task.set_priority", fields: defaultActionFields("task.set_priority"), retry: null, next: FOLLOWING };
    case "branch":
      return { ...base, kind, when: emptyCondition(), then: FOLLOWING, else: END };
    case "loop":
      return { ...base, kind, items: "", body: FOLLOWING, next: END };
    case "subworkflow":
      return { ...base, kind, workflowId: "", next: FOLLOWING };
    case "wait":
      return { ...base, kind, mode: "seconds", seconds: "3600", until: "", next: FOLLOWING };
    case "approval":
      return { ...base, kind, subjectType: "other", title: "", description: "", next: FOLLOWING };
    case "review":
      return { ...base, kind, reviewer: "", instructions: "", next: FOLLOWING };
    case "webhook":
      return { ...base, kind, url: "https://", body: "{}", retry: null, next: FOLLOWING };
    case "email":
      return { ...base, kind, to: "", subject: "", body: "", retry: null, next: FOLLOWING };
  }
}

function conditionValue(test: EditorTest): ConditionScalar | ConditionScalar[] | undefined {
  if (test.op === "is_empty" || test.op === "is_not_empty") return undefined;
  if (test.op === "in") {
    return test.value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return test.value.trim();
}

function leafOf(test: EditorTest): ConditionLeaf {
  const value = conditionValue(test);
  return { path: test.path.trim(), op: test.op, ...(value === undefined ? {} : { value }) };
}

function conditionOf(when: EditorCondition): ConditionNode {
  if (when.tests.length === 1) return leafOf(when.tests[0]);
  const leaves = when.tests.map(leafOf);
  return when.match === "any" ? { or: leaves } : { and: leaves };
}

function retryOf(retry: EditorRetry | null): { retry: EditorRetry } | Record<string, never> {
  return retry ? { retry: { attempts: retry.attempts, backoffSeconds: retry.backoffSeconds } } : {};
}

function labelOf(step: EditorStepBase): { label: string } | Record<string, never> {
  const label = step.label.trim();
  return label ? { label } : {};
}

/** The text of a webhook body as JSON, or null when it is not a JSON object. */
export function parseWebhookBody(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text.trim() === "" ? "{}" : text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type EditorIssueCode = "webhook_body_json" | "loop_body" | "subworkflow_missing" | "condition_empty";

export interface EditorIssue {
  stepId: string;
  code: EditorIssueCode;
}

/** What the list itself can see is wrong, before the server checks the graph. */
export function editorIssues(state: EditorState): EditorIssue[] {
  const issues: EditorIssue[] = [];
  for (const step of state.steps) {
    if (step.kind === "webhook" && parseWebhookBody(step.body) === null) issues.push({ stepId: step.id, code: "webhook_body_json" });
    if (step.kind === "loop" && step.body.to === "end") issues.push({ stepId: step.id, code: "loop_body" });
    if (step.kind === "subworkflow" && step.workflowId.trim() === "") issues.push({ stepId: step.id, code: "subworkflow_missing" });
    if ((step.kind === "condition" || step.kind === "branch") && step.when.tests.length === 0) {
      issues.push({ stepId: step.id, code: "condition_empty" });
    }
  }
  return issues;
}

/** The list in order is the graph: the first step starts it, and "following" means the step below. */
export function editorToGraph(state: EditorState): WorkflowGraph {
  const steps = state.steps;
  const resolve = (link: EditorLink, index: number): string | null => {
    if (link.to === "end") return null;
    if (link.to === "step") return link.id;
    return steps[index + 1]?.id ?? null;
  };
  return {
    version: 1,
    trigger: {
      objectTypes: state.objectType ? [state.objectType] : [],
      verbs: state.verbs.filter((verb): verb is (typeof objectEventVerbs)[number] =>
        (objectEventVerbs as readonly string[]).includes(verb)),
      ...(state.changedProperty.trim() ? { changedProperty: state.changedProperty.trim() } : {}),
    },
    start: steps[0]?.id ?? null,
    steps: steps.map((step, index): WorkflowStep => {
      const id = step.id;
      switch (step.kind) {
        case "condition":
          return { id, kind: "condition", ...labelOf(step), when: conditionOf(step.when), next: resolve(step.next, index) };
        case "branch":
          return {
            id,
            kind: "branch",
            ...labelOf(step),
            when: conditionOf(step.when),
            then: resolve(step.then, index),
            else: resolve(step.else, index),
          };
        case "action": {
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
          return { id, kind: "action", ...labelOf(step), action: step.action, input, ...retryOf(step.retry), next: resolve(step.next, index) };
        }
        case "loop":
          return {
            id,
            kind: "loop",
            ...labelOf(step),
            items: step.items.trim(),
            body: resolve(step.body, index) ?? "",
            next: resolve(step.next, index),
          };
        case "subworkflow":
          return { id, kind: "subworkflow", ...labelOf(step), workflowId: step.workflowId.trim(), next: resolve(step.next, index) };
        case "wait": {
          const seconds = Number(step.seconds);
          return {
            id,
            kind: "wait",
            ...labelOf(step),
            ...(step.mode === "seconds"
              ? (Number.isInteger(seconds) && seconds > 0 ? { seconds } : {})
              : (step.until.trim() ? { until: step.until.trim() } : {})),
            next: resolve(step.next, index),
          };
        }
        case "approval":
          return {
            id,
            kind: "approval",
            ...labelOf(step),
            subjectType: step.subjectType,
            title: step.title.trim(),
            ...(step.description.trim() ? { description: step.description.trim() } : {}),
            next: resolve(step.next, index),
          };
        case "review":
          return {
            id,
            kind: "review",
            ...labelOf(step),
            reviewer: step.reviewer.trim(),
            instructions: step.instructions.trim(),
            next: resolve(step.next, index),
          };
        case "webhook":
          return {
            id,
            kind: "webhook",
            ...labelOf(step),
            url: step.url.trim(),
            body: parseWebhookBody(step.body) ?? {},
            ...retryOf(step.retry),
            next: resolve(step.next, index),
          };
        case "email":
          return {
            id,
            kind: "email",
            ...labelOf(step),
            to: step.to.trim(),
            subject: step.subject.trim(),
            body: step.body.trim(),
            ...retryOf(step.retry),
            next: resolve(step.next, index),
          };
      }
    }),
  };
}

function stringOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(stringOf).join(", ");
  return String(value);
}

function testOf(leaf: ConditionLeaf): EditorTest {
  return { path: leaf.path, op: leaf.op, value: stringOf(leaf.value) };
}

/** A leaf, or one group of leaves; a group inside a group is not shown. */
function editorCondition(node: ConditionNode): EditorCondition | null {
  if ("and" in node || "or" in node) {
    const children = "and" in node ? node.and : node.or;
    const tests: EditorTest[] = [];
    for (const child of children) {
      if ("and" in child || "or" in child) return null;
      tests.push(testOf(child));
    }
    return { match: "and" in node ? "all" : "any", tests };
  }
  return { match: "all", tests: [testOf(node)] };
}

/**
 * The editor's view of a stored graph. The start step comes first and the
 * rest keep their order; a step whose next is the step below it says
 * "following". A graph the list cannot show (nested condition groups) returns
 * null, and the screen says so instead of silently dropping anything.
 */
export function graphToEditor(
  graph: WorkflowGraph,
  meta: { name: string; description: string | null; enabled: boolean; maxRunsPerHour?: number },
): EditorState | null {
  const ordered = graph.start
    ? [...graph.steps.filter((step) => step.id === graph.start), ...graph.steps.filter((step) => step.id !== graph.start)]
    : [...graph.steps];
  if (graph.start && ordered[0]?.id !== graph.start) return null;
  const link = (target: string | null, index: number): EditorLink => {
    // From the last step, "the step below" and "the end" are the same thing.
    if (target === null) return index === ordered.length - 1 ? FOLLOWING : END;
    if (ordered[index + 1]?.id === target) return FOLLOWING;
    return { to: "step", id: target };
  };
  const steps: EditorStep[] = [];
  for (const [index, step] of ordered.entries()) {
    const base = { id: step.id, label: step.label ?? "" };
    switch (step.kind) {
      case "condition": {
        const when = editorCondition(step.when);
        if (!when) return null;
        steps.push({ ...base, kind: "condition", when, next: link(step.next, index) });
        break;
      }
      case "branch": {
        const when = editorCondition(step.when);
        if (!when) return null;
        steps.push({ ...base, kind: "branch", when, then: link(step.then, index), else: link(step.else, index) });
        break;
      }
      case "action": {
        if (!(workflowActionKeys as readonly string[]).includes(step.action)) return null;
        const action = step.action as WorkflowActionKey;
        steps.push({
          ...base,
          kind: "action",
          action,
          fields: Object.fromEntries(actionFields[action].map(({ key }) => [key, stringOf(step.input[key])])),
          retry: step.retry ? { ...step.retry } : null,
          next: link(step.next, index),
        });
        break;
      }
      case "loop":
        steps.push({ ...base, kind: "loop", items: step.items, body: link(step.body, index), next: link(step.next, index) });
        break;
      case "subworkflow":
        steps.push({ ...base, kind: "subworkflow", workflowId: step.workflowId, next: link(step.next, index) });
        break;
      case "wait":
        steps.push({
          ...base,
          kind: "wait",
          mode: step.until !== undefined ? "until" : "seconds",
          seconds: step.seconds !== undefined ? String(step.seconds) : "",
          until: step.until ?? "",
          next: link(step.next, index),
        });
        break;
      case "approval":
        steps.push({
          ...base,
          kind: "approval",
          subjectType: step.subjectType,
          title: step.title,
          description: step.description ?? "",
          next: link(step.next, index),
        });
        break;
      case "review":
        steps.push({ ...base, kind: "review", reviewer: step.reviewer, instructions: step.instructions, next: link(step.next, index) });
        break;
      case "webhook":
        steps.push({
          ...base,
          kind: "webhook",
          url: step.url,
          body: JSON.stringify(step.body, null, 2),
          retry: step.retry ? { ...step.retry } : null,
          next: link(step.next, index),
        });
        break;
      case "email":
        steps.push({
          ...base,
          kind: "email",
          to: step.to,
          subject: step.subject,
          body: step.body,
          retry: step.retry ? { ...step.retry } : null,
          next: link(step.next, index),
        });
        break;
      default:
        return null;
    }
  }
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
export const decideReviewSchema = z.object({
  id: uuid,
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(2000).default(""),
});

export const testRunSchema = z.object({
  id: uuid,
  objectId: uuid,
  before: z.string().trim().max(200).default(""),
  after: z.string().trim().max(200).default(""),
  /** A recent real event to replay instead of the sample change above. */
  eventId: uuid.optional(),
});
