// W0-8 spike: SQL injection through every field of the spec.
//
// For each attack the compiler must either reject the spec with a QueryError
// (never another kind of error), or produce SQL where:
//   - the attack text does not appear in the SQL text at all;
//   - every word in the SQL text is from the compiler's fixed vocabulary;
//   - the only string literals are the compiler's own constants;
//   - every placeholder matches a bound value.
// A seeded fuzzer then checks the same invariants over thousands of random specs.

import { describe, expect, it } from "vitest";
import { compileLens, QueryError, type CompiledLens, type CompiledQuery } from "./compile";
import { catalog, ctx, PAYLOADS, PROJECT_TYPE } from "./fixtures";
import { OPERATORS_BY_KIND, RELATIVE_DATES, type PropertyKind } from "./spec";


// Every word the compiler may emit. Anything else in the SQL came from input.
const VOCABULARY = new Set(
  (
    "select from where and or not exists join left on as is null true false any all between ilike escape " +
    "order by asc desc nulls last first limit offset group count int int4 coalesce over row_number " +
    "array_position jsonb jsonb_object_agg jsonb_build_array jsonb_build_object jsonb_agg " +
    "timestamp at time zone text numeric date uuid boolean " +
    "wos_spike object property_value object_relation " +
    "id title space_id owner_id created_at updated_at archived_at type_id object_id property_id from_id to_id " +
    "value_text value_number value_date value_bool value_json " +
    "total group_key props relations ord items " +
    "o p g pv rr rt x"
  ).split(/\s+/),
);
const ALIAS = /^(?:v|r|t|s)\d+$/;
const LITERALS = new Set(["'{}'", "'id'", "'title'", "'\\'", "''"]);

