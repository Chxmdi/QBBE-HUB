import { describe, expect, it } from "vitest";
import type { CatalogProperty } from "@/lib/query/catalog";
import { d2ColumnItems, d2HasTotalsRow } from "./d2-totals";
import { useD1Grid } from "./d1-grid";

const prop = (key: string, kind: string) => ({ key, kind }) as unknown as CatalogProperty;

describe("table unit slots", () => {
  it("shows a totals row whenever a column is shown, since every column can count (D2)", () => {
    const properties = new Map([
      ["title", prop("title", "text")],
      ["estimate", prop("estimate", "number")],
    ]);
    expect(d2HasTotalsRow([], properties)).toBe(false);
    expect(d2HasTotalsRow([{ key: "title", width: 100, hidden: false }] as never, properties)).toBe(true);
    expect(d2HasTotalsRow([{ key: "title" }, { key: "estimate" }] as never, properties)).toBe(true);
  });

  it("adds no column menu entries for someone who cannot manage columns (D2), and handles no grid keys until D1 does", () => {
    expect(d2ColumnItems({ type: { key: "task", name: { en: "", fr: "" }, properties: [] }, property: prop("status", "select") } as never)).toEqual([]);
    const handlers = useD1Grid({} as never);
    expect(handlers.onKeyDown).toBeUndefined();
    expect(handlers.onCopy).toBeUndefined();
    expect(handlers.onPaste).toBeUndefined();
  });
});
