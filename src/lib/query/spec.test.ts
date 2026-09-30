import { describe, expect, it } from "vitest";
import { QueryError, queryErrorFrom } from "./errors";
import { parseLensSpec, runLens, type RpcClient } from "./run";
import { LIMITS, type LensNode } from "./spec";

/** Payloads from the W0-8 spike: quote breaks, statements, comments, casts, NUL. */
export const PAYLOADS = [
  "'",
  "''; drop table task; --",
  "\"; select 1; --",
  "x' or '1'='1",
  "1; delete from task",
  "/* comment */",
  "-- comment",
  "$1",
  "$$ select 1 $$",
  "e'\\x27'",
  "::text",
  "set role service_role",
  "ｓｅｌｅｃｔ",
  "status\u0000",
  "%",
  "_",
  "\\",
  "a".repeat(501),
];

const base = { version: 1, type: "task" } as const;

function rejects(input: unknown) {
  expect(() => parseLensSpec(input)).toThrow(QueryError);
}

describe("lens spec parsing", () => {
  it("accepts the spike's example shape", () => {
    const spec = parseLensSpec({
      version: 1,
      type: "task",
      where: {
        and: [
          { property: "status", operator: "is_any_of", value: ["ready", "in_progress"] },
          {
            or: [
              { property: "due", operator: "is", value: { relative: "this_week" } },
              { property: "assignee", operator: "contains", value: { relative: "me" } },
            ],
          },
          {
            property: "project",
            operator: "matches",
            value: { where: { and: [{ property: "stage", operator: "is", value: "active" }] } },
          },
        ],
      },
      sort: [{ property: "due", direction: "asc" }, { property: "title" }],
      groupBy: { property: "priority" },
      select: ["status", "priority", "due", "project"],
      limit: 100,
      offset: 0,
    });
    expect(spec.type).toBe("task");
  });

  it("rejects unknown keys at every level", () => {
    rejects({ ...base, extra: 1 });
    rejects({ ...base, where: { and: [{ property: "title", operator: "equals", value: "x", extra: 1 }] } });
    rejects({ ...base, where: { and: [], extra: 1 } });
    rejects({ ...base, sort: [{ property: "title", direction: "asc", nulls: "first" }] });
    rejects({ ...base, groupBy: { property: "status", extra: true } });
  });

  it("rejects wrong versions, sizes and limits", () => {
    rejects({ ...base, version: 2 });
    rejects({ ...base, limit: 0 });
    rejects({ ...base, limit: LIMITS.maxPageSize + 1 });
    rejects({ ...base, limit: 1.5 });
    rejects({ ...base, offset: -1 });
    rejects({ ...base, offset: LIMITS.maxOffset + 1 });
    rejects({ ...base, sort: new Array(4).fill({ property: "title" }) });
    rejects({ ...base, select: new Array(31).fill("title") });
    rejects({ ...base, where: { and: [] } });
  });

  it("rejects too many conditions and too deep nesting", () => {
    const cond = { property: "title", operator: "contains", value: "a" } as const;
    rejects({ ...base, where: { or: [{ and: new Array(26).fill(cond) }, { and: new Array(26).fill(cond) }] } });
    let deep: LensNode = cond;
    for (let i = 0; i < 5; i += 1) deep = { and: [deep] };
    rejects({ ...base, where: deep });
  });

  describe("injection payloads in every field", () => {
    // Identifiers (type, property names, operator, direction) must match the
    // slug pattern or the operator list, so every payload is refused.
    for (const payload of PAYLOADS) {
      it(`refuses ${JSON.stringify(payload).slice(0, 30)} as an identifier`, () => {
        rejects({ ...base, type: payload });
        rejects({ ...base, where: { and: [{ property: payload, operator: "equals", value: "x" }] } });
        rejects({ ...base, where: { and: [{ property: "title", operator: payload, value: "x" }] } });
        rejects({ ...base, sort: [{ property: payload }] });
        rejects({ ...base, sort: [{ property: "title", direction: payload }] });
        rejects({ ...base, groupBy: { property: payload } });
        rejects({ ...base, select: [payload] });
        rejects({ ...base, [payload]: 1 });
        rejects({ ...base, limit: payload });
        rejects({ ...base, offset: payload });
        rejects({ ...base, version: payload });
        rejects({
          ...base,
          where: {
            and: [
              { property: "project", operator: "matches", value: { where: { and: [{ property: payload, operator: "equals", value: "x" }] } } },
            ],
          },
        });
        rejects({ ...base, where: { and: [{ property: "due", operator: "is", value: { date: payload } }] } });
        rejects({ ...base, where: { and: [{ property: "due", operator: "is", value: { relative: payload } }] } });
      });
    }

    it("passes value payloads through only as data, or refuses them", () => {
      for (const payload of PAYLOADS) {
        const spec = { ...base, where: { and: [{ property: "title", operator: "contains", value: payload }] } };
        if (payload.includes("\u0000") || payload.length > LIMITS.maxString) {
          rejects(spec);
        } else {
          // Accepted as a value: the database binds it (proven in the DB suite).
          expect(parseLensSpec(spec).where).toEqual(spec.where);
        }
      }
    });
  });
});

describe("runLens", () => {
  const ok = (data: unknown): RpcClient => ({ rpc: async () => ({ data, error: null }) });

  it("calls lens_query with the parsed spec and the viewer's time zone", async () => {
    const calls: unknown[] = [];
    const client: RpcClient = {
      rpc: async (fn, args) => {
        calls.push([fn, args]);
        return { data: { type: "task", columns: [], groupBy: null, rows: [], total: 0, groups: null, limit: 100, offset: 0 }, error: null };
      },
    };
    await runLens(client, base, { timeZone: "America/Montreal" });
    expect(calls).toEqual([["lens_query", { spec: base, time_zone: "America/Montreal" }]]);
  });

  it("never sends a spec that fails parsing", async () => {
    let called = false;
    const client: RpcClient = { rpc: async () => ((called = true), { data: null, error: null }) };
    await expect(runLens(client, { ...base, type: "x'; --" })).rejects.toThrow(QueryError);
    expect(called).toBe(false);
  });

  it("maps database refusals to their code and hides other errors", async () => {
    const refused: RpcClient = {
      rpc: async () => ({ data: null, error: { message: 'lens:unknown_property: Unknown property on type "task".' } }),
    };
    await expect(runLens(refused, base)).rejects.toMatchObject({ code: "unknown_property" });
    const broken: RpcClient = { rpc: async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }) };
    await expect(runLens(broken, base)).rejects.toMatchObject({ code: "failed", message: "The lens could not be loaded." });
    expect(queryErrorFrom({ message: "lens:not_a_code: x" }).code).toBe("failed");
  });

  it("normalises missing arrays", async () => {
    const result = await runLens(ok({ type: "task", rows: null, total: 0, groups: null, limit: 100, offset: 0 }), base);
    expect(result.rows).toEqual([]);
    expect(result.columns).toEqual([]);
  });
});
