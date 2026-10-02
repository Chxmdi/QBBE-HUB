import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { toCatalog } from "@/lib/query/catalog";
import { createLensT } from "@/features/lenses/i18n";
import { parseDashboardLayout } from "@/features/lenses/dashboard/schema";
import { parseViewBlockProps, VIEW_LAYOUTS } from "../schema";
import { pickUnitProps, renderUnitLayout, unitLayoutLabel } from "./index";
import {
  barLengths,
  chartData,
  chartIsEmpty,
  chartMeasures,
  chartShares,
  chartSpec,
  chartTotal,
  chartTotalOption,
  linePoints,
  pieSlices,
  readChartSettings,
  settingsFromTotalOption,
  totalsFor,
  type ChartDatum,
} from "./d3-chart";
import { ChartFigure, chartMeasureLabel } from "./d3-chart-view";

const catalog = toCatalog({
  task: {
    key: "task",
    name: { en: "Task", fr: "Tâche" },
    properties: [
      { key: "status", kind: "select", propertyKind: "select", name: { en: "Status", fr: "Statut" }, groupable: true, sortable: true },
      { key: "priority", kind: "select", propertyKind: "select", name: { en: "Priority", fr: "Priorité" }, groupable: true, sortable: true },
      { key: "estimate", kind: "number", propertyKind: "number", name: { en: "Estimate", fr: "Estimation" }, sortable: true },
      { key: "title", kind: "text", propertyKind: "text", name: { en: "Title", fr: "Titre" }, sortable: true },
    ],
  },
  note: { key: "note", name: { en: "Note", fr: "Note" }, properties: [{ key: "title", kind: "text", propertyKind: "text", name: { en: "Title", fr: "Titre" } }] },
});
const task = catalog.task;
const en = createLensT("en");
const fr = createLensT("fr-CA");

const chartProps = (chart?: unknown) => ({ version: 2, source: { type: "task" }, layout: "chart", ...(chart === undefined ? {} : { chart }) });

