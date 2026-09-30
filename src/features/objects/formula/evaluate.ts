import { FormulaError } from "./errors";
import { parseFormula, type FormulaNode } from "./parser";

/** A calendar date (no time of day), as YYYY-MM-DD. */
export interface FormulaDate {
  date: string;
}
export type FormulaValue = number | string | boolean | null | FormulaDate | FormulaValue[];

export interface FormulaContext {
  /** Property values by key; names are matched too (case-insensitive). */
  properties: Record<string, FormulaValue>;
  /** Display names to keys, so prop("Due date") finds `due`. */
  names?: Record<string, string>;
  /** Today in the organization's time zone, YYYY-MM-DD. */
  today: string;
}

const MAX_STEPS = 10_000;
const MAX_TEXT = 10_000;
const MAX_LIST = 1_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDate(value: FormulaValue): value is FormulaDate {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "date" in value;
}

export function typeOf(value: FormulaValue): "number" | "text" | "boolean" | "date" | "list" | "empty" {
  if (value === null) return "empty";
  if (Array.isArray(value)) return "list";
  if (isDate(value)) return "date";
  if (typeof value === "string") return "text";
  if (typeof value === "boolean") return "boolean";
  return "number";
}

/** A date from a YYYY-MM-DD (or longer ISO) string; throws when it is not one. */
export function toDate(value: FormulaValue): FormulaDate {
  if (isDate(value)) return value;
  if (typeof value === "string") {
    const match = DATE.exec(value.slice(0, 10));
    if (match) {
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (date.toISOString().slice(0, 10) === value.slice(0, 10)) return { date: value.slice(0, 10) };
    }
  }
  throw new FormulaError("invalid_date", { value: String(value) });
}

export function dateToUtc(value: FormulaDate): number {
  const [y, m, d] = value.date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function utcToDate(time: number): FormulaDate {
  return { date: new Date(time).toISOString().slice(0, 10) };
}

export function expect(value: FormulaValue, expected: "number" | "text" | "boolean" | "list", operation: string): never | void {
  if (typeOf(value) !== expected) {
    throw new FormulaError("type_mismatch", { operation, expected, actual: typeOf(value) });
  }
}

export function checkNumber(value: number): number {
  if (!Number.isFinite(value)) throw new FormulaError("result_too_large");
  return value;
}

export function checkText(value: string): string {
  if (value.length > MAX_TEXT) throw new FormulaError("result_too_large");
  return value;
}

export function checkList(value: FormulaValue[]): FormulaValue[] {
  if (value.length > MAX_LIST) throw new FormulaError("result_too_large");
  return value;
}

/** Text form of any value, as concat() and + with text use it. */
export function asText(value: FormulaValue): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.map(asText).join(", ");
  if (isDate(value)) return value.date;
  return String(value);
}

export function truthy(value: FormulaValue): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function equal(a: FormulaValue, b: FormulaValue): boolean {
  if (isDate(a) || isDate(b)) {
    try {
      return toDate(a).date === toDate(b).date;
    } catch {
      return false;
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => equal(item, b[i]));
  return a === b;
}

function compare(a: FormulaValue, b: FormulaValue, operation: string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string" && !DATE.test(a)) return a.localeCompare(b);
  if (isDate(a) || isDate(b) || (typeof a === "string" && typeof b === "string")) {
    return dateToUtc(toDate(a)) - dateToUtc(toDate(b));
  }
  throw new FormulaError("type_mismatch", { operation, expected: "number", actual: typeOf(typeof a === "number" ? b : a) });
}

export type FormulaFunction = (args: FormulaValue[], context: FormulaContext) => FormulaValue;

export interface Evaluator {
  step: () => void;
  context: FormulaContext;
}

/** Evaluates a parsed formula. Lazily for if/and/or, so unused branches cost nothing. */
export function evaluateNode(
  node: FormulaNode,
  context: FormulaContext,
  functions: Record<string, { arity: [number, number]; lazy?: boolean; run: (args: (() => FormulaValue)[], context: FormulaContext) => FormulaValue }>,
): FormulaValue {
  let steps = 0;
  const lowerKeys = new Map(Object.keys(context.properties).map((key) => [key.toLowerCase(), key]));
  const lowerNames = new Map(Object.entries(context.names ?? {}).map(([name, key]) => [name.toLowerCase(), key]));

  const visit = (current: FormulaNode): FormulaValue => {
    steps += 1;
    if (steps > MAX_STEPS) throw new FormulaError("too_many_steps");
    switch (current.type) {
      case "number":
        return current.value;
      case "string":
        return current.value;
      case "boolean":
        return current.value;
      case "null":
        return null;
      case "property": {
        const wanted = current.name.toLowerCase();
        const key = lowerKeys.get(wanted) ?? lowerNames.get(wanted);
        if (!key || !(key in context.properties)) throw new FormulaError("unknown_property", { name: current.name });
        return context.properties[key] ?? null;
      }
      case "unary": {
        const value = visit(current.operand);
        if (current.operator === "not") return !truthy(value);
        expect(value, "number", "-");
        return -(value as number);
      }
      case "binary": {
        const { operator } = current;
        if (operator === "and") return truthy(visit(current.left)) && truthy(visit(current.right));
        if (operator === "or") return truthy(visit(current.left)) || truthy(visit(current.right));
        const left = visit(current.left);
        const right = visit(current.right);
        switch (operator) {
          case "==":
            return equal(left, right);
          case "!=":
            return !equal(left, right);
          case "<":
            return compare(left, right, operator) < 0;
          case "<=":
            return compare(left, right, operator) <= 0;
          case ">":
            return compare(left, right, operator) > 0;
          case ">=":
            return compare(left, right, operator) >= 0;
          case "+":
            if (typeof left === "string" || typeof right === "string") return checkText(asText(left) + asText(right));
            break;
        }
        expect(left, "number", operator);
        expect(right, "number", operator);
        const a = left as number;
        const b = right as number;
        if ((operator === "/" || operator === "%") && b === 0) throw new FormulaError("division_by_zero");
        const result = operator === "+" ? a + b : operator === "-" ? a - b : operator === "*" ? a * b : operator === "/" ? a / b : a % b;
        return checkNumber(result);
      }
      case "call": {
        const fn = functions[current.name];
        if (!fn) throw new FormulaError("unknown_function", { name: current.name });
        const [min, max] = fn.arity;
        if (current.args.length < min || current.args.length > max) {
          throw new FormulaError("wrong_argument_count", {
            name: current.name,
            expected: min === max ? min : `${min}–${max}`,
            actual: current.args.length,
          });
        }
        const thunks = current.args.map((arg) => {
          let cached: { value: FormulaValue } | null = null;
          return () => (cached ??= { value: visit(arg) }).value;
        });
        return fn.run(thunks, context);
      }
    }
  };
  return visit(node);
}

export { parseFormula };
