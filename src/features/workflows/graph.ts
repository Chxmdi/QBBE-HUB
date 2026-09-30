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
 *   condition    continues only when its test passes; otherwise the run ends
 *                as "skipped" (matched, nothing to do). Inside a loop body it
 *                ends that iteration only.
 *   action       runs one action from the action registry with templated input.
 *   branch       goes to `then` when its test passes, else to `else`.
 *   loop         runs the steps from `body` once per item of a list, with the
 *                item at `loop.item` (at most MAX_LOOP_ITERATIONS items).
 *   subworkflow  runs another workflow of the organization with the same event.
 *   wait         pauses the run for a time, or until a date in the scope; the
 *                workflow-resume job continues it.
 *   approval     submits an item to the approval engine as the workflow's owner
 *                and waits until it is approved, rejected or withdrawn.
 *   review       asks a person to approve or reject, and waits for them.
 *   webhook      POSTs JSON to an https address, signed with the workflow's key.
 *   email        sends an email through the email provider, only to addresses
 *                the environment's allow-list accepts.
 *
 * Actions, webhooks and emails may retry with backoff: the run waits and
 * resumes the same step.
 */

export const WORKFLOW_GRAPH_VERSION = 1;
/** Steps a definition may hold. The per-run limit is separate (engine.ts). */
export const MAX_STEPS_PER_GRAPH = 50;
/** Hard cap on items a loop goes through, whatever the list holds. */
export const MAX_LOOP_ITERATIONS = 50;
/** Hard cap on attempts for one step, the first one included. */
export const MAX_STEP_ATTEMPTS = 5;
/** How deep sub-workflows may nest. */
export const MAX_SUBWORKFLOW_DEPTH = 3;
/** The longest a wait step may pause a run. */
export const MAX_WAIT_SECONDS = 30 * 24 * 3600;
export const approvalSubjectTypes = ["other", "contract", "form"] as const;

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

export const retrySchema = z.object({
  /** Attempts in all, the first one included. */
  attempts: z.number().int().min(1).max(MAX_STEP_ATTEMPTS),
  /** Wait before the second attempt; doubled for each later one. */
  backoffSeconds: z.number().int().min(1).max(3600),
}).strict();

export const actionStepSchema = z.object({
  id: stepId,
  kind: z.literal("action"),
  label,
  /** An action registry key, e.g. `task.set_status`. */
  action: z.string().trim().min(1).max(64),
  /** Input for the action. Strings may hold `{{path}}` placeholders. */
  input: z.record(z.unknown()).default({}),
  retry: retrySchema.optional(),
  next,
}).strict();

export const branchStepSchema = z.object({
  id: stepId,
  kind: z.literal("branch"),
  label,
  when: conditionSchema,
  then: next,
  else: next,
}).strict();

export const loopStepSchema = z.object({
  id: stepId,
  kind: z.literal("loop"),
  label,
  /** Path to a list in the scope, e.g. `steps.lookup.people`. */
  items: pathSchema,
  /** First step of the body; the body ends where a step's next is null. */
  body: stepId,
  next,
}).strict();

export const subworkflowStepSchema = z.object({
  id: stepId,
  kind: z.literal("subworkflow"),
  label,
  workflowId: z.string().uuid(),
  next,
}).strict();

export const waitStepSchema = z.object({
  id: stepId,
  kind: z.literal("wait"),
  label,
  /** Pause this long, or */
  seconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).optional(),
  /** until the date at this path in the scope (never longer than the maximum). */
  until: pathSchema.optional(),
  next,
}).strict().refine((step) => (step.seconds === undefined) !== (step.until === undefined), {
  message: "A wait has either seconds or until, not both.",
});

const text = (max: number) => z.string().trim().min(1).max(max);

export const approvalStepSchema = z.object({
  id: stepId,
  kind: z.literal("approval"),
  label,
  subjectType: z.enum(approvalSubjectTypes).default("other"),
  title: text(200),
  description: z.string().trim().max(2000).optional(),
  next,
}).strict();

export const reviewStepSchema = z.object({
  id: stepId,
  kind: z.literal("review"),
  label,
  /** The reviewer's id, or a `{{path}}` to one. */
  reviewer: text(200),
  instructions: text(2000),
  next,
}).strict();

export const webhookStepSchema = z.object({
  id: stepId,
  kind: z.literal("webhook"),
  label,
  url: z.string().trim().url().max(2000).refine((url) => url.startsWith("https://"), "A webhook address must use https."),
  /** The JSON body. Strings may hold `{{path}}` placeholders. */
  body: z.record(z.unknown()).default({}),
  retry: retrySchema.optional(),
  next,
}).strict();

