import { describe, expect, it } from "vitest";
import type { QuerySpec } from "@/lib/objects/contracts";
import { toCatalog, type LensCatalog } from "./catalog";
import { createLensRunQuery, fromContractSpec, toQueryResult } from "./contract-adapter";
import { isQueryRefusal, QueryError } from "./errors";
import type { LensResult } from "./run";
import { migrationCatalog } from "./testing/migration-catalog";

const catalog: LensCatalog = toCatalog({
  task: {
    key: "task",
    name: { en: "Task", fr: "Tâche" },
    properties: [
      { key: "title", kind: "text", propertyKind: "text", name: { en: "Title", fr: "Titre" }, sortable: true },
      { key: "status", kind: "select", propertyKind: "status", name: { en: "Status", fr: "Statut" }, groupable: true, choices: [] },
      { key: "assignee", kind: "person", propertyKind: "person", name: { en: "A", fr: "A" }, ref: { table: "user_profile", label: "full_name" } },
      { key: "due", kind: "date", propertyKind: "date", name: { en: "Due", fr: "Échéance" }, sortable: true },
      { key: "estimate", kind: "number", propertyKind: "number", name: { en: "E", fr: "E" } },
      { key: "project", kind: "relation", propertyKind: "relation", target: "project", name: { en: "P", fr: "P" }, groupable: true },
      { key: "tags", kind: "multi_select", propertyKind: "multi_select", name: { en: "T", fr: "T" } },
      { key: "done", kind: "checkbox", propertyKind: "checkbox", name: { en: "D", fr: "D" } },
      { key: "review_role", kind: "person", propertyKind: "person", name: { en: "R", fr: "R" }, filterOnly: true },
    ],
  },
  project: {
    key: "project",
    name: { en: "Project", fr: "Projet" },
    properties: [
      { key: "stage", kind: "select", propertyKind: "status", name: { en: "S", fr: "É" } },
      { key: "program", kind: "select", propertyKind: "relation", name: { en: "Pg", fr: "Pg" }, ref: { table: "program", label: "name" } },
    ],
  },
});

const task = (spec: Omit<QuerySpec, "version" | "types">): QuerySpec => ({ version: 1, types: ["task"], ...spec });
const where = (filter: QuerySpec["filter"]) => fromContractSpec(task({ filter }), catalog).where;

