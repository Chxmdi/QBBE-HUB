import { z } from "zod";
import type { FilterOperator, ObjectEventVerb } from "@/lib/objects/contracts";

/**
 * A workflow as a graph of steps (plan A9, M14a).
 *
 * Stored as JSON in `workflow_rule.graph` for rules whose engine is
 * `graph_v2`. The trigger says which object events start a run; `start` names
 * the first step; each step names the one after it (`next`), and null ends the
 * run. The graph must be acyclic and every step reachable from `start`.
 *
 * Step kinds:
 *   condition  continues only when its test passes; otherwise the run ends as
 *              "skipped" (matched, nothing to do).
 *   action     runs one action from the action registry with templated input.
 */

export const WORKFLOW_GRAPH_VERSION = 1;
/** Steps a definition may hold. The per-run limit is separate (engine.ts). */
export const MAX_STEPS_PER_GRAPH = 50;

export const objectEventVerbs = [
  "created",
  "updated",
  "archived",
  "restored",
  "deleted",
  "linked",
  "unlinked",
  "commented",
] as const satisfies readonly ObjectEventVerb[];

export const conditionOperators = [
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "contains",
  "is_empty",
  "is_not_empty",
] as const satisfies readonly FilterOperator[];

const scalar = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

export type ConditionScalar = z.infer<typeof scalar>;

/** A test on a value in the run's scope, e.g. `event.changes.status.after`. */
export interface ConditionLeaf {
  path: string;
  op: (typeof conditionOperators)[number];
  value?: ConditionScalar | ConditionScalar[];
}
export type ConditionNode = ConditionLeaf | { and: ConditionNode[] } | { or: ConditionNode[] };

const pathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/, "A path is names separated by dots.");

export const conditionSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    z.object({
      path: pathSchema,
      op: z.enum(conditionOperators),
      value: z.union([scalar, z.array(scalar).max(100)]).optional(),
    }).strict(),
    z.object({ and: z.array(conditionSchema).min(1).max(20) }).strict(),
    z.object({ or: z.array(conditionSchema).min(1).max(20) }).strict(),
  ]),
);

const stepId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "A step id is lower-case letters, digits, dashes and underscores.");

const next = stepId.nullable();
const label = z.string().trim().max(120).optional();

export const triggerSchema = z.object({
  /** Object types that start a run; empty means any type. */
  objectTypes: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  /** Event verbs that start a run; empty means any verb. */
  verbs: z.array(z.enum(objectEventVerbs)).max(objectEventVerbs.length).default([]),
  /** Only when this property is among the changes. */
  changedProperty: z.string().trim().min(1).max(64).optional(),
}).strict();

export const conditionStepSchema = z.object({
  id: stepId,
  kind: z.literal("condition"),
  label,
  when: conditionSchema,
  next,
}).strict();

export const actionStepSchema = z.object({
  id: stepId,
  kind: z.literal("action"),
  label,
  /** An action registry key, e.g. `task.set_status`. */
  action: z.string().trim().min(1).max(64),
  /** Input for the action. Strings may hold `{{path}}` placeholders. */
  input: z.record(z.unknown()).default({}),
  next,
}).strict();

export const stepSchema = z.discriminatedUnion("kind", [conditionStepSchema, actionStepSchema]);

export const graphSchema = z.object({
  version: z.literal(WORKFLOW_GRAPH_VERSION),
  trigger: triggerSchema,
  start: stepId.nullable(),
  steps: z.array(stepSchema).max(MAX_STEPS_PER_GRAPH),
}).strict();

export type WorkflowTrigger = z.infer<typeof triggerSchema>;
export type ConditionStep = z.infer<typeof conditionStepSchema>;
export type ActionStep = z.infer<typeof actionStepSchema>;
export type WorkflowStep = z.infer<typeof stepSchema>;
export type WorkflowGraph = z.infer<typeof graphSchema>;

export type GraphIssueCode =
  | "invalid"
  | "duplicate_step"
  | "unknown_start"
  | "unknown_next"
  | "unreachable"
  | "cycle"
  | "unknown_action";

export interface GraphIssue {
  code: GraphIssueCode;
  stepId?: string;
  message: string;
}

export type GraphValidation =
  | { ok: true; graph: WorkflowGraph }
  | { ok: false; issues: GraphIssue[] };

/** The steps a step can go to next. */
export function successors(step: WorkflowStep): string[] {
  return step.next ? [step.next] : [];
}

/**
 * Parses and checks a stored or submitted graph. `knownActions`, when given,
 * rejects action keys the registry does not have.
 */
export function validateGraph(input: unknown, knownActions?: ReadonlySet<string>): GraphValidation {
  const parsed = graphSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "invalid",
        message: `${issue.path.join(".") || "graph"}: ${issue.message}`,
      })),
    };
  }
  const graph = parsed.data;
  const issues: GraphIssue[] = [];
  const byId = new Map<string, WorkflowStep>();
  for (const step of graph.steps) {
    if (byId.has(step.id)) {
      issues.push({ code: "duplicate_step", stepId: step.id, message: `Two steps are called "${step.id}".` });
    }
    byId.set(step.id, step);
  }
  if (graph.start !== null && !byId.has(graph.start)) {
    issues.push({ code: "unknown_start", stepId: graph.start, message: `The first step "${graph.start}" does not exist.` });
  }
  for (const step of graph.steps) {
    for (const target of successors(step)) {
      if (!byId.has(target)) {
        issues.push({ code: "unknown_next", stepId: step.id, message: `Step "${step.id}" goes to "${target}", which does not exist.` });
      }
    }
    if (step.kind === "action" && knownActions && !knownActions.has(step.action)) {
      issues.push({ code: "unknown_action", stepId: step.id, message: `Step "${step.id}" uses an unknown action "${step.action}".` });
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  // Depth-first from the start: anything on the current path again is a cycle.
  const reached = new Set<string>();
  const onPath = new Set<string>();
  const visit = (id: string): void => {
    if (onPath.has(id)) {
      issues.push({ code: "cycle", stepId: id, message: `Step "${id}" leads back to itself.` });
      return;
    }
    if (reached.has(id)) return;
    reached.add(id);
    onPath.add(id);
    for (const target of successors(byId.get(id)!)) visit(target);
    onPath.delete(id);
  };
  if (graph.start) visit(graph.start);
  for (const step of graph.steps) {
    if (!reached.has(step.id)) {
      issues.push({ code: "unreachable", stepId: step.id, message: `Step "${step.id}" can never be reached.` });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, graph };
}
