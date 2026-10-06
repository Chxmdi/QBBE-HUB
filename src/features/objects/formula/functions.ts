import { FormulaError } from "./errors";
import {
  asText,
  checkList,
  checkNumber,
  checkText,
  dateToUtc,
  expect,
  toDate,
  truthy,
  typeOf,
  utcToDate,
  type FormulaContext,
  type FormulaValue,
} from "./evaluate";

type Fn = {
  arity: [number, number];
  run: (args: (() => FormulaValue)[], context: FormulaContext) => FormulaValue;
};

const number = (value: FormulaValue, name: string): number => {
  expect(value, "number", `${name}()`);
  return value as number;
};
const text = (value: FormulaValue, name: string): string => {
  expect(value, "text", `${name}()`);
  return value as string;
};
const list = (value: FormulaValue): FormulaValue[] => (Array.isArray(value) ? value : value === null ? [] : [value]);
const numbers = (values: FormulaValue[], name: string) =>
  values.flatMap(list).filter((value) => value !== null).map((value) => number(value, name));

const UNITS = ["days", "weeks", "months", "years"] as const;
type Unit = (typeof UNITS)[number];
function unit(value: FormulaValue): Unit {
  const raw = asText(value).toLowerCase();
  const normalized = ({ day: "days", jours: "days", jour: "days", week: "weeks", semaines: "weeks", semaine: "weeks", month: "months", mois: "months", year: "years", ans: "years", an: "years", années: "years" } as Record<string, Unit>)[raw] ?? raw;
  if (!(UNITS as readonly string[]).includes(normalized)) throw new FormulaError("invalid_unit", { unit: raw });
  return normalized as Unit;
}

function addToDate(date: FormulaValue, amount: number, which: Unit): FormulaValue {
  const start = new Date(dateToUtc(toDate(date)));
  if (which === "days" || which === "weeks") {
    return utcToDate(start.getTime() + amount * (which === "weeks" ? 7 : 1) * 86_400_000);
  }
  const months = which === "years" ? amount * 12 : amount;
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return utcToDate(target.getTime());
}

function between(a: FormulaValue, b: FormulaValue, which: Unit): number {
  const from = new Date(dateToUtc(toDate(b)));
  const to = new Date(dateToUtc(toDate(a)));
  if (which === "days" || which === "weeks") {
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    return which === "weeks" ? Math.trunc(days / 7) : days;
  }
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (months > 0 && to.getUTCDate() < from.getUTCDate()) months -= 1;
  if (months < 0 && to.getUTCDate() > from.getUTCDate()) months += 1;
  return which === "years" ? Math.trunc(months / 12) : months;
}

