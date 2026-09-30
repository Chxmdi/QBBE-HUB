import type { ActionResult } from "@/lib/objects/contracts";
import {
  MAX_LOOP_ITERATIONS,
  MAX_SUBWORKFLOW_DEPTH,
  type WorkflowGraph,
  type WorkflowStep,
} from "./graph";
import { evaluateCondition, renderTemplate, resolvePath, type RunScope } from "./scope";

/**
 * Runs a workflow graph for one event and says what each step did (M14a,
 * V1-12).
 *
 * The engine does no I/O of its own: actions and sub-workflows go through
 * `ports`, and the caller stores the step records it returns. A run can pause
 * ("waiting") and be resumed later from the step it names, with the state it
 * returned; that is how retries with backoff work, and how waits, approvals
 * and reviews will.
 */

/** Hard ceiling on steps one run may take, across all its resumptions. */
export const MAX_STEPS_PER_RUN = 100;

export type StepStatus = "succeeded" | "failed" | "skipped" | "waiting";
export type RunOutcome = "succeeded" | "failed" | "skipped" | "waiting";

export interface StepRecord {
  position: number;
  stepId: string;
  kind: WorkflowStep["kind"] | "trigger";
  status: StepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  attempt: number;
  startedAt: string;
  finishedAt: string;
}

export type ActionCheck = "ok" | "unknown_action" | "forbidden";

export interface SubworkflowOutcome {
  outcome: string;
  runNumber: number | null;
  error: string | null;
}

export interface EnginePorts {
  /** Runs an action as the workflow's identity. */
  runAction: (key: string, input: unknown) => Promise<ActionResult>;
  /** Whether the action exists and may run on its targets, without running it. */
  checkAction: (key: string, input: unknown) => Promise<ActionCheck>;
  /** Runs another workflow with the same event, one level deeper. */
  runSubworkflow?: (workflowId: string, depth: number) => Promise<SubworkflowOutcome>;
}

/** What a run carries between resumptions. */
export interface RunState {
  steps: Record<string, unknown>;
  stepsTaken: number;
  depth: number;
}

export interface ResumePoint {
  stepId: string;
  attempt: number;
  /** When to resume; null means when what it waits on is decided. */
  at: string | null;
  reason: "retry";
}

export interface EngineOptions {
  /** A test run: actions are checked but not run, so nothing changes. */
  dryRun?: boolean;
  maxSteps?: number;
  now?: () => Date;
  /** Resume here instead of at the graph's start (no trigger step is recorded). */
  startAt?: { stepId: string; attempt: number };
  state?: RunState;
  /** Step records already stored for this run, so positions continue. */
  positionOffset?: number;
}

export interface RunResult {
  outcome: RunOutcome;
  steps: StepRecord[];
  /** The first failure, in a sentence, for the run list. */
  error: string | null;
  state: RunState;
  resume: ResumePoint | null;
}

type Effect =
  | { status: "succeeded"; output: unknown }
  | { status: "failed"; output: unknown; error: string };

type Walk =
  | { kind: "end" }
  | { kind: "stop"; outcome: Exclude<RunOutcome, "succeeded">; error: string | null; resume?: ResumePoint };

function describeActionFailure(result: Extract<ActionResult, { ok: false }>): string {
  if (result.reason === "forbidden") return "forbidden: the workflow's owner may not do this.";
  if (result.reason === "unknown_action") return "unknown_action: the action does not exist.";
  return `failed: ${result.message ?? "the action failed."}`;
}