describe("fromContractSpec", () => {
  it("maps contract operators onto the engine's", () => {
    const spec = fromContractSpec(
      {
        version: 1,
        types: ["task"],
        filter: {
          and: [
            { property: "status", op: "in", value: ["ready", "blocked"] },
            { property: "assignee", op: "eq", value: { relative: "me" } },
            { property: "due", op: "lte", value: { relative: "this_week" } },
            { property: "due", op: "eq", value: { relative: "days_from_today", days: 2 } },
            { property: "estimate", op: "gt", value: 3 },
            { property: "title", op: "contains", value: "grant" },
            { property: { via: ["project"], property: "stage" }, op: "eq", value: "active" },
          ],
        },
        sorts: [{ property: "due", direction: "asc" }],
        groupBy: "status",
        properties: ["status", "due", "status"],
        limit: 50,
        cursor: "50",
      },
      catalog,
      { timeZone: "America/Toronto", now: () => new Date("2026-10-05T15:00:00Z") },
    );
    expect(spec).toEqual({
      version: 1,
      type: "task",
      where: {
        and: [
          { property: "status", operator: "is_any_of", value: ["ready", "blocked"] },
          { property: "assignee", operator: "contains", value: { relative: "me" } },
          { property: "due", operator: "on_or_before", value: { relative: "this_week" } },
          { property: "due", operator: "is", value: { date: "2026-10-07" } },
          { property: "estimate", operator: "gt", value: 3 },
          { property: "title", operator: "contains", value: "grant" },
          { property: "project", operator: "matches", value: { where: { and: [{ property: "stage", operator: "is", value: "active" }] } } },
        ],
      },
      sort: [{ property: "due", direction: "asc" }],
      groupBy: { property: "status" },
      select: ["status", "due"],
      limit: 50,
      offset: 50,
    });
  });

  it("maps the operators the engine spells differently", () => {
    expect(where({ property: "due", op: "neq", value: "2026-10-05" })).toEqual({
      or: [
        { property: "due", operator: "before", value: { date: "2026-10-05" } },
        { property: "due", operator: "after", value: { date: "2026-10-05" } },
      ],
    });
    expect(where({ property: "due", op: "gt", value: { relative: "today" } })).toEqual({
      and: [{ property: "due", operator: "after", value: { relative: "today" } }],
    });
    expect(where({ property: "assignee", op: "in", value: ["u1", "u2"] })).toEqual({
      or: [
        { property: "assignee", operator: "contains", value: "u1" },
        { property: "assignee", operator: "contains", value: "u2" },
      ],
    });
    expect(where({ property: "project", op: "in", value: ["p1"] })).toEqual({
      and: [{ property: "project", operator: "contains", value: "p1" }],
    });
    expect(where({ property: "project", op: "neq", value: "p1" })).toEqual({
      and: [{ property: "project", operator: "not_contains", value: "p1" }],
    });
    expect(where({ property: "title", op: "in", value: ["a", "b"] })).toEqual({
      or: [
        { property: "title", operator: "equals", value: "a" },
        { property: "title", operator: "equals", value: "b" },
      ],
    });
    expect(where({ property: "tags", op: "contains", value: "grant" })).toEqual({
      and: [{ property: "tags", operator: "has_any", value: ["grant"] }],
    });
    expect(where({ property: "tags", op: "neq", value: "grant" })).toEqual({
      and: [{ property: "tags", operator: "has_none", value: ["grant"] }],
    });
    expect(where({ property: "done", op: "eq", value: false })).toEqual({
      and: [{ property: "done", operator: "is", value: false }],
    });
    expect(where({ property: "assignee", op: "is_empty" })).toEqual({ and: [{ property: "assignee", operator: "is_empty" }] });
    expect(where({ or: [{ property: "status", op: "eq", value: "ready" }, { property: "status", op: "neq", value: "done" }] })).toEqual({
      or: [
        { property: "status", operator: "is", value: "ready" },
        { property: "status", operator: "is_not", value: "done" },
      ],
    });
  });

  it("pages with the engine's defaults and limits", () => {
    expect(fromContractSpec(task({}), catalog)).toMatchObject({ limit: 100, offset: 0 });
    expect(fromContractSpec(task({ limit: 0 }), catalog).limit).toBe(1);
    expect(fromContractSpec(task({ limit: 5000 }), catalog).limit).toBe(1000);
  });
});

