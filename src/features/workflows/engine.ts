import type { ActionResult } from "@/lib/objects/contracts";
import {
  MAX_LOOP_ITERATIONS,
  MAX_SUBWORKFLOW_DEPTH,
  MAX_WAIT_SECONDS,
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

export type WaitingOn = { kind: "approval" | "review"; id: string };

/** What an approval or review came to; null while nobody has decided. */
export type Decision = { status: string; comment?: string | null } | null;

/** The result of an outbound call: done, or failed with a reason. */
export type OutboundResult = { ok: true; output: unknown } | { ok: false; error: string };

export interface EnginePorts {
  /** Runs an action as the workflow's identity. */
  runAction: (key: string, input: unknown) => Promise<ActionResult>;
  /** Whether the action exists and may run on its targets, without running it. */
  checkAction: (key: string, input: unknown) => Promise<ActionCheck>;
  /** Runs another workflow with the same event, one level deeper. */
  runSubworkflow?: (workflowId: string, depth: number) => Promise<SubworkflowOutcome>;
  /** Submits to the approval engine as the workflow's owner; returns the item id. */
  submitApproval?: (input: { stepId: string; subjectType: string; title: string; description: string | null }) => Promise<string>;
  /** Asks a person for a review; returns the review id. */
  createReview?: (input: { stepId: string; reviewerId: string; instructions: string }) => Promise<string>;
  readDecision?: (waitingOn: WaitingOn) => Promise<Decision>;
  callWebhook?: (input: { stepId: string; url: string; body: unknown; attempt: number }) => Promise<OutboundResult>;
  sendEmail?: (input: { stepId: string; to: string; subject: string; body: string; attempt: number }) => Promise<OutboundResult>;
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
  reason: "retry" | "wait" | "approval" | "review";
  waitingOn?: WaitingOn;
}

/** Kinds that pause the run until a time or a decision, then complete on resume. */
const PAUSING = new Set<WorkflowStep["kind"]>(["wait", "approval", "review"]);

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

  async function effect(
    step: Extract<WorkflowStep, { kind: "action" | "subworkflow" | "webhook" | "email" }>,
    input: unknown,
    attempt: number,
  ): Promise<Effect> {
    if (step.kind === "webhook" || step.kind === "email") {
      if (options.dryRun) return { status: "succeeded", output: { dryRun: true, ...(input as object) } };
      const port = step.kind === "webhook" ? ports.callWebhook : ports.sendEmail;
      if (!port) return { status: "failed", output: null, error: `unavailable: ${step.kind} is not set up here.` };
      let result: OutboundResult;
      try {
        result = step.kind === "webhook"
          ? await ports.callWebhook!({ stepId: step.id, ...(input as { url: string; body: unknown }), attempt })
          : await ports.sendEmail!({ stepId: step.id, ...(input as { to: string; subject: string; body: string }), attempt });
      } catch (cause) {
        result = { ok: false, error: `failed: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
      return result.ok ? { status: "succeeded", output: result.output } : { status: "failed", output: null, error: result.error };
    }
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
        case "wait":
        case "approval":
        case "review": {
          const paused = state.steps[step.id] as { until?: string; waitingOn?: WaitingOn } | undefined;
          const resuming = resumingAt === step.id && paused !== undefined;
          resumingAt = null;
          if (resuming) {
            // The time has come or the decision is in: complete the step.
            if (step.kind === "wait") {
              state.steps[step.id] = { waitedUntil: paused!.until ?? null };
              record({ ...base, status: "succeeded", input: null, output: state.steps[step.id], error: null, attempt: 1, finishedAt: stamp() });
            } else {
              const decision = paused!.waitingOn && ports.readDecision ? await ports.readDecision(paused!.waitingOn) : null;
              if (!decision) {
                // Woken before anyone decided: keep waiting.
                state.stepsTaken -= 1;
                return { kind: "stop", outcome: "waiting", error: null, resume: { stepId: step.id, attempt: 1, at: null, reason: step.kind, waitingOn: paused!.waitingOn } };
              }
              state.steps[step.id] = { ...paused, ...decision };
              record({ ...base, status: "succeeded", input: paused!.waitingOn ?? null, output: state.steps[step.id], error: null, attempt: 1, finishedAt: stamp() });
            }
            current = step.next;
            break;
          }

          if (step.kind === "wait") {
            let until: Date;
            if (step.seconds !== undefined) {
              until = new Date(now().getTime() + step.seconds * 1000);
            } else {
              const raw = resolvePath(scope, step.until!);
              const parsed = typeof raw === "string" || typeof raw === "number" ? new Date(raw) : new Date(Number.NaN);
              if (Number.isNaN(parsed.getTime())) {
                const error = `invalid_date: "${step.until}" is not a date.`;
                record({ ...base, status: "failed", input: { until: step.until }, output: null, error, attempt: 1, finishedAt: stamp() });
                return { kind: "stop", outcome: "failed", error };
              }
              until = new Date(Math.min(parsed.getTime(), now().getTime() + MAX_WAIT_SECONDS * 1000));
            }
            if (options.dryRun || until.getTime() <= now().getTime()) {
              state.steps[step.id] = { waitedUntil: until.toISOString(), ...(options.dryRun ? { dryRun: true } : {}) };
              record({ ...base, status: "succeeded", input: { until: until.toISOString() }, output: state.steps[step.id], error: null, attempt: 1, finishedAt: stamp() });
              current = step.next;
              break;
            }
            state.steps[step.id] = { until: until.toISOString() };
            record({ ...base, status: "waiting", input: { until: until.toISOString() }, output: null, error: null, attempt: 1, finishedAt: stamp() });
            return { kind: "stop", outcome: "waiting", error: null, resume: { stepId: step.id, attempt: 1, at: until.toISOString(), reason: "wait" } };
          }

          const input = step.kind === "approval"
            ? {
              subjectType: step.subjectType,
              title: String(renderTemplate(step.title, scope) ?? ""),
              description: step.description ? String(renderTemplate(step.description, scope) ?? "") : null,
            }
            : {
              reviewerId: String(renderTemplate(step.reviewer, scope) ?? ""),
              instructions: String(renderTemplate(step.instructions, scope) ?? ""),
            };
          if (options.dryRun) {
            state.steps[step.id] = { dryRun: true, ...input };
            record({ ...base, status: "succeeded", input, output: state.steps[step.id], error: null, attempt: 1, finishedAt: stamp() });
            current = step.next;
            break;
          }
          let waitingOn: WaitingOn;
          try {
            if (step.kind === "approval") {
              if (!ports.submitApproval) throw new Error("approvals are not set up here.");
              waitingOn = { kind: "approval", id: await ports.submitApproval({ stepId: step.id, ...(input as { subjectType: string; title: string; description: string | null }) }) };
            } else {
              if (!ports.createReview) throw new Error("reviews are not set up here.");
              waitingOn = { kind: "review", id: await ports.createReview({ stepId: step.id, ...(input as { reviewerId: string; instructions: string }) }) };
            }
          } catch (cause) {
            const error = `failed: ${cause instanceof Error ? cause.message : String(cause)}`;
            record({ ...base, status: "failed", input, output: null, error, attempt: 1, finishedAt: stamp() });
            return { kind: "stop", outcome: "failed", error };
          }
          state.steps[step.id] = { waitingOn };
          record({ ...base, status: "waiting", input, output: { waitingOn }, error: null, attempt: 1, finishedAt: stamp() });
          return { kind: "stop", outcome: "waiting", error: null, resume: { stepId: step.id, attempt: 1, at: null, reason: step.kind, waitingOn } };
        }
        case "action":
        case "subworkflow":
        case "webhook":
        case "email": {
          const input = step.kind === "action"
            ? renderTemplate(step.input, scope)
            : step.kind === "webhook"
              ? { url: step.url, body: renderTemplate(step.body, scope) }
              : step.kind === "email"
                ? {
                  to: String(renderTemplate(step.to, scope) ?? ""),
                  subject: String(renderTemplate(step.subject, scope) ?? ""),
                  body: String(renderTemplate(step.body, scope) ?? ""),
                }
                : { workflowId: step.workflowId };
          const retry = step.kind === "subworkflow" ? undefined : step.retry;
          let outcome = await effect(step, input, attempt);
          // Inside a loop a run cannot pause, so retries there happen at once.
          while (inLoop && outcome.status === "failed" && retry && attempt < retry.attempts && !options.dryRun) {
            record({ ...base, status: "failed", input, output: outcome.output, error: outcome.error, attempt, finishedAt: stamp() });
            attempt += 1;
            outcome = await effect(step, input, attempt);
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
        default: {
          const unknown = step as { kind: string };
          return { kind: "stop", outcome: "failed", error: `unknown_kind: "${unknown.kind}" is not a step this engine runs.` };
        }
      }
      attempt = 1;
    }
    return { kind: "end" };
  }

  // A run resumed at a pausing step completes that step instead of pausing again.
  let resumingAt: string | null = options.startAt && PAUSING.has(byId.get(start!)!.kind) ? start : null;
  const result = await walk(start, false, firstAttempt);
  if (result.kind === "end") return finish("succeeded", null);
  return finish(result.outcome, result.error, result.resume ?? null);
}