export async function runGraph(
  graph: WorkflowGraph,
  scope: RunScope,
  ports: EnginePorts,
  options: EngineOptions = {},
): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const maxSteps = Math.min(options.maxSteps ?? MAX_STEPS_PER_RUN, MAX_STEPS_PER_RUN);
  const byId = new Map(graph.steps.map((step) => [step.id, step]));
  const state: RunState = options.state
    ? { ...options.state, steps: { ...options.state.steps } }
    : { steps: {}, stepsTaken: 0, depth: 0 };
  scope.steps = state.steps;
  const records: StepRecord[] = [];
  const offset = options.positionOffset ?? 0;
  const stamp = () => now().toISOString();
  const record = (entry: Omit<StepRecord, "position">) => records.push({ ...entry, position: offset + records.length });

  const finish = (outcome: RunOutcome, error: string | null, resume: ResumePoint | null = null): RunResult =>
    ({ outcome, steps: records, error, state, resume });

  let start = graph.start;
  let firstAttempt = 1;
  if (options.startAt) {
    start = options.startAt.stepId;
    firstAttempt = options.startAt.attempt;
    if (!byId.has(start)) return finish("failed", `unknown_step: "${start}" does not exist.`);
  } else {
    const at = stamp();
    record({ stepId: "trigger", kind: "trigger", status: "succeeded", input: null, output: scope.event, error: null, attempt: 1, startedAt: at, finishedAt: at });
  }

  async function effect(step: Extract<WorkflowStep, { kind: "action" | "subworkflow" }>, input: unknown): Promise<Effect> {
    if (step.kind === "subworkflow") {
      if (state.depth + 1 > MAX_SUBWORKFLOW_DEPTH) {
        return { status: "failed", output: null, error: `depth_limit: sub-workflows nest at most ${MAX_SUBWORKFLOW_DEPTH} deep.` };
      }
      if (options.dryRun || !ports.runSubworkflow) {
        return { status: "succeeded", output: { dryRun: true, workflowId: step.workflowId } };
      }
      const outcome = await ports.runSubworkflow(step.workflowId, state.depth + 1);
      if (outcome.outcome === "failed" || outcome.outcome === "stopped") {
        return { status: "failed", output: outcome, error: outcome.error ?? "failed: the sub-workflow failed." };
      }
      return { status: "succeeded", output: outcome };
    }
    if (options.dryRun) {
      const check = await ports.checkAction(step.action, input);
      const output = { dryRun: true, action: step.action, check };
      if (check === "ok") return { status: "succeeded", output };
      return {
        status: "failed",
        output,
        error: check === "forbidden"
          ? "forbidden: the workflow's owner may not do this."
          : "unknown_action: the action does not exist.",
      };
    }
    let result: ActionResult;
    try {
      result = await ports.runAction(step.action, input);
    } catch (cause) {
      result = { ok: false, reason: "failed", message: cause instanceof Error ? cause.message : String(cause) };
    }
    if (!result.ok) return { status: "failed", output: null, error: describeActionFailure(result) };
    return { status: "succeeded", output: { changeSetId: result.changeSet.id, changes: result.changeSet.changes } };
  }

  /** Walks from `from` until a step's next is null. Inside a loop body, `inLoop` is set. */
  async function walk(from: string | null, inLoop: boolean, attemptAtStart = 1): Promise<Walk> {
    let current = from;
    let attempt = attemptAtStart;
    while (current) {
      const step = byId.get(current);
      if (!step) return { kind: "stop", outcome: "failed", error: `unknown_step: "${current}" does not exist.` };
      if (state.stepsTaken >= maxSteps) {
        return { kind: "stop", outcome: "failed", error: `step_limit: the run passed ${maxSteps} steps.` };
      }
      state.stepsTaken += 1;
      const startedAt = stamp();
      const base = { stepId: step.id, kind: step.kind, startedAt };

      switch (step.kind) {
        case "condition": {
          const matched = evaluateCondition(step.when, scope);
          state.steps[step.id] = { matched };
          record({ ...base, status: "succeeded", input: step.when, output: { matched }, error: null, attempt: 1, finishedAt: stamp() });
          if (!matched) return inLoop ? { kind: "end" } : { kind: "stop", outcome: "skipped", error: null };
          current = step.next;
          break;
        }
        case "branch": {
          const matched = evaluateCondition(step.when, scope);
          const next = matched ? step.then : step.else;
          state.steps[step.id] = { matched, next };
          record({ ...base, status: "succeeded", input: step.when, output: { matched, next }, error: null, attempt: 1, finishedAt: stamp() });
          current = next;
          break;
        }
        case "loop": {
          const list = resolvePath(scope, step.items);
          const items = Array.isArray(list) ? list : [];
          if (items.length > MAX_LOOP_ITERATIONS) {
            const error = `loop_limit: ${items.length} items is more than ${MAX_LOOP_ITERATIONS}.`;
            record({ ...base, status: "failed", input: { items: step.items }, output: { count: items.length }, error, attempt: 1, finishedAt: stamp() });
            return { kind: "stop", outcome: "failed", error };
          }
          record({ ...base, status: "succeeded", input: { items: step.items }, output: { count: items.length }, error: null, attempt: 1, finishedAt: stamp() });
          for (let index = 0; index < items.length; index += 1) {
            scope.loop = { item: items[index], index };
            const result = await walk(step.body, true);
            if (result.kind === "stop") {
              scope.loop = undefined;
              return result;
            }
          }
          scope.loop = undefined;
          state.steps[step.id] = { iterations: items.length };
          current = step.next;
          break;
        }
        case "action":
        case "subworkflow": {
          const input = step.kind === "action" ? renderTemplate(step.input, scope) : { workflowId: step.workflowId };
          const retry = step.kind === "action" ? step.retry : undefined;
          let outcome = await effect(step, input);
          // Inside a loop a run cannot pause, so retries there happen at once.
          while (inLoop && outcome.status === "failed" && retry && attempt < retry.attempts && !options.dryRun) {
            record({ ...base, status: "failed", input, output: outcome.output, error: outcome.error, attempt, finishedAt: stamp() });
            attempt += 1;
            outcome = await effect(step, input);
          }
          state.steps[step.id] = outcome.output;
          if (outcome.status === "failed") {
            record({ ...base, status: "failed", input, output: outcome.output, error: outcome.error, attempt, finishedAt: stamp() });
            if (!inLoop && retry && attempt < retry.attempts && !options.dryRun) {
              const delay = retry.backoffSeconds * 2 ** (attempt - 1);
              return {
                kind: "stop",
                outcome: "waiting",
                error: outcome.error,
                resume: { stepId: step.id, attempt: attempt + 1, at: new Date(now().getTime() + delay * 1000).toISOString(), reason: "retry" },
              };
            }
            return { kind: "stop", outcome: "failed", error: outcome.error };
          }
          record({ ...base, status: "succeeded", input, output: outcome.output, error: null, attempt, finishedAt: stamp() });
          current = step.next;
          break;
        }
      }
      attempt = 1;
    }
    return { kind: "end" };
  }

  const result = await walk(start, false, firstAttempt);
  if (result.kind === "end") return finish("succeeded", null);
  return finish(result.outcome, result.error, result.resume ?? null);
}
