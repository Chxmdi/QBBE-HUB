import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createLensT } from "@/features/lenses/i18n";
import { lensesEn, lensesFrCA } from "@/features/lenses/i18n";
import type { CatalogProperty, LensCatalog } from "@/lib/query/catalog";
import type { LensRow } from "@/lib/query/run";
import { composeSpec, parseViewBlockProps, VIEW_LAYOUTS, type ParsedViewBlockProps } from "../schema";
import { layoutName } from "../view-config";
import { mergeLocalFilters } from "../local-filters";
import { pickUnitProps, renderUnitLayout, UnitLayoutSettings } from "./index";
import type { LayoutRenderContext } from "./types";
import { coverPath, d4Columns, feedPath, timelinePaths, withD4Columns, D4_LAYOUTS } from "./d4.ids";
import { coverKey, coverTone, feedGroups, monthTicks, nextIndex, placeBar, timelineItems, timelineSpan } from "./d4-model";

const prop = (key: string, kind: CatalogProperty["kind"], extra: Partial<CatalogProperty> = {}): CatalogProperty => ({
  key,
  kind,
  propertyKind: kind as CatalogProperty["propertyKind"],
  name: { en: key[0].toUpperCase() + key.slice(1), fr: `fr ${key}` },
  sortable: true,
  groupable: kind === "select" || kind === "person",
  ...extra,
});

const TASK_PROPS: CatalogProperty[] = [
  prop("title", "text"),
  prop("status", "select", { choices: [{ key: "ready", label: { en: "Ready", fr: "Prête" } }, { key: "blocked", label: { en: "Blocked", fr: "Bloquée" } }] }),
  prop("assignee", "person", { ref: { table: "user_profile", label: "full_name" } }),
  prop("review_role", "person", { filterOnly: true }),
  prop("start", "date"),
  prop("due", "date"),
  prop("edited_time", "date", { timestamp: true }),
  prop("created_time", "date", { timestamp: true }),
];
const CATALOG: LensCatalog = { task: { key: "task", name: { en: "Task", fr: "Tâche" }, properties: TASK_PROPS } };

const row = (id: string, values: LensRow["values"]): LensRow => ({ id, title: `Task ${id}`, group: null, values });

function block(extra: Record<string, unknown>): ParsedViewBlockProps {
  const parsed = parseViewBlockProps({ version: 2, source: { type: "task" }, ...extra });
  if (!parsed) throw new Error("bad props");
  return parsed;
}

function ctx(props: ParsedViewBlockProps, rows: LensRow[], locale: "en" | "fr-CA" = "en", total = rows.length): LayoutRenderContext {
  return {
    layout: props.layout,
    props,
    data: {
      ok: true,
      type: "task",
      lens: null,
      catalog: CATALOG,
      result: { type: "task", columns: [], groupBy: null, rows, total, groups: null, limit: 50, offset: 0 },
      datePath: null,
      timeZone: "America/Toronto",
    },
    fields: TASK_PROPS.filter((p) => p.key === "status" || p.key === "assignee"),
    locale,
    t: createLensT(locale),
    heading: "Launch",
    anchor: "2026-10-01",
    onAnchor: () => undefined,
  };
}

const render = (c: LayoutRenderContext) => renderToStaticMarkup(React.createElement(React.Fragment, null, renderUnitLayout(c)));
const rowOrder = (html: string) => [...html.matchAll(/data-view-(?:row|card)="([^"]+)"/g)].map((m) => m[1]);

const ROWS = [
  row("a", { start: "2026-10-05", due: "2026-10-09", status: "ready", edited_time: "2026-10-02T14:00:00Z" }),
  row("b", { start: null, due: "2026-10-20", status: "blocked", edited_time: "2026-10-02T09:00:00Z" }),
  row("c", { start: "2026-11-02", due: null, status: null, edited_time: "2026-09-30T12:00:00Z" }),
  row("d", { start: null, due: null, status: "ready", edited_time: null }),
];

