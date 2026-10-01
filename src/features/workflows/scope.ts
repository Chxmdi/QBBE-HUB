import type { ObjectEvent } from "@/lib/objects/contracts";
import type { ConditionNode, ConditionScalar } from "./graph";

/**
 * What a run can read: the event that started it and the output of every step
 * so far. Conditions test paths into it and action inputs fill `{{path}}`
 * placeholders from it.
 *
 *   event.object.id                   the object the event is about
 *   event.changes.status.after        a changed property's new value
 *   steps.<stepId>.<field>            an earlier step's output
 *   loop.item / loop.index            the current item, inside a loop body
 */
export interface RunScope {
  event: EventScope;
  steps: Record<string, unknown>;
  workflow: { id: string; name: string };
  loop?: { item: unknown; index: number };
}

export interface EventScope {
  id: string;
  verb: ObjectEvent["verb"];
  object: ObjectEvent["object"];
  organizationId: string;
  actor: ObjectEvent["actor"];
  summary: string;
  occurredAt: string;
  /** Changes by property key, for paths such as `event.changes.status.after`. */
  changes: Record<string, { before: unknown; after: unknown }>;
}

export function eventScope(event: ObjectEvent): EventScope {
  return {
    id: event.id,
    verb: event.verb,
    object: event.object,
    organizationId: event.organizationId,
    actor: event.actor,
    summary: event.summary,
    occurredAt: event.occurredAt,
    changes: Object.fromEntries(
      event.changes.map((change) => [change.property, { before: change.before, after: change.after }]),
    ),
  };
}

/** The value at a dotted path, or undefined when any part is missing. */
export function resolvePath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split(".")) {
    if (node === null || node === undefined) return undefined;
    if (Array.isArray(node)) {
      const index = Number(part);
      node = Number.isInteger(index) ? node[index] : undefined;
    } else if (typeof node === "object") {
      node = Object.prototype.hasOwnProperty.call(node, part)
        ? (node as Record<string, unknown>)[part]
        : undefined;
    } else {
      return undefined;
    }
  }
  return node;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function same(a: unknown, b: ConditionScalar): boolean {
  if (a === undefined) return b === null;
  if (typeof a === "object" && a !== null) return false;
  if (typeof a === typeof b) return a === b;
  // Stored values are often strings; compare "5" and 5 as the same number.
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "") return Number(a) === b;
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "") return a === Number(b);
  return false;
}

function compare(a: unknown, b: ConditionScalar): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a))) {
    return Number(a) - b;
  }
  return null;
}

/** Whether a condition holds for the scope. Unknown paths are empty, never an error. */
export function evaluateCondition(node: ConditionNode, scope: RunScope): boolean {
  if ("and" in node) return node.and.every((child) => evaluateCondition(child, scope));
  if ("or" in node) return node.or.some((child) => evaluateCondition(child, scope));
  const actual = resolvePath(scope, node.path);
  const expected = node.value;
  switch (node.op) {
    case "is_empty":
      return isEmpty(actual);
    case "is_not_empty":
      return !isEmpty(actual);
    case "in":
      return Array.isArray(expected) && expected.some((item) => same(actual, item));
    case "contains":
      if (Array.isArray(expected) || expected === undefined || expected === null) return false;
      if (typeof actual === "string") return actual.toLowerCase().includes(String(expected).toLowerCase());
      if (Array.isArray(actual)) return actual.some((item) => same(item, expected));
      return false;
    default: {
      if (Array.isArray(expected)) return false;
      const value = expected ?? null;
      if (node.op === "eq") return same(actual, value);
      if (node.op === "neq") return !same(actual, value);
      const order = compare(actual, value);
      if (order === null) return false;
      if (node.op === "lt") return order < 0;
      if (node.op === "lte") return order <= 0;
      if (node.op === "gt") return order > 0;
      return order >= 0;
    }
  }
}

/**
 * What each path in a condition came to, by path, so a run's history and a
 * test run can say "event.changes.status.after was blocked" rather than only
 * whether the test passed. A missing value is null, as JSON stores it.
 */
export function conditionValues(node: ConditionNode, scope: RunScope): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const visit = (current: ConditionNode) => {
    if ("and" in current) current.and.forEach(visit);
    else if ("or" in current) current.or.forEach(visit);
    else values[current.path] = resolvePath(scope, current.path) ?? null;
  };
  visit(node);
  return values;
}

const WHOLE = /^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/;
const EMBEDDED = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/**
 * Fills `{{path}}` placeholders. A string that is only a placeholder becomes
 * the value itself (a number stays a number); placeholders inside text become
 * text, and a missing value becomes an empty string.
 */
export function renderTemplate(value: unknown, scope: RunScope): unknown {
  if (typeof value === "string") {
    const whole = value.match(WHOLE);
    if (whole) return resolvePath(scope, whole[1]) ?? null;
    return value.replace(EMBEDDED, (_, path: string) => {
      const found = resolvePath(scope, path);
      if (found === undefined || found === null) return "";
      return typeof found === "object" ? JSON.stringify(found) : String(found);
    });
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, scope));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderTemplate(item, scope)]),
    );
  }
  return value;
}
