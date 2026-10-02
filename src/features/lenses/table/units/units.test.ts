import { describe, expect, it } from "vitest";
import type { CatalogProperty } from "@/lib/query/catalog";
import { d2ColumnItems, d2HasTotalsRow } from "./d2-totals";

const prop = (key: string, kind: string) => ({ key, kind }) as unknown as CatalogProperty;

describe("table unit slots", () => {
  it("shows a totals row only when a number column is shown", () => {
    const properties = new Map([
      ["title", prop("title", "text")],
      ["estimate", prop("estimate", "number")],
    ]);
    expect(d2HasTotalsRow([{ key: "title", width: 100, hidden: false }] as never, properties)).toBe(false);
    expect(d2HasTotalsRow([{ key: "title" }, { key: "estimate" }] as never, properties)).toBe(true);
  });

  it("adds no column menu entries until D2 does", () => {
    expect(d2ColumnItems({} as never)).toEqual([]);
  });
});