describe("what the adapter refuses", () => {
  const refused = (spec: QuerySpec, code: string) => {
    let caught: unknown;
    try {
      fromContractSpec(spec, catalog);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect((caught as QueryError).code, JSON.stringify(spec)).toBe(code);
    expect(isQueryRefusal(caught)).toBe(true);
  };

  it("another spec version", () => refused({ version: 2 as 1, types: ["task"] }, "invalid_spec"));
  it("several types in one query", () => refused({ version: 1, types: ["task", "project"] }, "invalid_spec"));
  it("no type at all", () => refused({ version: 1, types: [] }, "invalid_spec"));
  it("a type the engine does not know", () => refused({ version: 1, types: ["meeting"] }, "unknown_type"));
  it("a space scope", () => refused(task({ spaceIds: ["x"] }), "invalid_spec"));
  it("a parent scope", () => refused(task({ parentObjectId: "x" }), "invalid_spec"));
  it("a property the type does not have", () => refused(task({ filter: { property: "nope", op: "eq", value: 1 } }), "unknown_property"));
  it("ordering text", () => refused(task({ filter: { property: "title", op: "lt", value: "a" } }), "bad_operator"));
  it("text with a number", () => refused(task({ filter: { property: "title", op: "eq", value: 1 } }), "bad_value"));
  it("a number compared with text", () => refused(task({ filter: { property: "estimate", op: "eq", value: "3" } }), "bad_value"));
  it("contains on a number", () => refused(task({ filter: { property: "estimate", op: "contains", value: 3 } }), "bad_operator"));
  it("a list on a date", () => refused(task({ filter: { property: "due", op: "in", value: ["2026-01-01"] } }), "bad_operator"));
  it("me on a date", () => refused(task({ filter: { property: "due", op: "eq", value: { relative: "me" } } }), "bad_value"));
  it("today on a person", () => refused(task({ filter: { property: "assignee", op: "eq", value: { relative: "today" } } }), "bad_value"));
  it("ordering a person", () => refused(task({ filter: { property: "assignee", op: "lt", value: "u1" } }), "bad_operator"));
  it("an empty list", () => refused(task({ filter: { property: "status", op: "in", value: [] } }), "bad_value"));
  it("a list with a number in it", () => refused(task({ filter: { property: "status", op: "in", value: ["a", 1] } }), "bad_value"));
  it("contains on a select", () => refused(task({ filter: { property: "status", op: "contains", value: "re" } }), "bad_operator"));
  it("a relation compared with a number", () => refused(task({ filter: { property: "project", op: "eq", value: 1 } }), "bad_value"));
  it("ordering a relation", () => refused(task({ filter: { property: "project", op: "gt", value: "p1" } }), "bad_operator"));
  it("a checkbox with text", () => refused(task({ filter: { property: "done", op: "eq", value: "yes" } }), "bad_value"));
  it("a checkbox with neq", () => refused(task({ filter: { property: "done", op: "neq", value: true } }), "bad_operator"));
  it("a relation path two steps deep", () =>
    refused(task({ filter: { property: { via: ["project", "program"], property: "name" }, op: "eq", value: "x" } }), "too_complex"));
  it("a path through something that is not a relation", () =>
    refused(task({ filter: { property: { via: ["status"], property: "x" }, op: "eq", value: "x" } }), "unknown_property"));
  it("a path through a reference the engine shows but cannot traverse", () =>
    refused({ version: 1, types: ["project"], filter: { property: { via: ["program"], property: "name" }, op: "eq", value: "x" } }, "unknown_property"));
  it("sorting through a relation", () =>
    refused(task({ sorts: [{ property: { via: ["project"], property: "stage" }, direction: "asc" }] }), "too_complex"));
  it("grouping through a relation", () => refused(task({ groupBy: { via: ["project"], property: "stage" } }), "too_complex"));
  it("a cursor that is not an offset", () => refused(task({ cursor: "-1" }), "invalid_spec"));
  it("a cursor that is not a number", () => refused(task({ cursor: "abc" }), "invalid_spec"));

  it("tells a refusal apart from a failure", () => {
    expect(isQueryRefusal(new QueryError("failed", "x"))).toBe(false);
    expect(isQueryRefusal(new QueryError("signed_out", "x"))).toBe(false);
    expect(isQueryRefusal(new Error("x"))).toBe(false);
  });
});

describe("toQueryResult", () => {
  it("returns contract rows, groups in order, and a cursor", () => {
    const result: LensResult = {
      type: "task",
      columns: [],
      groupBy: "status",
      rows: [
        { id: "1", title: "A", group: "ready", values: { assignee: { id: "u1", label: "Ada" }, project: { id: "p1", label: "P" }, estimate: 2, due: "2026-10-01", done: true } },
        { id: "2", title: "B", group: "blocked", values: { assignee: null, project: null, estimate: null, due: null, done: false } },
      ],
      total: 3,
      groups: [
        { key: "ready", label: null, total: 1 },
        { key: "blocked", label: null, total: 2 },
      ],
      limit: 2,
      offset: 0,
    };
    const out = toQueryResult(result, catalog);
    expect(out.rows[0]).toEqual({
      ref: { id: "1", type: "task" },
      title: "A",
      values: {
        assignee: { kind: "person", value: ["u1"] },
        project: { kind: "relation", value: [{ id: "p1", type: "project" }] },
        estimate: { kind: "number", value: 2 },
        due: { kind: "date", value: "2026-10-01" },
        done: { kind: "checkbox", value: true },
      },
    });
    expect(out.rows[1].values.assignee).toBeNull();
    expect(out.groups).toEqual([
      { key: "ready", rowIds: ["1"] },
      { key: "blocked", rowIds: ["2"] },
    ]);
    expect(out.nextCursor).toBe("2");
  });

  it("shows a referenced row (a program) as a relation to its table", () => {
    const result: LensResult = {
      type: "project",
      columns: [],
      groupBy: null,
      rows: [{ id: "p1", title: "P", group: null, values: { program: { id: "g1", label: "G" }, stage: "active" } }],
      total: 1,
      groups: null,
      limit: 100,
      offset: 0,
    };
    expect(toQueryResult(result, catalog).rows[0].values).toEqual({
      program: { kind: "relation", value: [{ id: "g1", type: "program" }] },
      stage: { kind: "status", value: "active" },
    });
    expect(toQueryResult(result, catalog).nextCursor).toBeNull();
  });
});

describe("createLensRunQuery", () => {
  it("runs the converted spec through the viewer's client and returns contract rows", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const client = {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        calls.push([fn, args]);
        const result: LensResult = {
          type: "task",
          columns: [],
          groupBy: null,
          rows: [{ id: "1", title: "A", group: null, values: { status: "ready" } }],
          total: 1,
          groups: null,
          limit: 10,
          offset: 0,
        };
        return Promise.resolve({ data: result, error: null });
      },
    };
    const run = createLensRunQuery(client, catalog, { timeZone: "America/Toronto" });
    const out = await run(task({ properties: ["status"], limit: 10, filter: { property: "status", op: "eq", value: "ready" } }));
    expect(calls).toEqual([
      [
        "lens_query",
        {
          spec: {
            version: 1,
            type: "task",
            where: { and: [{ property: "status", operator: "is", value: "ready" }] },
            select: ["status"],
            limit: 10,
            offset: 0,
          },
          time_zone: "America/Toronto",
        },
      ],
    ]);
    expect(out).toEqual({ rows: [{ ref: { id: "1", type: "task" }, title: "A", values: { status: { kind: "status", value: "ready" } } }], groups: undefined, nextCursor: null });
  });

  it("turns a database refusal into a QueryError with the database's code", async () => {
    const client = { rpc: () => Promise.resolve({ data: null, error: { message: "lens:unknown_type: Unknown type." } }) };
    const run = createLensRunQuery(client, catalog);
    await expect(run(task({}))).rejects.toMatchObject({ name: "QueryError", code: "unknown_type" });
  });
});