/** Every function a formula may call. Nothing here reaches outside its arguments. */
export const formulaFunctions: Record<string, Fn> = {
  if: { arity: [3, 3], run: ([cond, yes, no]) => (truthy(cond()) ? yes() : no()) },
  and: { arity: [1, 20], run: (args) => args.every((arg) => truthy(arg())) },
  or: { arity: [1, 20], run: (args) => args.some((arg) => truthy(arg())) },
  not: { arity: [1, 1], run: ([value]) => !truthy(value()) },
  empty: {
    arity: [1, 1],
    run: ([value]) => {
      const v = value();
      return v === null || v === "" || (Array.isArray(v) && v.length === 0);
    },
  },
  coalesce: {
    arity: [1, 20],
    run: (args) => {
      for (const arg of args) {
        const v = arg();
        if (v !== null && v !== "") return v;
      }
      return null;
    },
  },

  // Numbers
  abs: { arity: [1, 1], run: ([v]) => Math.abs(number(v(), "abs")) },
  round: {
    arity: [1, 2],
    run: ([v, places]) => {
      const digits = places ? Math.max(0, Math.min(10, Math.trunc(number(places(), "round")))) : 0;
      const factor = 10 ** digits;
      return checkNumber(Math.round(number(v(), "round") * factor) / factor);
    },
  },
  floor: { arity: [1, 1], run: ([v]) => Math.floor(number(v(), "floor")) },
  ceil: { arity: [1, 1], run: ([v]) => Math.ceil(number(v(), "ceil")) },
  min: { arity: [1, 50], run: (args) => { const n = numbers(args.map((a) => a()), "min"); return n.length ? Math.min(...n) : null; } },
  max: { arity: [1, 50], run: (args) => { const n = numbers(args.map((a) => a()), "max"); return n.length ? Math.max(...n) : null; } },
  sum: { arity: [1, 50], run: (args) => checkNumber(numbers(args.map((a) => a()), "sum").reduce((s, n) => s + n, 0)) },
  average: {
    arity: [1, 50],
    run: (args) => { const n = numbers(args.map((a) => a()), "average"); return n.length ? checkNumber(n.reduce((s, x) => s + x, 0) / n.length) : null; },
  },
  tonumber: {
    arity: [1, 1],
    run: ([v]) => {
      const value = v();
      if (typeof value === "number" || value === null) return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      const parsed = Number(asText(value).replace(",", ".").trim());
      return Number.isFinite(parsed) && asText(value).trim() !== "" ? parsed : null;
    },
  },

  // Text
  concat: { arity: [1, 50], run: (args) => checkText(args.map((a) => asText(a())).join("")) },
  format: { arity: [1, 1], run: ([v]) => asText(v()) },
  length: {
    arity: [1, 1],
    run: ([v]) => {
      const value = v();
      return Array.isArray(value) ? value.length : asText(value).length;
    },
  },
  lower: { arity: [1, 1], run: ([v]) => text(v(), "lower").toLocaleLowerCase("fr-CA") },
  upper: { arity: [1, 1], run: ([v]) => text(v(), "upper").toLocaleUpperCase("fr-CA") },
  trim: { arity: [1, 1], run: ([v]) => text(v(), "trim").trim() },
  contains: {
    arity: [2, 2],
    run: ([haystack, needle]) => {
      const value = haystack();
      if (Array.isArray(value)) return value.some((item) => asText(item) === asText(needle()));
      return asText(value).toLocaleLowerCase("fr-CA").includes(asText(needle()).toLocaleLowerCase("fr-CA"));
    },
  },
  replace: {
    arity: [3, 3],
    run: ([v, from, to]) => checkText(text(v(), "replace").split(text(from(), "replace")).join(asText(to()))),
  },
  slice: {
    arity: [2, 3],
    run: ([v, start, end]) => {
      const s = text(v(), "slice");
      return s.slice(number(start(), "slice"), end ? number(end(), "slice") : undefined);
    },
  },
  join: {
    arity: [1, 2],
    run: ([values, separator]) => checkText(list(values()).map(asText).join(separator ? asText(separator()) : ", ")),
  },
  list: { arity: [0, 50], run: (args) => checkList(args.map((a) => a())) },
  count: { arity: [1, 1], run: ([v]) => list(v()).filter((item) => item !== null && item !== "").length },

  // Dates (calendar days, in the organization's time zone)
  today: { arity: [0, 0], run: (_args, context) => toDate(context.today) },
  date: { arity: [1, 1], run: ([v]) => toDate(v()) },
  dateadd: {
    arity: [3, 3],
    run: ([date, amount, which]) => addToDate(date(), Math.trunc(number(amount(), "dateAdd")), unit(which())),
  },
  datesubtract: {
    arity: [3, 3],
    run: ([date, amount, which]) => addToDate(date(), -Math.trunc(number(amount(), "dateSubtract")), unit(which())),
  },
  datebetween: { arity: [3, 3], run: ([a, b, which]) => between(a(), b(), unit(which())) },
  year: { arity: [1, 1], run: ([v]) => Number(toDate(v()).date.slice(0, 4)) },
  month: { arity: [1, 1], run: ([v]) => Number(toDate(v()).date.slice(5, 7)) },
  day: { arity: [1, 1], run: ([v]) => Number(toDate(v()).date.slice(8, 10)) },
  type: { arity: [1, 1], run: ([v]) => typeOf(v()) },
};