describe("D3-1: the chart layout and its settings", () => {
  it("adds a Chart layout to the view block, named in both languages", () => {
    expect(VIEW_LAYOUTS).toContain("chart");
    expect(unitLayoutLabel("chart", en)).toBe("Chart");
    expect(unitLayoutLabel("chart", fr)).toBe("Graphique");
    expect(renderUnitLayout({ layout: "chart" } as never)).not.toBeUndefined();
  });

  it("stores bar, line, pie or a single number, by count, sum or average", () => {
    for (const kind of ["bar", "line", "pie", "number"]) {
      expect(parseViewBlockProps(chartProps({ kind }))?.chart).toEqual({ kind, total: "count" });
      expect(parseViewBlockProps(chartProps({ kind, total: "sum", property: "estimate" }))?.chart).toEqual({ kind, total: "sum", property: "estimate" });
      if (kind !== "pie") expect(parseViewBlockProps(chartProps({ kind, total: "avg", property: "estimate" }))?.chart).toEqual({ kind, total: "avg", property: "estimate" });
    }
    // Averages are not parts of a whole, so a pie never shows one.
    expect(parseViewBlockProps(chartProps({ kind: "pie", total: "avg", property: "estimate" }))).toBeNull();
    // No settings yet: a bar chart of counts.
    expect(parseViewBlockProps(chartProps())?.chart).toBeUndefined();
    expect(readChartSettings(undefined)).toEqual({ kind: "bar", total: "count" });
    expect(pickUnitProps(parseViewBlockProps(chartProps({ kind: "pie" })))).toEqual({ chart: { kind: "pie", total: "count" } });
  });

  it("refuses settings it cannot draw", () => {
    expect(parseViewBlockProps(chartProps({ kind: "radar" }))).toBeNull();
    expect(parseViewBlockProps(chartProps({ kind: "bar", total: "median", property: "estimate" }))).toBeNull();
    expect(parseViewBlockProps(chartProps({ kind: "bar", total: "sum" }))).toBeNull();
    expect(parseViewBlockProps(chartProps({ kind: "bar", total: "count", property: "estimate" }))).toBeNull();
    expect(parseViewBlockProps(chartProps({ kind: "bar", total: "sum", property: "Robert'); drop table" }))).toBeNull();
    expect(parseViewBlockProps(chartProps({ kind: "bar", extra: 1 }))).toBeNull();
    expect(readChartSettings({ kind: "radar" })).toEqual({ kind: "bar", total: "count" });
  });

  it("asks lens_aggregate for exactly one total", () => {
    expect(chartMeasures({ kind: "bar", total: "count" })).toEqual([{ fn: "count" }]);
    expect(chartMeasures({ kind: "pie", total: "sum", property: "estimate" })).toEqual([{ fn: "sum", property: "estimate" }]);
    expect(chartMeasures({ kind: "line", total: "avg", property: "estimate" })).toEqual([{ fn: "avg", property: "estimate" }]);
  });

  it("round-trips the settings pickers' Total choice", () => {
    expect(settingsFromTotalOption("line", "avg:estimate")).toEqual({ kind: "line", total: "avg", property: "estimate" });
    // A pie shows parts of a whole: an average becomes a count.
    expect(settingsFromTotalOption("pie", "avg:estimate")).toEqual({ kind: "pie", total: "count" });
    expect(settingsFromTotalOption("pie", "sum:estimate")).toEqual({ kind: "pie", total: "sum", property: "estimate" });
    expect(totalsFor("pie")).toEqual(["count", "sum"]);
    expect(totalsFor("bar")).toEqual(["count", "sum", "avg"]);
    expect(settingsFromTotalOption("bar", "sum:")).toEqual({ kind: "bar", total: "count" });
    expect(settingsFromTotalOption("bar", "nonsense")).toEqual({ kind: "bar", total: "count" });
    expect(chartTotalOption({ kind: "bar", total: "sum", property: "estimate" })).toBe("sum:estimate");
    expect(chartTotalOption({ kind: "bar", total: "count" })).toBe("count");
  });

  it("totals the view's own filters, grouped by the view's Group by", () => {
    const where = { and: [{ property: "title", operator: "starts_with" as const, value: "x" }] };
    const spec = { version: 1 as const, type: "task", where, groupBy: { property: "priority" }, sort: [{ property: "title", direction: "asc" as const }], select: ["status"], limit: 50, offset: 0 };
    expect(chartSpec(spec, { kind: "bar", total: "count" }, task, "status")).toEqual({ version: 1, type: "task", where, groupBy: { property: "priority" } });
    // A single number has no groups.
    expect(chartSpec(spec, { kind: "number", total: "sum", property: "estimate" }, task)).toEqual({ version: 1, type: "task", where });
    // No grouping chosen: the type's default, else the chart asks for one.
    expect(chartSpec({ version: 1, type: "task" }, { kind: "pie", total: "count" }, task, "status")).toEqual({ version: 1, type: "task", groupBy: { property: "status" } });
    expect(chartSpec({ version: 1, type: "note" }, { kind: "bar", total: "count" }, catalog.note)).toBe("needsGroup");
    expect(chartSpec({ version: 1, type: "task", groupBy: { property: "title" } }, { kind: "bar", total: "count" }, task)).toBe("needsGroup");
    // A grouping the view chose but the chart cannot use is reported, never swapped for the default.
    expect(chartSpec({ version: 1, type: "task", groupBy: { property: "title" } }, { kind: "bar", total: "count" }, task, "status")).toBe("needsGroup");
    // A sum of something that is not a number is never sent.
    expect(chartSpec(spec, { kind: "bar", total: "sum", property: "title" }, task)).toBe("invalid");
    expect(chartSpec(spec, { kind: "bar", total: "avg", property: "missing" }, task)).toBe("invalid");
  });

  it("reads one datum per group from the engine's totals", () => {
    const result = {
      groups: [
        { key: "high", label: null, totals: { m0: 3 } },
        { key: null, label: null, totals: { m0: null } },
        { key: "low", label: null, totals: { m0: "2.5" } },
      ],
      totals: { m0: 5.5 },
    };
    const data = chartData(result, (key) => (key === null ? "Not set" : key.toUpperCase()));
    expect(data).toEqual([
      { key: "high", label: "HIGH", value: 3 },
      { key: "", label: "Not set", value: null },
      { key: "low", label: "LOW", value: 2.5 },
    ]);
    expect(chartTotal(result)).toBe(5.5);
    expect(chartIsEmpty(data)).toBe(false);
    expect(chartIsEmpty([])).toBe(true);
    expect(chartIsEmpty([{ key: "a", label: "A", value: null }])).toBe(true);
  });

  it("names the total in both languages", () => {
    const estimate = task.properties.find((p) => p.key === "estimate");
    expect(chartMeasureLabel({ kind: "bar", total: "count" }, undefined, "en", en)).toBe("Count");
    expect(chartMeasureLabel({ kind: "bar", total: "sum", property: "estimate" }, estimate, "en", en)).toBe("Sum of Estimate");
    expect(chartMeasureLabel({ kind: "bar", total: "avg", property: "estimate" }, estimate, "fr-CA", fr)).toBe("Moyenne de Estimation");
  });

  it("keeps the dashboard's chart tiles: old ones as bar counts, new ones with the same settings (D3-2)", () => {
    const source = { spec: { version: 1, type: "task" } };
    const layout = parseDashboardLayout({
      tiles: [
        { id: "t1", kind: "chart", source, groupBy: "status" },
        { id: "t2", kind: "chart", source, groupBy: "priority", chart: { kind: "pie", total: "sum", property: "estimate" } },
      ],
    });
    expect(layout.tiles).toMatchObject([
      { kind: "chart", chart: { kind: "bar", total: "count" } },
      { kind: "chart", chart: { kind: "pie", total: "sum", property: "estimate" } },
    ]);
    expect(parseDashboardLayout({ tiles: [{ id: "t3", kind: "chart", source, groupBy: "status", chart: { kind: "bar", total: "sum" } }] }).tiles).toEqual([]);
  });
});