describe("the engine's real catalog", () => {
  const real = migrationCatalog();

  it("knows every type the screens query", () => {
    expect(Object.keys(real).sort()).toEqual(["activity", "decision", "document", "meeting", "milestone", "project", "risk", "task"]);
    for (const type of Object.values(real)) {
      expect(type.properties.find((p) => p.key === "title"), type.key).toBeDefined();
      for (const property of type.properties) {
        if (property.kind === "relation") expect(real[property.target!], `${type.key}.${property.key}`).toBeDefined();
      }
    }
  });

  it("orders newest first when the spec has no sorts, as the stand-in did", () => {
    // An app's lens screen and dashboard tiles send no sorts (apps/schema.ts
    // has no field for one); without this the engine's id order showed an
    // arbitrary page instead of the latest records.
    for (const type of Object.keys(real)) {
      expect(fromContractSpec({ version: 1, types: [type], limit: 5 }, real).sort, type).toEqual([
        { property: "created_time", direction: "desc" },
      ]);
    }
    expect(fromContractSpec({ version: 1, types: ["task"], sorts: [{ property: "due", direction: "asc" }] }, real).sort).toEqual([
      { property: "due", direction: "asc" },
    ]);
    // A type that cannot sort by its creation time gets no default.
    expect(fromContractSpec(task({ limit: 5 }), catalog).sort).toBeUndefined();
  });

  it("accepts a filter, sort and select on each new type", () => {
    const now = () => new Date("2026-10-05T15:00:00Z");
    expect(fromContractSpec({ version: 1, types: ["decision"], filter: { property: "project", op: "eq", value: "p" }, sorts: [{ property: "decided_time", direction: "desc" }], properties: ["decided_time", "meeting"] }, real, { now })).toMatchObject({ type: "decision" });
    expect(fromContractSpec({ version: 1, types: ["meeting"], filter: { property: "starts", op: "gte", value: { relative: "today" } }, sorts: [{ property: "starts", direction: "asc" }] }, real, { now })).toMatchObject({ type: "meeting" });
    expect(fromContractSpec({ version: 1, types: ["milestone"], filter: { property: "status", op: "in", value: ["planned", "missed"] } }, real)).toMatchObject({ type: "milestone" });
    expect(fromContractSpec({ version: 1, types: ["document"], filter: { property: "kind", op: "eq", value: "file" }, sorts: [{ property: "edited_time", direction: "desc" }] }, real)).toMatchObject({ type: "document" });
    expect(fromContractSpec({ version: 1, types: ["activity"], filter: { property: "source_type", op: "eq", value: "task" }, properties: ["source_id", "created_time"] }, real)).toMatchObject({ type: "activity" });
    expect(fromContractSpec({ version: 1, types: ["risk"], filter: { property: "likelihood", op: "eq", value: "high" }, sorts: [{ property: "score", direction: "desc" }] }, real)).toMatchObject({ type: "risk" });
  });
});
