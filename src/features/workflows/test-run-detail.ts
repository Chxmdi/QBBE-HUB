import type { ConditionNode } from "./graph";

/**
 * What a test run's step records say, in a shape the test panel can put into
 * sentences (U10): the condition with the values its paths came to, the
 * action's filled-in input and whether the owner may do it, and what each
 * other step would have done. Pure, so it is unit-tested on its own.
 */

export interface RecordedStep {
  stepId: string;
  kind: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
}

export interface EvaluatedTest {
  path: string;
  op: string;
  value: unknown;
  /** What the path came to in the run. */
  actual: unknown;
}

export type TestStepDetail =
  | { kind: "trigger"; verb: string; objectType: string; objectId: string; changes: { property: string; before: unknown; after: unknown }[] }
  | { kind: "condition" | "branch"; matched: boolean; match: "all" | "any"; tests: EvaluatedTest[]; next: string | null | undefined }
  | { kind: "action"; action: string; input: Record<string, unknown>; check: "ok" | "forbidden" | "unknown_action" | null }
  | { kind: "loop"; items: string; count: number | null }
  | { kind: "wait"; until: string | null }
  | { kind: "approval"; subjectType: string; title: string; description: string | null }
  | { kind: "review"; reviewer: string; instructions: string }
  | { kind: "webhook"; url: string; body: unknown }
  | { kind: "email"; to: string; subject: string; body: string }
  | { kind: "subworkflow"; workflowId: string }
  | { kind: "other"; input: unknown; output: unknown };

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function leaves(node: ConditionNode, values: Record<string, unknown>): { match: "all" | "any"; tests: EvaluatedTest[] } {
  const tests: EvaluatedTest[] = [];
  const visit = (current: ConditionNode) => {
    if ("and" in current) current.and.forEach(visit);
    else if ("or" in current) current.or.forEach(visit);
    else tests.push({ path: current.path, op: current.op, value: current.value ?? null, actual: values[current.path] ?? null });
  };
  visit(node);
  return { match: "or" in node ? "any" : "all", tests };
}

export function describeTestStep(step: RecordedStep): TestStepDetail {
  const input = asObject(step.input);
  const output = asObject(step.output);
  switch (step.kind) {
    case "trigger": {
      const object = asObject(output.object);
      const changes = asObject(output.changes);
      return {
        kind: "trigger",
        verb: text(output.verb),
        objectType: text(object.type),
        objectId: text(object.id),
        changes: Object.entries(changes).map(([property, change]) => {
          const pair = asObject(change);
          return { property, before: pair.before ?? null, after: pair.after ?? null };
        }),
      };
    }
    case "condition":
    case "branch": {
      const when = step.input as ConditionNode;
      const { match, tests } = leaves(when, asObject(output.values));
      return {
        kind: step.kind,
        matched: output.matched === true,
        match,
        tests,
        next: step.kind === "branch" ? ((output.next as string | null | undefined) ?? null) : undefined,
      };
    }
    case "action": {
      const check = output.check;
      return {
        kind: "action",
        action: text(output.action),
        input,
        check: check === "ok" || check === "forbidden" || check === "unknown_action" ? check : null,
      };
    }
    case "loop":
      return { kind: "loop", items: text(input.items), count: typeof output.count === "number" ? output.count : null };
    case "wait":
      return { kind: "wait", until: typeof input.until === "string" ? input.until : null };
    case "approval":
      return {
        kind: "approval",
        subjectType: text(input.subjectType),
        title: text(input.title),
        description: input.description === null || input.description === undefined ? null : text(input.description),
      };
    case "review":
      return { kind: "review", reviewer: text(input.reviewerId), instructions: text(input.instructions) };
    case "webhook":
      return { kind: "webhook", url: text(input.url), body: input.body ?? null };
    case "email":
      return { kind: "email", to: text(input.to), subject: text(input.subject), body: text(input.body) };
    case "subworkflow":
      return { kind: "subworkflow", workflowId: text(input.workflowId) };
    default:
      return { kind: "other", input: step.input, output: step.output };
  }
}

/** A value as the panel prints it: empty as "—", objects as JSON. */
export function printValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(printValue).join(", ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