describe("D4-1: timeline, gallery and feed in the view block", () => {
  it("offers timeline and feed as layouts, after the block's own, with names in both languages", () => {
    expect(D4_LAYOUTS).toEqual(["timeline", "feed"]);
    for (const layout of ["timeline", "feed", "gallery"]) expect(VIEW_LAYOUTS).toContain(layout);
    expect(layoutName("timeline", createLensT("en"))).toBe("Timeline");
    expect(layoutName("feed", createLensT("en"))).toBe("Feed");
    expect(layoutName("timeline", createLensT("fr-CA"))).toBe("Échéancier");
    expect(layoutName("feed", createLensT("fr-CA"))).toBe("Fil");
    expect(layoutName("gallery", createLensT("en"))).toBe("Gallery");
  });

  it("stores its settings with the block's shared settings and refuses anything else", () => {
    const parsed = block({ layout: "timeline", timeline: { start: "start", end: "due" }, where: [{ path: "status", op: "is", value: "ready" }] });
    expect(parsed.timeline).toEqual({ start: "start", end: "due" });
    expect(pickUnitProps(parsed)).toEqual({ timeline: { start: "start", end: "due" } });
    expect(block({ layout: "gallery", gallery: { cover: "status" } }).gallery).toEqual({ cover: "status" });
    expect(block({ layout: "feed", feed: { date: "due" } }).feed).toEqual({ date: "due" });
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, layout: "timeline", timeline: { start: "start", colour: "red" } })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, layout: "gallery", gallery: { cover: "Bad Key" } })).toBeNull();
    expect(parseViewBlockProps({ version: 2, source: { type: "task" }, layout: "chartz" })).toBeNull();
  });

  it("asks the run for the columns each layout draws, only real properties, within the engine's limit", () => {
    expect(d4Columns(block({ layout: "timeline" }), "task", TASK_PROPS)).toEqual(["start", "due"]);
    expect(d4Columns(block({ layout: "timeline", timeline: { start: "due", end: "edited_time" } }), "task", TASK_PROPS)).toEqual(["due", "edited_time"]);
    expect(d4Columns(block({ layout: "timeline", timeline: { start: "nope" } }), "task", TASK_PROPS)).toEqual(["start", "due"]);
    expect(d4Columns(block({ layout: "feed" }), "task", TASK_PROPS)).toEqual(["edited_time"]);
    expect(d4Columns(block({ layout: "gallery", gallery: { cover: "assignee" } }), "task", TASK_PROPS)).toEqual(["assignee"]);
    expect(d4Columns(block({ layout: "gallery", gallery: { cover: "review_role" } }), "task", TASK_PROPS)).toEqual([]);
    expect(d4Columns(block({ layout: "gallery" }), "task", TASK_PROPS)).toEqual([]);
    expect(d4Columns(block({ layout: "table" }), "task", TASK_PROPS)).toEqual([]);

    const full = { select: Array.from({ length: 30 }, (_, i) => `c${i}`) };
    const widened = withD4Columns(full, block({ layout: "timeline" }), "task", TASK_PROPS);
    expect(widened.select).toHaveLength(30);
    expect(widened.select.slice(-2)).toEqual(["start", "due"]);
    const same = { select: ["status", "due"] };
    expect(withD4Columns(same, block({ layout: "table" }), "task", TASK_PROPS)).toBe(same);
    expect(withD4Columns({ select: ["due"] }, block({ layout: "timeline" }), "task", TASK_PROPS).select).toEqual(["due", "start"]);
  });

  it("shows the settings for the chosen layout only, labelled, in both languages", () => {
    const settings = (layout: string, locale: "en" | "fr-CA" = "en", value: Record<string, unknown> = {}) =>
      renderToStaticMarkup(
        React.createElement(UnitLayoutSettings, { id: "v", layout: layout as never, value, onChange: () => undefined, catalog: CATALOG, type: "task", t: createLensT(locale), locale }),
      );
    const timeline = settings("timeline");
    expect(timeline).toContain('for="v-d4-start"');
    expect(timeline).toContain("Bars start on");
    expect(timeline).toContain("Automatic (Start)");
    expect(timeline).toContain("Automatic (Due)");
    expect(settings("timeline", "fr-CA")).toContain("Les barres commencent le");
    // With Due chosen as the start, the end cannot be Due, and its default says so.
    const dueStart = settings("timeline", "en", { timeline: { start: "due", end: "due" } });
    const endSelect = dueStart.slice(dueStart.indexOf('id="v-d4-end"'));
    expect(endSelect).not.toContain('value="due"');
    expect(endSelect).toContain("No end date");
    expect(endSelect).not.toContain("Automatic (Due)");
    expect(settings("gallery")).toContain("Card cover");
    expect(settings("gallery")).not.toContain("review_role");
    expect(settings("gallery", "en", { gallery: { cover: "status" } })).toMatch(/<option value="status" selected="">/);
    expect(settings("feed")).toContain("Automatic (Edited_time)");
    expect(settings("table")).toBe("");
    expect(settings("board")).toBe("");
  });

  it("has the same strings in English and French", () => {
    const keys = (o: object, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(lensesFrCA.units.d4)).toEqual(keys(lensesEn.units.d4));
    expect(keys(lensesEn.units.d4).length).toBeGreaterThan(20);
  });
});

