import { describe, expect, it } from "vitest";
import { toCatalog, type LensCatalog } from "./catalog";
import { fromContractSpec, toQueryResult } from "./contract-adapter";
import { QueryError } from "./errors";
import type { LensResult } from "./run";

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
    ],
  },
  project: {
    key: "project",
    name: { en: "Project", fr: "Projet" },
    properties: [{ key: "stage", kind: "select", propertyKind: "status", name: { en: "S", fr: "É" } }],
  },
});

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
        properties: ["status", "due"],
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

  it("refuses what the engine does not support instead of ignoring it", () => {
    expect(() => fromContractSpec({ version: 1, types: ["task", "project"] }, catalog)).toThrow(QueryError);
    expect(() => fromContractSpec({ version: 1, types: ["task"], spaceIds: ["x"] }, catalog)).toThrow(QueryError);
    expect(() => fromContractSpec({ version: 1, types: ["meeting"] }, catalog)).toThrow(QueryError);
    expect(() =>
      fromContractSpec({ version: 1, types: ["task"], filter: { property: "nope", op: "eq", value: 1 } }, catalog),
    ).toThrow(QueryError);
    expect(() =>
      fromContractSpec({ version: 1, types: ["task"], filter: { property: "title", op: "lt", value: "a" } }, catalog),
    ).toThrow(QueryError);
    expect(() => fromContractSpec({ version: 1, types: ["task"], cursor: "-1" }, catalog)).toThrow(QueryError);
  });
});

describe("toQueryResult", () => {
  it("returns contract rows, groups in order, and a cursor", () => {
    const result: LensResult = {
      type: "task",
      columns: [],
      groupBy: "status",
      rows: [
        { id: "1", title: "A", group: "ready", values: { assignee: { id: "u1", label: "Ada" }, project: { id: "p1", label: "P" }, estimate: 2, due: "2026-10-01" } },
        { id: "2", title: "B", group: "blocked", values: { assignee: null, project: null, estimate: null, due: null } },
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
      },
    });
    expect(out.groups).toEqual([
      { key: "ready", rowIds: ["1"] },
      { key: "blocked", rowIds: ["2"] },
    ]);
    expect(out.nextCursor).toBe("2");
  });
});
