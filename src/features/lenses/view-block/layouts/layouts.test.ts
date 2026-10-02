import { describe, expect, it } from "vitest";
import { BASE_VIEW_LAYOUTS, VIEW_LAYOUTS } from "../schema";
import { pickUnitProps, renderUnitLayout, unitLayoutLabel, UNIT_PROP_KEYS } from "./index";
import { createLensT } from "@/features/lenses/i18n";

describe("view block layout slots", () => {
  it("adds no layouts or props until D3 or D4 does", () => {
    expect([...VIEW_LAYOUTS]).toEqual([...BASE_VIEW_LAYOUTS]);
    expect(UNIT_PROP_KEYS).toEqual([]);
    expect(pickUnitProps({ layout: "table", chart: { kind: "bar" } })).toEqual({});
    expect(pickUnitProps(null)).toEqual({});
  });

  it("leaves the block's own layouts to the block", () => {
    const t = createLensT("en");
    for (const layout of BASE_VIEW_LAYOUTS) {
      expect(unitLayoutLabel(layout, t)).toBeNull();
      expect(renderUnitLayout({ layout } as never)).toBeUndefined();
    }
  });

  it("never repeats a layout id", () => {
    expect(new Set(VIEW_LAYOUTS).size).toBe(VIEW_LAYOUTS.length);
  });
});
