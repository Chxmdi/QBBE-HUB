import { describe, expect, it } from "vitest";
import { lensSpecSchema } from "@/lib/query/spec";
import { calendarPath, composeSpec, parseViewBlockProps, readStoredViewBlock, VIEW_BLOCK_LIMITS } from "./schema";

const LENS = "11111111-1111-4111-8111-111111111111";

describe("view block props", () => {
  it("accept a type or a saved lens, with defaults", () => {
    const byType = parseViewBlockProps({ version: 2, source: { type: "task" } });
    expect(byType).toEqual({
      version: 2,
      source: { type: "task" },
      layout: "table",
      where: [],
      sort: [],
      fields: [],
      pageFilters: { enabled: false, paths: [] },
      maxRows: VIEW_BLOCK_LIMITS.defaultRows,
    });
    const byLens = parseViewBlockProps({
      version: 2,
      source: { lensId: LENS },
      layout: "board",
      title: " Open work ",
      where: [{ path: "status", op: "is_none_of", value: ["completed", "cancelled"] }, { path: "assignee", op: "contains", value: { relative: "me" } }],
      sort: [{ path: "due" }],
      groupBy: { path: "status" },
      fields: ["status", "due"],
      pageFilters: { enabled: true, paths: ["assignee"] },
      maxRows: 20,
    });
    expect(byLens?.title).toBe("Open work");
    expect(byLens?.sort).toEqual([{ path: "due", direction: "asc" }]);
    expect(byLens?.layout).toBe("board");
  });

  it("refuse anything the engine would refuse, instead of guessing", () => {
    expect(parseViewBlockProps(null)).toBeNull();
    expect(parseViewBlockProps({ version: 1, source: { type: "task" } })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "x'; drop" } })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { lensId: "not-an-id" } })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task", lensId: LENS } })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, layout: "map" })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, maxRows: 5000 })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, fields: Array.from({ length: 9 }, (_, i) => `f${i}`) })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, sort: [{ path: "a" }, { path: "b" }, { path: "c" }, { path: "d" }] })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, extra: 1 })).toBeNull();
    // Nested groups and `matches` belong to another unit: a flat list only.
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, where: [{ path: "project", op: "matches", value: { where: { and: [] } } }] })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, where: [{ and: [] }] })).toBeNull();
    // Values go through the engine's rules: a NUL byte, a bad relative date, a bad date.
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, where: [{ path: "title", op: "contains", value: "a\u0000b" }] })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, where: [{ path: "due", op: "is", value: { relative: "someday" } }] })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, where: [{ path: "due", op: "is", value: { date: "2026-02-30" } }] })).toBeNull();
  });

  it("tell a stored view block from the legacy preset spec", () => {
    expect(readStoredViewBlock(JSON.stringify({ version: 2, source: { type: "task" } }))).toEqual({ kind: "view", raw: { version: 2, source: { type: "task" } } });
    expect(readStoredViewBlock({ version: 2 })).toEqual({ kind: "view", raw: { version: 2 } });
    expect(readStoredViewBlock(JSON.stringify({ version: 1, types: ["task"] }))).toEqual({ kind: "legacy" });
    expect(readStoredViewBlock("{nope")).toEqual({ kind: "legacy" });
    expect(readStoredViewBlock("")).toEqual({ kind: "legacy" });
    expect(readStoredViewBlock(null)).toEqual({ kind: "legacy" });
  });
});

describe("composeSpec", () => {
  const props = parseViewBlockProps({
    version: 2,
    source: { lensId: LENS },
    layout: "board",
    where: [{ path: "priority", op: "is", value: "high" }],
    fields: ["status", "due"],
    maxRows: 30,
  })!;
  const base = lensSpecSchema.parse({
    version: 1,
    type: "task",
    where: { and: [{ property: "title", operator: "starts_with", value: "Run" }] },
    sort: [{ property: "title", direction: "desc" }],
    select: ["priority"],
  });

  it("ANDs the lens, the block and the run-time conditions and keeps the lens's sort", () => {
    const spec = composeSpec({ type: "task", base, props, extra: [{ path: "assignee", op: "contains", value: { relative: "me" } }] });
    expect(spec).toEqual({
      version: 1,
      type: "task",
      where: {
        and: [
          { and: [{ property: "title", operator: "starts_with", value: "Run" }] },
          { property: "priority", operator: "is", value: "high" },
          { property: "assignee", operator: "contains", value: { relative: "me" } },
        ],
      },
      sort: [{ property: "title", direction: "desc" }],
      groupBy: { property: "status" },
      select: ["status", "due"],
      limit: 30,
      offset: 0,
    });
    expect(lensSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("never changes the saved lens's spec", () => {
    const snapshot = JSON.stringify(base);
    composeSpec({ type: "task", base, props, extra: [{ path: "status", op: "is", value: "ready" }] });
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("falls back to the type's facts, groups a board by status and caps rows", () => {
    const plain = parseViewBlockProps({ version: 2, source: { type: "task" }, layout: "board", maxRows: 200 })!;
    const spec = composeSpec({ type: "task", props: plain, extra: [] });
    expect(spec.where).toBeUndefined();
    expect(spec.groupBy).toEqual({ property: "status" });
    expect(spec.select).toEqual(["status", "priority", "due", "assignee", "project"]);
    expect(spec.limit).toBe(VIEW_BLOCK_LIMITS.maxRows);
    const list = composeSpec({ type: "task", props: { ...plain, layout: "list" }, extra: [] });
    expect(list.groupBy).toBeUndefined();
    const grouped = composeSpec({ type: "project", props: { ...plain, groupBy: { path: "health" }, fields: ["stage"] }, extra: [] });
    expect(grouped.groupBy).toEqual({ property: "health" });
    expect(grouped.select).toEqual(["stage", "health"]);
  });

  it("picks the calendar date from the block's fields, then the type's default", () => {
    const dates = ["start", "due", "completed_time"];
    expect(calendarPath({ fields: ["status", "start"], sort: [] }, "task", dates)).toBe("start");
    expect(calendarPath({ fields: ["status"], sort: [{ path: "due", direction: "asc" }] }, "task", dates)).toBe("due");
    expect(calendarPath({ fields: [], sort: [] }, "task", dates)).toBe("due");
    expect(calendarPath({ fields: [], sort: [] }, "other", dates)).toBe("start");
    expect(calendarPath({ fields: [], sort: [] }, "task", [])).toBeNull();
  });
});
