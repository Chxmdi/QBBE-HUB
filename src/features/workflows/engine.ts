import type { ActionResult } from "@/lib/objects/contracts";
import type { WorkflowGraph, WorkflowStep } from "./graph";
import { evaluateCondition, renderTemplate, type RunScope } from "./scope";

/**
 * Runs a workflow graph for one event and says what each step did (M14a).
 *
 * The engine does no I/O of its own: actions go through `ports`, and the
 * caller stores the step records it returns. That keeps every rule about
 * running a graph in one pure function a unit test can drive.
 */

/** Hard ceiling on steps one run may take, whatever the graph says. */
export const MAX_STEPS_PER_RUN = 100;

export type StepStatus = "succeeded" | "failed" | "skipped" | "waiting";
export type RunOutcome = "succeeded" | "failed" | "skipped";

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

export interface EnginePorts {
  /** Runs an action as the workflow's identity. */
  runAction: (key: string, input: unknown) => Promise<ActionResult>;
  /** Whether the action exists and may run on its targets, without running it. */
  checkAction: (key: string, input: unknown) => Promise<ActionCheck>;
}

export interface EngineOptions {
  /** A test run: actions are checked but not run, so nothing changes. */
  dryRun?: boolean;
  maxSteps?: number;
  now?: () => Date;
}

export interface RunResult {
  outcome: RunOutcome;
  steps: StepRecord[];
  /** The first failure, in a sentence, for the run list. */
  error: string | null;
}

const STEP_LIMIT_ERROR = "step_limit";

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
  const steps: StepRecord[] = [];
  const stamp = () => now().toISOString();

  const triggeredAt = stamp();
  steps.push({
    position: 0,
    stepId: "trigger",
    kind: "trigger",
    status: "succeeded",
    input: null,
    output: scope.event,
    error: null,
    attempt: 1,
    startedAt: triggeredAt,
    finishedAt: triggeredAt,
  });

  let current = graph.start;
  let taken = 0;
  while (current) {
    const step = byId.get(current);
    if (!step) {
      return { outcome: "failed", steps, error: `unknown_step: "${current}" does not exist.` };
    }
    if (taken >= maxSteps) {
      return { outcome: "failed", steps, error: `${STEP_LIMIT_ERROR}: the run passed ${maxSteps} steps.` };
    }
    taken += 1;
    const startedAt = stamp();
    const base = { position: steps.length, stepId: step.id, kind: step.kind, attempt: 1, startedAt };

    if (step.kind === "condition") {
      const matched = evaluateCondition(step.when, scope);
      scope.steps[step.id] = { matched };
      steps.push({ ...base, status: "succeeded", input: step.when, output: { matched }, error: null, finishedAt: stamp() });
      if (!matched) return { outcome: "skipped", steps, error: null };
      current = step.next;
      continue;
    }

    // action
    const input = renderTemplate(step.input, scope);
    if (options.dryRun) {
      const check = await ports.checkAction(step.action, input);
      const output = { dryRun: true, action: step.action, check };
      scope.steps[step.id] = output;
      if (check !== "ok") {
        const error = check === "forbidden"
          ? "forbidden: the workflow's owner may not do this."
          : "unknown_action: the action does not exist.";
        steps.push({ ...base, status: "failed", input, output, error, finishedAt: stamp() });
        return { outcome: "failed", steps, error };
      }
      steps.push({ ...base, status: "succeeded", input, output, error: null, finishedAt: stamp() });
      current = step.next;
      continue;
    }

    let result: ActionResult;
    try {
      result = await ports.runAction(step.action, input);
    } catch (cause) {
      result = { ok: false, reason: "failed", message: cause instanceof Error ? cause.message : String(cause) };
    }
    if (!result.ok) {
      const error = describeActionFailure(result);
      steps.push({ ...base, status: "failed", input, output: null, error, finishedAt: stamp() });
      return { outcome: "failed", steps, error };
    }
    const output = { changeSetId: result.changeSet.id, changes: result.changeSet.changes };
    scope.steps[step.id] = output;
    steps.push({ ...base, status: "succeeded", input, output, error: null, finishedAt: stamp() });
    current = step.next;
  }

  return { outcome: "succeeded", steps, error: null };
}