describe("chart geometry", () => {
  const data: ChartDatum[] = [
    { key: "a", label: "A", value: 4 },
    { key: "b", label: "B", value: 2 },
    { key: "c", label: "C", value: null },
    { key: "d", label: "D", value: -1 },
  ];

  it("scales bars to the largest magnitude", () => {
    expect(barLengths(data)).toEqual([100, 50, 0, 25]);
    expect(barLengths([{ key: "z", label: "Z", value: 0 }])).toEqual([0]);
  });

  it("places line points in equal columns, leaving empty totals out", () => {
    const points = linePoints(data, 400, 100, 0);
    expect(points.map((p) => p.datum.key)).toEqual(["a", "b", "d"]);
    expect(points.map((p) => p.x)).toEqual([50, 150, 350]);
    expect(points[0].y).toBe(0);
    expect(points[2].y).toBe(100);
  });

  it("shares a pie out of positive totals, folding past eight slices into Other, never reusing a hue", () => {
    const many: ChartDatum[] = Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, value: i + 1 }));
    const slices = pieSlices(many, "Other");
    expect(slices).toHaveLength(8);
    expect(slices.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(slices[0]).toMatchObject({ key: "k10", value: 11 });
    expect(slices[7]).toMatchObject({ key: "__other", label: "Other", value: 1 + 2 + 3 + 4 });
    expect(slices.reduce((s, x) => s + x.percent, 0)).toBeCloseTo(100);
    expect(slices[1].offset).toBeCloseTo(slices[0].percent);
    expect(pieSlices(data, "Other").map((s) => s.key)).toEqual(["a", "b"]);
    expect(pieSlices([], "Other")).toEqual([]);
    // The table's shares match the drawing, including groups folded into Other.
    const shares = chartShares(many);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    expect(shares.slice(0, 4).reduce((a, b) => a + b, 0)).toBeCloseTo(slices[7].percent);
    expect(chartShares(data)).toEqual([(4 / 6) * 100, (2 / 6) * 100, 0, 0]);
  });
});

describe("D3-4: every chart has a text alternative and works in both themes", () => {
  const data: ChartDatum[] = [
    { key: "high", label: "High", value: 1234.5 },
    { key: "", label: "Not set", value: null },
  ];
  const render = (kind: "bar" | "line" | "pie" | "number", locale: "en" | "fr-CA" = "en") =>
    renderToStaticMarkup(
      React.createElement(ChartFigure, { kind, data, total: 1234.5, measureLabel: "Count", groupLabel: "Priority", locale, t: locale === "en" ? en : fr }),
    );

  it("draws decoratively and writes every number in a table", () => {
    for (const kind of ["bar", "line", "pie"] as const) {
      const html = render(kind);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toMatch(/<table[^>]*data-chart-table/);
      expect(html).toContain(`<caption class="sr-only">${en(`units.d3.kinds.${kind}`)}: Count by Priority</caption>`);
      expect(html).toMatch(/<th scope="row"[^>]*>High<\/th><td[^>]*>1,234.5<\/td>/);
      expect(html).toMatch(/<th scope="row"[^>]*>Not set<\/th><td[^>]*>No value<\/td>/);
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain("Show the numbers");
    }
    const number = render("number");
    expect(number).toContain("data-chart-number");
    expect(number).toMatch(/<th scope="row"[^>]*>Count<\/th><td[^>]*>1,234.5<\/td>/);
  });

  it("writes the numbers in French", () => {
    const html = render("pie", "fr-CA");
    expect(html).toContain("Graphique circulaire : Count par Priority");
    expect(html).toMatch(/1\s234,5/);
    expect(html).toContain("Afficher les chiffres");
  });

  it("colours only from theme tokens, with a dark step for every pie hue", () => {
    for (const kind of ["bar", "line", "pie", "number"] as const) expect(render(kind)).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    const css = readFileSync(join(__dirname, "d3-chart.css"), "utf8");
    const block = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));
    for (let slot = 1; slot <= 8; slot += 1) {
      expect(block("[data-chart]")).toMatch(new RegExp(`--chart-s${slot}: #[0-9a-f]{6}`));
      expect(block(".dark [data-chart]")).toMatch(new RegExp(`--chart-s${slot}: #[0-9a-f]{6}`));
    }
  });
});