describe("D4-2: timeline places records by start and end dates", () => {
  it("chooses the type's start and end, else the block's choice", () => {
    expect(timelinePaths({}, "task", TASK_PROPS)).toEqual({ start: "start", end: "due" });
    expect(timelinePaths({ timeline: { start: "due" } }, "task", TASK_PROPS)).toEqual({ start: "due", end: null });
    expect(timelinePaths({ timeline: { end: "start" } }, "task", TASK_PROPS)).toEqual({ start: "start", end: null });
    expect(timelinePaths({}, "thing", [prop("when", "date"), prop("until", "date")])).toEqual({ start: "when", end: "until" });
    expect(timelinePaths({}, "thing", [prop("name", "text")])).toEqual({ start: null, end: null });
    expect(feedPath({}, [prop("due", "date")])).toBe("due");
    expect(feedPath({ feed: { date: "due" } }, TASK_PROPS)).toBe("due");
    expect(coverPath({ gallery: { cover: "start" } }, TASK_PROPS)).toBeNull();
  });

  it("handles missing and reversed dates without dropping a row", () => {
    const items = timelineItems(
      [...ROWS, row("e", { start: "2026-10-12", due: "2026-10-10" })],
      { key: "start", timestamp: false },
      { key: "due", timestamp: false },
      "UTC",
    );
    expect(items.map((i) => [i.row.id, i.start, i.end, i.missing])).toEqual([
      ["a", "2026-10-05", "2026-10-09", "none"],
      ["b", "2026-10-20", "2026-10-20", "start"],
      ["c", "2026-11-02", "2026-11-02", "end"],
      ["d", null, null, "both"],
      ["e", "2026-10-10", "2026-10-12", "none"],
    ]);
    // Times become the reader's calendar day.
    const late = timelineItems([row("t", { edited_time: "2026-10-03T02:00:00Z" })], { key: "edited_time", timestamp: true }, { key: null, timestamp: false }, "America/Toronto");
    expect(late[0]).toMatchObject({ start: "2026-10-02", end: "2026-10-02", missing: "none" });
  });

  it("spans every bar and places each in proportion", () => {
    const items = timelineItems(ROWS, { key: "start", timestamp: false }, { key: "due", timestamp: false }, "UTC");
    const span = timelineSpan(items)!;
    expect(span).toEqual({ from: "2026-10-04", to: "2026-11-03", days: 31 });
    expect(placeBar(span, "2026-10-04", "2026-11-03")).toEqual({ left: 0, width: 100 });
    expect(placeBar(span, "2026-10-05", "2026-10-09")).toEqual({ left: 3.23, width: 16.13 });
    expect(monthTicks(span)).toEqual([
      { day: "2026-10-04", left: 0 },
      { day: "2026-11-01", left: 90.32 },
    ]);
    expect(timelineSpan(items.filter((i) => i.missing === "both"))).toBeNull();
  });

  it("moves between rows by keyboard: arrows, Home, End, Page Up and Down", () => {
    expect(nextIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextIndex("ArrowDown", 2, 3)).toBe(2);
    expect(nextIndex("ArrowUp", 0, 3)).toBe(0);
    expect(nextIndex("ArrowRight", 1, 3)).toBe(2);
    expect(nextIndex("ArrowLeft", 1, 3)).toBe(0);
    expect(nextIndex("Home", 2, 3)).toBe(0);
    expect(nextIndex("End", 0, 3)).toBe(2);
    expect(nextIndex("PageDown", 0, 25)).toBe(10);
    expect(nextIndex("PageUp", 5, 25)).toBe(0);
    expect(nextIndex("a", 0, 3)).toBeNull();
    expect(nextIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("renders one focus stop, a readable name for each bar, and rows without dates in place", () => {
    const html = render(ctx(block({ layout: "timeline" }), ROWS));
    expect(rowOrder(html)).toEqual(["a", "b", "c", "d"]);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Task a: Oct 5, 2026 to Oct 9, 2026"');
    expect(html).toContain('aria-label="Task b: ends Oct 20, 2026, no start date"');
    expect(html).toContain('aria-label="Task c: starts Nov 2, 2026, no end date"');
    expect(html).toContain('aria-label="Task d: no dates"');
    expect(html).toContain('aria-label="Launch timeline"');
    expect(html.match(/data-timeline-bar/g)).toHaveLength(3);
    expect(html).toContain("From Oct 4, 2026 to Nov 3, 2026");

    const fr = render(ctx(block({ layout: "timeline" }), ROWS, "fr-CA"));
    expect(fr).toContain("Échéancier : Launch");
    expect(fr).toContain("Task d : aucune date");

    expect(render(ctx(block({ layout: "timeline" }), []))).toContain("No rows you can see.");
    const undated = render(ctx(block({ layout: "timeline" }), [ROWS[3]]));
    expect(undated).toContain("None of these records have dates yet.");
  });
});

describe("D4-3: every layout shows the table's rows, in the table's order", () => {
  it("adds only columns to the run: the same conditions, page-local filters, sort and limit as the table", () => {
    const shared = {
      where: [{ path: "status", op: "is", value: "ready" }],
      sort: [{ path: "due", direction: "desc" }],
      pageFilters: { enabled: true, paths: ["assignee"] },
      maxRows: 7,
    };
    const local = mergeLocalFilters([], [{ path: "assignee", op: "contains", value: { relative: "me" } }, { path: "title", op: "contains", value: "x" }], ["assignee"]);
    const table = composeSpec({ type: "task", props: block({ layout: "table", ...shared }), extra: local });
    for (const layout of ["timeline", "gallery", "feed"]) {
      const props = block({ layout, ...shared, gallery: { cover: "assignee" } });
      const spec = withD4Columns(composeSpec({ type: "task", props, extra: local }), props, "task", TASK_PROPS);
      const { select: tableSelect, ...tableRest } = table;
      const { select, ...rest } = spec;
      expect(rest).toEqual(tableRest);
      expect(select?.slice(0, tableSelect?.length)).toEqual(tableSelect);
    }
  });

  it("draws every loaded row once, in order, in each layout", () => {
    const shuffled = [ROWS[2], ROWS[0], ROWS[3], ROWS[1]];
    for (const layout of ["timeline", "gallery", "feed"]) {
      const html = render(ctx(block({ layout, gallery: { cover: "status" } }), shuffled, "en", 9));
      expect(rowOrder(html)).toEqual(["c", "a", "d", "b"]);
      expect(html).toContain("5 more");
    }
  });

  it("feed groups consecutive rows by day without reordering them", () => {
    const groups = feedGroups(ROWS, { key: "edited_time", timestamp: true }, "America/Toronto");
    expect(groups.map((g) => [g.day, g.rows.map((r) => r.id)])).toEqual([
      ["2026-10-02", ["a", "b"]],
      ["2026-09-30", ["c"]],
      ["", ["d"]],
    ]);
    const html = render(ctx(block({ layout: "feed" }), ROWS));
    expect(html).toContain('aria-label="Launch feed"');
    expect(html).toContain("No date");
    expect(html.match(/<h4/g)).toHaveLength(3);
    // Each entry shows its time of day in the reader's zone; the day is the heading, said once.
    expect(html).toMatch(/10:00[\s\u202f]a\.m\./);
    expect(html).toMatch(/5:00[\s\u202f]a\.m\./);
    expect(html.match(/Oct 2, 2026/g)).toHaveLength(1);
    // A plain date places entries by day without repeating it on each one.
    const byDue = render(ctx(block({ layout: "feed", feed: { date: "due" } }), ROWS));
    expect(byDue.match(/Oct 9, 2026/g)).toHaveLength(1);
    expect(byDue).not.toMatch(/\d:\d\d/);
  });

  it("gallery covers show the chosen property's value, with a tone that follows the value", () => {
    const html = render(ctx(block({ layout: "gallery", gallery: { cover: "status" } }), ROWS));
    expect(html.match(/data-view-cover="ready"/g)).toHaveLength(2);
    expect(html).toContain('data-view-cover="blocked"');
    expect(html).toContain('data-view-cover=""');
    expect(html).toContain("Status: Ready");
    expect(html).toContain("Status: not set");
    expect(coverTone("ready")).toBe(coverTone("ready"));
    expect(coverTone("ready")).toBeGreaterThanOrEqual(1);
    expect(coverTone("ready")).toBeLessThanOrEqual(6);
    expect(coverKey({ id: "u1", label: "Ana" })).toBe("u1");
    expect(coverKey("")).toBeNull();
    expect(coverKey(null)).toBeNull();
    // Without a cover the gallery has none.
    expect(render(ctx(block({ layout: "gallery" }), ROWS))).not.toContain("data-view-cover");
  });
});