export const emailStepSchema = z.object({
  id: stepId,
  kind: z.literal("email"),
  label,
  to: text(320),
  subject: text(200),
  body: text(5000),
  retry: retrySchema.optional(),
  next,
}).strict();

export const stepSchema = z.discriminatedUnion("kind", [
  conditionStepSchema,
  actionStepSchema,
  branchStepSchema,
  loopStepSchema,
  subworkflowStepSchema,
  // A refined schema is not a plain object, so the wait is listed by its shape.
  waitStepSchema.innerType(),
  approvalStepSchema,
  reviewStepSchema,
  webhookStepSchema,
  emailStepSchema,
]).superRefine((step, context) => {
  if (step.kind === "wait" && (step.seconds === undefined) === (step.until === undefined)) {
    context.addIssue({ code: "custom", message: "A wait has either seconds or until, not both." });
  }
});

export const graphSchema = z.object({
  version: z.literal(WORKFLOW_GRAPH_VERSION),
  trigger: triggerSchema,
  start: stepId.nullable(),
  steps: z.array(stepSchema).max(MAX_STEPS_PER_GRAPH),
}).strict();

export type WorkflowTrigger = z.infer<typeof triggerSchema>;
export type ConditionStep = z.infer<typeof conditionStepSchema>;
export type ActionStep = z.infer<typeof actionStepSchema>;
export type BranchStep = z.infer<typeof branchStepSchema>;
export type LoopStep = z.infer<typeof loopStepSchema>;
export type SubworkflowStep = z.infer<typeof subworkflowStepSchema>;
export type RetrySettings = z.infer<typeof retrySchema>;
export type WaitStep = z.infer<typeof waitStepSchema>;
export type ApprovalStep = z.infer<typeof approvalStepSchema>;
export type ReviewStep = z.infer<typeof reviewStepSchema>;
export type WebhookStep = z.infer<typeof webhookStepSchema>;
export type EmailStep = z.infer<typeof emailStepSchema>;
export type WorkflowStep = z.infer<typeof stepSchema>;
export type WorkflowGraph = z.infer<typeof graphSchema>;

export type GraphIssueCode =
  | "invalid"
  | "duplicate_step"
  | "unknown_start"
  | "unknown_next"
  | "unreachable"
  | "cycle"
  | "unknown_action"
  | "loop_body";

export interface GraphIssue {
  code: GraphIssueCode;
  stepId?: string;
  message: string;
}

export type GraphValidation =
  | { ok: true; graph: WorkflowGraph }
  | { ok: false; issues: GraphIssue[] };

/** The steps a step can go to next (a loop's body included). */
export function successors(step: WorkflowStep): string[] {
  if (step.kind === "branch") return [step.then, step.else].filter((id): id is string => Boolean(id));
  if (step.kind === "loop") return [step.body, ...(step.next ? [step.next] : [])];
  return step.next ? [step.next] : [];
}

/** Steps that may run inside a loop body: nothing that waits or nests runs. */
const LOOP_BODY_KINDS = new Set<WorkflowStep["kind"]>(["condition", "action", "branch"]);

/** The steps of each loop's body, found by following it until it ends. */
export function loopBodies(graph: WorkflowGraph): Map<string, Set<string>> {
  const byId = new Map(graph.steps.map((step) => [step.id, step]));
  const bodies = new Map<string, Set<string>>();
  for (const step of graph.steps) {
    if (step.kind !== "loop") continue;
    const body = new Set<string>();
    const queue = [step.body];
    while (queue.length) {
      const id = queue.pop()!;
      if (body.has(id) || id === step.id) continue;
      body.add(id);
      const inner = byId.get(id);
      if (inner) queue.push(...successors(inner));
    }
    bodies.set(step.id, body);
  }
  return bodies;
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
  if (issues.length > 0) return { ok: false, issues };

  // A loop body is its own island: only simple steps, entered only from its loop.
  const bodies = loopBodies(graph);
  for (const [loopId, body] of bodies) {
    for (const id of body) {
      const step = byId.get(id)!;
      if (!LOOP_BODY_KINDS.has(step.kind)) {
        issues.push({ code: "loop_body", stepId: id, message: `Step "${id}" cannot run inside loop "${loopId}".` });
      }
    }
    for (const step of graph.steps) {
      if (step.id === loopId || body.has(step.id)) continue;
      if (successors(step).some((target) => body.has(target))) {
        issues.push({ code: "loop_body", stepId: step.id, message: `Step "${step.id}" jumps into the body of loop "${loopId}".` });
      }
    }
    if (graph.start && body.has(graph.start)) {
      issues.push({ code: "loop_body", stepId: graph.start, message: `The first step is inside loop "${loopId}".` });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, graph };
}