function checkQuery(q: CompiledQuery) {
  const literals = q.text.match(/'(?:[^']|'')*'/g) ?? [];
  expect(literals.filter((lit) => !LITERALS.has(lit))).toEqual([]);
  const bare = q.text.replace(/'(?:[^']|'')*'/g, " ");
  const words = bare.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  expect(words.filter((w) => !VOCABULARY.has(w) && !ALIAS.test(w))).toEqual([]);
  // Nothing but the compiler's own punctuation.
  expect(bare).toMatch(/^[a-z0-9_\s().,*$:=<>@\[\]-]*$/);
  expect(bare).not.toMatch(/--|\/\*|;/);
  const used = new Set([...q.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  expect([...used].sort((a, b) => a - b)).toEqual(q.values.map((_, i) => i + 1));
}

function queries(lens: CompiledLens): CompiledQuery[] {
  return [lens.page, lens.count, ...(lens.groups ? [lens.groups] : [])];
}

type Outcome = { rejected: true; code: string } | { rejected: false; lens: CompiledLens };

function attempt(spec: unknown, viewerCtx = ctx): Outcome {
  try {
    const lens = compileLens(spec, catalog, viewerCtx);
    for (const q of queries(lens)) checkQuery(q);
    return { rejected: false, lens };
  } catch (error) {
    if (error instanceof QueryError) return { rejected: true, code: error.code };
    throw error; // A crash is a failure: the compiler must reject cleanly.
  }
}

/** Replace every occurrence of the payload in a spec with a harmless word. */
function neutralise(spec: unknown, payload: string): unknown {
  return JSON.parse(JSON.stringify(spec).split(JSON.stringify(payload).slice(1, -1)).join("benign"));
}

function expectSafe(spec: unknown, payload: string): Outcome {
  const outcome = attempt(spec);
  if (!outcome.rejected) {
    // The SQL text must not depend on the value at all: the same spec with a
    // harmless word in place of the payload compiles to identical SQL.
    const benign = attempt(neutralise(spec, payload));
    expect(benign.rejected).toBe(false);
    if (!benign.rejected) {
      const a = queries(outcome.lens).map((q) => q.text);
      const b = queries(benign.lens).map((q) => q.text);
      expect(a).toEqual(b);
      // And where the payload is not also ordinary compiler text, it is absent.
      for (const text of a) if (!b.some((t) => t.includes(payload))) expect(text).not.toContain(payload);
    }
  }
  return outcome;
}

const base = { version: 1, type: "task" };
const cond = (property: string, operator: string, value?: unknown) => ({ ...base, where: { and: [{ property, operator, value }] } });

describe.each(PAYLOADS)("injection payload %j", (payload) => {
  it("in the type is rejected", () => {
    expect(expectSafe({ ...base, type: payload }, payload)).toMatchObject({ rejected: true });
  });

  it("in a property name is rejected (filter, sort, group, select, relation filter)", () => {
    expect(expectSafe(cond(payload, "equals", "x"), payload)).toMatchObject({ rejected: true });
    expect(expectSafe({ ...base, sort: [{ property: payload }] }, payload)).toMatchObject({ rejected: true });
    expect(expectSafe({ ...base, groupBy: { property: payload } }, payload)).toMatchObject({ rejected: true });
    expect(expectSafe({ ...base, select: ["stage", payload] }, payload)).toMatchObject({ rejected: true });
    expect(
      expectSafe(cond("project", "matches", { where: { and: [{ property: payload, operator: "is", value: "run" }] } }), payload),
    ).toMatchObject({ rejected: true });
  });

  it("in an operator or sort direction is rejected", () => {
    expect(expectSafe(cond("notes", payload, "x"), payload)).toMatchObject({ rejected: true });
    expect(expectSafe({ ...base, sort: [{ property: "title", direction: payload }] }, payload)).toMatchObject({ rejected: true });
  });

  it("as a key of the spec or a condition is rejected", () => {
    expect(expectSafe({ ...base, [payload]: 1 }, payload)).toMatchObject({ rejected: true });
    expect(expectSafe({ ...base, where: { and: [{ property: "notes", operator: "equals", value: "x", [payload]: 1 }] } }, payload)).toMatchObject({ rejected: true });
    expect(expectSafe({ ...base, where: { [payload]: [] } }, payload)).toMatchObject({ rejected: true });
  });

  it("in limit, offset or version is rejected", () => {
    expect(expectSafe({ ...base, limit: payload }, payload)).toMatchObject({ rejected: true });
    expect(expectSafe({ ...base, offset: payload }, payload)).toMatchObject({ rejected: true });
    expect(expectSafe({ ...base, version: payload }, payload)).toMatchObject({ rejected: true });
  });

  it("as a text value is bound, never inlined", () => {
    for (const [property, operator] of [
      ["notes", "equals"],
      ["notes", "not_equals"],
      ["notes", "contains"],
      ["notes", "not_contains"],
      ["title", "starts_with"],
      ["title", "equals"],
    ]) {
      const outcome = expectSafe(cond(property, operator, payload), payload);
      // A NUL byte cannot be stored in Postgres text, so it is refused up front.
      if (payload.includes("\u0000")) {
        expect(outcome).toMatchObject({ rejected: true, code: "invalid_spec" });
        continue;
      }
      expect(outcome.rejected).toBe(false);
      if (!outcome.rejected) {
        const bound = outcome.lens.count.values.filter((v) => typeof v === "string") as string[];
        expect(bound.some((v) => v.includes(payload) || v.includes(payload.replace(/[\\%_]/g, (c) => `\\${c}`)))).toBe(true);
      }
    }
  });

  it("as a value of every other kind is rejected or bound", () => {
    const specs = [
      cond("estimate", "gt", payload),
      cond("estimate", "between", { from: payload, to: 1 }),
      cond("due", "is", payload),
      cond("due", "is", { date: payload }),
      cond("due", "is", { relative: payload }),
      cond("due", "between", { from: { date: "2026-01-01" }, to: payload }),
      cond("created_at", "after", { date: payload }),
      cond("stage", "is", payload),
      cond("stage", "is_any_of", ["todo", payload]),
      cond("space", "is", payload),
      cond("tags", "has_any", [payload]),
      cond("tags", "has_all", ["finance", payload]),
      cond("reviewers", "contains", payload),
      cond("reviewers", "contains", { relative: payload }),
      cond("owner", "contains", payload),
      cond("approved", "is", payload),
      cond("project", "contains", payload),
      cond("project", "matches", payload),
      cond("project", "matches", { where: payload }),
      cond("project", "matches", { where: { and: [{ property: "phase", operator: "is", value: payload }] } }),
      cond("project", "matches", { where: { and: [{ property: "budget", operator: "gt", value: payload }] } }),
      cond("notes", "is_empty", payload),
    ];
    for (const spec of specs) expect(expectSafe(spec, payload)).toMatchObject({ rejected: true });
    // Relation "matches" on the related title binds the payload like any text value.
    const ok = expectSafe(cond("project", "matches", { where: { and: [{ property: "title", operator: "equals", value: payload }] } }), payload);
    expect(ok.rejected).toBe(payload.includes("\u0000"));
  });

  it("in the viewer id or time zone of the context is rejected", () => {
    expect(() => compileLens(base, catalog, { ...ctx, viewerId: payload })).toThrow(QueryError);
    expect(() => compileLens(base, catalog, { ...ctx, timeZone: payload })).toThrow(QueryError);
  });
});

// ---------------------------------------------------------------------------
// Fuzzing: random specs, valid and not, built from the grammar plus payloads.
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TASK_KEYS = ["title", "space", "owner", "created_at", "updated_at", "stage", "priority", "tags", "due", "estimate", "points", "reviewers", "notes", "approved", "project"];
const OPS = ["equals", "not_equals", "contains", "not_contains", "starts_with", "is_empty", "is_not_empty", "eq", "neq", "lt", "lte", "gt", "gte", "between", "is", "before", "after", "on_or_before", "on_or_after", "is_not", "is_any_of", "is_none_of", "has_any", "has_all", "has_none", "matches"];

describe("fuzzing", () => {
  it("holds the invariants over 3,000 random specs", { timeout: 60_000 }, () => {
    const r = rng(20260930);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    const str = () => (r() < 0.5 ? pick(PAYLOADS) : pick(["todo", "run", "finance", "Plan", "2026-09-30", PROJECT_TYPE, ctx.viewerId]));
    const value = (depth: number): unknown => {
      switch (Math.floor(r() * 11)) {
        case 0: return str();
        case 1: return Math.round(r() * 100) - 50;
        case 2: return r() < 0.5;
        case 3: return { date: r() < 0.7 ? "2026-09-30" : str() };
        case 4: return { relative: pick([...RELATIVE_DATES, "me", str()]) };
        case 5: return [str(), str()];
        case 6: return { from: Math.round(r() * 10), to: Math.round(r() * 10) + 10 };
        case 7: return { from: { date: "2026-01-01" }, to: { relative: "today" } };
        case 8: return depth < 2 ? { where: group(depth + 1) } : undefined;
        case 9: return { relative: "me" };
        default: return undefined;
      }
    };
    // Mostly well-typed values, so the fuzzer reaches the SQL generator.
    const typedValue = (kind: PropertyKind, op: string, depth: number): unknown => {
      if (op === "is_empty" || op === "is_not_empty") return undefined;
      if (op === "matches") return { where: depth < 2 ? group(depth + 1, "project") : { and: [{ property: "phase", operator: "is", value: "run" }] } };
      if (op === "between") return kind === "number" ? { from: 1, to: 9 } : { from: { date: "2026-01-01" }, to: { relative: pick(RELATIVE_DATES) } };
      switch (kind) {
        case "text": return str();
        case "number": return Math.round(r() * 100) / 4;
        case "date": return r() < 0.5 ? { relative: pick(RELATIVE_DATES) } : { date: "2026-09-30" };
        case "select": return op.endsWith("_of") ? ["todo", "doing", "run", "low"] : pick(["todo", "run", "low", PROJECT_TYPE]);
        case "multi_select": return ["finance", "youth"];
        case "person": return r() < 0.5 ? { relative: "me" } : ctx.viewerId;
        case "checkbox": return r() < 0.5;
        case "relation": return PROJECT_TYPE;
      }
    };
    const condition = (depth: number, type = "task") => {
      const props = [...catalog.get(type)!.properties.values()];
      if (r() < 0.2) return { property: r() < 0.5 ? str() : pick(TASK_KEYS), operator: r() < 0.5 ? str() : pick(OPS), value: value(depth) };
      const p = pick(props);
      const op = pick(OPERATORS_BY_KIND[p.kind] as readonly string[]);
      return { property: p.key, operator: op, value: r() < 0.85 ? typedValue(p.kind, op, depth) : value(depth) };
    };
    const group = (depth: number, type = "task"): object => {
      const items = Array.from({ length: 1 + Math.floor(r() * 3) }, () =>
        depth < 3 && r() < 0.25 ? group(depth + 1, type) : condition(depth, type),
      );
      return r() < 0.5 ? { and: items } : { or: items };
    };

    let compiled = 0;
    let withValues = 0;
    for (let i = 0; i < 3000; i++) {
      const spec = {
        version: 1,
        type: r() < 0.97 ? "task" : str(),
        ...(r() < 0.9 ? { where: group(1) } : {}),
        ...(r() < 0.6 ? { sort: [{ property: pick(TASK_KEYS), direction: pick(["asc", "desc"]) }] } : {}),
        ...(r() < 0.4 ? { groupBy: { property: pick(["stage", "priority", "approved", "space", "owner", "notes"]) } } : {}),
        ...(r() < 0.6 ? { select: [pick(TASK_KEYS), pick(TASK_KEYS)].filter((k, j, a) => a.indexOf(k) === j) } : {}),
      };
      const outcome = attempt(spec);
      if (!outcome.rejected) {
        compiled++;
        // Same SQL text with every payload swapped for a harmless word.
        const benign = attempt(PAYLOADS.reduce((acc, p) => neutralise(acc, p), spec as unknown));
        expect(benign.rejected).toBe(false);
        if (!benign.rejected) {
          expect(queries(outcome.lens).map((q) => q.text)).toEqual(queries(benign.lens).map((q) => q.text));
        }
        if (outcome.lens.count.values.length > 1) withValues++;
      }
    }
    // Make sure the fuzzer exercised the compiler, not just the parser.
    expect(compiled).toBeGreaterThan(300);
    expect(withValues).toBeGreaterThan(200);
  });
});
