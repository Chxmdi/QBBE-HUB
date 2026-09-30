import { describe, expect, it } from "vitest";
import { compileLens, likeEscape, QueryError, type CompiledQuery } from "./compile";
import { catalog, ctx, propId, PROJECT_TYPE, TASK_TYPE, VIEWER } from "./fixtures";

const compile = (spec: object) => compileLens({ version: 1, type: "task", ...spec }, catalog, ctx);
const where = (...conditions: object[]) => compile({ where: { and: conditions } });

function rejects(spec: object, code: QueryError["code"]) {
  let error: unknown;
  try {
    compile(spec);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(QueryError);
  expect((error as QueryError).code).toBe(code);
}

/** Every placeholder $1..$n is used and none points past the values list. */
export function expectPlaceholdersMatch(q: CompiledQuery) {
  const used = new Set([...q.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  expect([...used].sort((a, b) => a - b)).toEqual(q.values.map((_, i) => i + 1));
}

describe("compileLens: shape", () => {
  it("scopes every statement to the type and hides archived objects", () => {
    const lens = compile({});
    for (const q of [lens.page, lens.count]) {
      expect(q.text).toContain("o.type_id = $1::uuid and o.archived_at is null");
      expect(q.values[0]).toBe(TASK_TYPE);
      expectPlaceholdersMatch(q);
    }
    expect(lens.groups).toBeUndefined();
  });

  it("applies defaults: 100 rows, offset 0, stable id tie-break", () => {
    const lens = compile({});
    expect(lens.spec.limit).toBe(100);
    expect(lens.page.values.slice(-2)).toEqual([100, 0]);
    expect(lens.page.text).toContain("o.id asc");
  });

  it("binds a custom property by id, never by name", () => {
    const lens = where({ property: "estimate", operator: "gt", value: 5 });
    expect(lens.count.values).toEqual([TASK_TYPE, 5, propId("estimate")]);
    expect(lens.count.text).not.toContain("estimate");
    expect(lens.count.text).toContain("v0.value_number > $2::numeric");
  });

  it("keeps and/or nesting", () => {
    const lens = compile({
      where: {
        or: [
          { property: "approved", operator: "is", value: true },
          { and: [{ property: "points", operator: "gte", value: 3 }, { property: "points", operator: "lte", value: 8 }] },
        ],
      },
    });
    expect(lens.count.text).toMatch(/\(exists .* or \(exists .* and exists .*\)\)/);
    expectPlaceholdersMatch(lens.count);
  });

  it("does not let a custom property shadow a system one", () => {
    const lens = where({ property: "title", operator: "contains", value: "x" });
    expect(lens.count.text).toContain("o.title ilike");
  });
});

describe("compileLens: operators per kind", () => {
  it("text", () => {
    expect(where({ property: "notes", operator: "equals", value: "a" }).count.text).toContain("value_text = $2::text");
    const nc = where({ property: "notes", operator: "not_contains", value: "50%_off" });
    expect(nc.count.text).toMatch(/^.*not exists \(select 1 from wos_spike.property_value v0 .* ilike \$2::text escape '\\'\)/);
    expect(nc.count.values[1]).toBe("%50\\%\\_off%");
    expect(where({ property: "title", operator: "starts_with", value: "Plan" }).count.values[1]).toBe("Plan%");
    expect(where({ property: "title", operator: "is_empty" }).count.text).toContain("(o.title is null or o.title = '')");
  });

  it("number", () => {
    const b = where({ property: "estimate", operator: "between", value: { from: 1, to: 2.5 } });
    expect(b.count.text).toContain("value_number between $2::numeric and $3::numeric");
    expect(where({ property: "estimate", operator: "neq", value: 3 }).count.text).toMatch(/not exists .*value_number = \$2/);
  });

  it("date: fixed and relative, in the viewer's zone", () => {
    const d = where({ property: "due", operator: "is", value: { relative: "today" } });
    expect(d.count.values.slice(1, 3)).toEqual(["2026-09-30", "2026-09-30"]);
    const w = where({ property: "due", operator: "on_or_after", value: { relative: "this_week" } });
    expect(w.count.values[1]).toBe("2026-09-28");
    const f = where({ property: "due", operator: "before", value: { date: "2026-01-15" } });
    expect(f.count.text).toContain("v0.value_date < $2::date");
    const between = where({
      property: "due",
      operator: "between",
      value: { from: { date: "2026-01-01" }, to: { relative: "next_week" } },
    });
    expect(between.count.values.slice(1, 3)).toEqual(["2026-01-01", "2026-10-11"]);
  });

  it("date on a timestamp column compares whole days in the viewer's zone", () => {
    const lens = where({ property: "created_at", operator: "on_or_before", value: { date: "2026-09-30" } });
    expect(lens.count.text).toContain("o.created_at < ($2::date::timestamp at time zone $3::text)");
    expect(lens.count.values.slice(1)).toEqual(["2026-10-01", "America/Toronto"]);
  });

  it("select only accepts defined options; space accepts ids", () => {
    const lens = where({ property: "stage", operator: "is_none_of", value: ["done", "backlog"] });
    expect(lens.count.text).toMatch(/not exists .*value_text = any\(\$2::text\[\]\)/);
    expect(lens.count.values[1]).toEqual(["done", "backlog"]);
    rejects({ where: { and: [{ property: "stage", operator: "is", value: "archived" }] } }, "bad_value");
    const space = where({ property: "space", operator: "is", value: PROJECT_TYPE });
    expect(space.count.text).toContain("(o.space_id = $2::uuid)");
    rejects({ where: { and: [{ property: "space", operator: "is", value: "not-an-id" }] } }, "bad_value");
  });

  it("multi-select any / all / none", () => {
    const any = where({ property: "tags", operator: "has_any", value: ["finance", "youth"] });
    expect(any.count.text).toContain("(v0.value_json @> $2::jsonb or v0.value_json @> $3::jsonb)");
    expect(any.count.values.slice(1, 3)).toEqual(['["finance"]', '["youth"]']);
    const all = where({ property: "tags", operator: "has_all", value: ["finance", "youth"] });
    expect(all.count.values[1]).toBe('["finance","youth"]');
    expect(where({ property: "tags", operator: "has_none", value: ["board"] }).count.text).toMatch(/^.*not exists/);
  });

  it("person resolves me from the session, not the spec", () => {
    const lens = where({ property: "reviewers", operator: "contains", value: { relative: "me" } });
    expect(lens.count.values[1]).toBe(JSON.stringify([VIEWER]));
    const owner = where({ property: "owner", operator: "not_contains", value: { relative: "me" } });
    expect(owner.count.text).toContain("(o.owner_id is null or not (o.owner_id = $2::uuid))");
    expect(owner.count.values[1]).toBe(VIEWER);
  });

  it("checkbox false includes never-set values", () => {
    expect(where({ property: "approved", operator: "is", value: false }).count.text).toMatch(/not exists .* and v0.value_bool\)/);
    rejects({ where: { and: [{ property: "approved", operator: "is", value: "true" }] } }, "bad_value");
  });

  it("relation: contains, empty, and one level of matches", () => {
    const c = where({ property: "project", operator: "contains", value: PROJECT_TYPE });
    expect(c.count.text).toContain("r0.to_id = $3::uuid");
    expect(where({ property: "project", operator: "is_empty" }).count.text).toContain("not exists (select 1 from wos_spike.object_relation r0");
    const m = where({
      property: "project",
      operator: "matches",
      value: { where: { and: [{ property: "space", operator: "is", value: TASK_TYPE }, { property: "phase", operator: "is", value: "run" }] } },
    });
    expect(m.count.text).toContain("join wos_spike.object t1 on t1.id = r0.to_id");
    expect(m.count.text).toContain("t1.space_id = $2::uuid");
    expect(m.count.values).toContain(propId("phase", PROJECT_TYPE));
    expect(m.count.values).toContain(PROJECT_TYPE);
    expectPlaceholdersMatch(m.count);
  });
});

describe("compileLens: sort, group, select", () => {
  it("sorts selects by option order, then by the next key, then id", () => {
    const lens = compile({ sort: [{ property: "priority", direction: "desc" }, { property: "title" }] });
    expect(lens.page.text).toContain("order by array_position($3::text[], s0.value_text) desc nulls last, o.title asc nulls last, o.id asc");
    expect(lens.page.values[2]).toEqual(["low", "medium", "high", "urgent"]);
    expectPlaceholdersMatch(lens.page);
  });

  it("groups first, and returns group counts", () => {
    const lens = compile({ groupBy: { property: "stage" }, sort: [{ property: "due" }] });
    expect(lens.page.text).toMatch(/order by array_position\(\$\d+::text\[\], g.value_text\) asc nulls last, s0.value_date asc/);
    expect(lens.groups!.text).toMatch(/^select g.value_text as group_key, count\(\*\)::int as total /);
    expectPlaceholdersMatch(lens.groups!);
    expect(compile({ groupBy: { property: "space" } }).groups!.text).toContain("select o.space_id::text as group_key");
  });

  it("returns only the selected custom properties", () => {
    const lens = compile({ select: ["stage", "project", "title"] });
    expect(lens.columns.map((c) => c.key)).toEqual(["stage", "project", "title"]);
    expect(lens.page.values).toContainEqual([propId("stage")]);
    expect(lens.page.values).toContainEqual([propId("project")]);
    expectPlaceholdersMatch(lens.page);
  });

  it("rejects keys that cannot sort or group", () => {
    rejects({ sort: [{ property: "tags" }] }, "not_sortable");
    rejects({ sort: [{ property: "project" }] }, "not_sortable");
    rejects({ sort: [{ property: "owner" }] }, "not_sortable");
    rejects({ groupBy: { property: "notes" } }, "not_groupable");
    rejects({ groupBy: { property: "tags" } }, "not_groupable");
    rejects({ groupBy: { property: "due" } }, "not_groupable");
  });
});

describe("compileLens: rejects", () => {
  it("unknown types, properties and operators", () => {
    rejects({ type: "invoice" }, "unknown_type");
    rejects({ where: { and: [{ property: "salary", operator: "gt", value: 1 }] } }, "unknown_property");
    rejects({ where: { and: [{ property: "estimate", operator: "contains", value: "1" }] } }, "bad_operator");
    rejects({ where: { and: [{ property: "notes", operator: "gt", value: 1 }] } }, "bad_operator");
    rejects({ where: { and: [{ property: "notes", operator: "drop", value: 1 }] } }, "invalid_spec");
    rejects({ select: ["salary"] }, "unknown_property");
    rejects({ sort: [{ property: "salary" }] }, "unknown_property");
  });

  it("values of the wrong type", () => {
    rejects({ where: { and: [{ property: "estimate", operator: "gt", value: "5" }] } }, "bad_value");
    rejects({ where: { and: [{ property: "due", operator: "is", value: { date: "2026-02-30" } }] } }, "invalid_spec");
    rejects({ where: { and: [{ property: "due", operator: "is", value: "2026-02-03" }] } }, "bad_value");
    rejects({ where: { and: [{ property: "reviewers", operator: "contains", value: "bob" }] } }, "bad_value");
    rejects({ where: { and: [{ property: "notes", operator: "is_empty", value: "x" }] } }, "bad_value");
    rejects({ where: { and: [{ property: "tags", operator: "has_any", value: [] }] } }, "bad_value");
    rejects({ where: { and: [{ property: "estimate", operator: "gt", value: Number.NaN }] } }, "invalid_spec");
  });

  it("anything over the limits, and a second level of relation filters", () => {
    const many = Array.from({ length: 51 }, () => ({ property: "points", operator: "gt", value: 1 }));
    rejects({ where: { and: many } }, "invalid_spec");
    const deep = { and: [{ or: [{ and: [{ or: [{ and: [{ property: "points", operator: "gt", value: 1 }] }] }] }] }] };
    rejects({ where: deep }, "too_complex");
    rejects({ limit: 201 }, "invalid_spec");
    rejects({ sort: [{ property: "title" }, { property: "due" }, { property: "points" }, { property: "estimate" }] }, "invalid_spec");
    rejects({ where: { and: [{ property: "notes", operator: "equals", value: "x".repeat(501) }] } }, "invalid_spec");
    rejects(
      {
        where: {
          and: [
            {
              property: "project",
              operator: "matches",
              value: { where: { and: [{ property: "project", operator: "matches", value: { where: { and: [] } } }] } },
            },
          ],
        },
      },
      "invalid_spec",
    );
  });

  it("the second level of matches even when the target type relates back", () => {
    // Give Project a relation to itself, so a nested matches is well-formed and
    // only the one-level rule can stop it.
    const self = new Map(catalog);
    const project = catalog.get("project")!;
    const props = new Map(project.properties);
    props.set("parent", { source: "custom", id: PROJECT_TYPE, key: "parent", kind: "relation", name: { en: "", fr: "" }, options: [], targetType: "project" });
    self.set("project", { ...project, properties: props });
    const inner = { and: [{ property: "phase", operator: "is", value: "run" }] };
    const spec = {
      version: 1,
      type: "task",
      where: { and: [{ property: "project", operator: "matches", value: { where: { and: [{ property: "parent", operator: "matches", value: { where: inner } }] } } }] },
    };
    expect(() => compileLens(spec, self, ctx)).toThrow(/one level/);
  });

  it("unknown keys anywhere in the spec", () => {
    rejects({ raw: "select 1" }, "invalid_spec");
    rejects({ sort: [{ property: "title", direction: "asc", nulls: "first; drop" }] }, "invalid_spec");
    rejects({ where: { and: [{ property: "notes", operator: "equals", value: "x", sql: "1=1" }] } }, "invalid_spec");
    rejects({ where: { and: [{ property: "notes", operator: "equals", value: "x" }], or: [] } }, "invalid_spec");
  });

  it("a bad viewer or time zone in the context", () => {
    expect(() => compileLens({ version: 1, type: "task" }, catalog, { ...ctx, viewerId: "x' or 1=1" })).toThrow(QueryError);
    expect(() => compileLens({ version: 1, type: "task" }, catalog, { ...ctx, timeZone: "UTC'; --" })).toThrow(QueryError);
  });
});

describe("likeEscape", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(likeEscape("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });
});
