import { describe, expect, it } from "vitest";
import { BASE_VIEW_LAYOUTS, VIEW_LAYOUTS } from "../schema";
import { pickUnitProps, renderUnitLayout, unitLayoutLabel, UNIT_PROP_KEYS } from "./index";
import { createLensT } from "@/features/lenses/i18n";
import { D3_LAYOUTS, d3PropsShape } from "./d3.ids";
import { D4_LAYOUTS, d4PropsShape } from "./d4.ids";

describe("view block layout slots", () => {
  it("adds exactly the units' layouts and props", () => {
    expect([...VIEW_LAYOUTS]).toEqual([...BASE_VIEW_LAYOUTS, ...D3_LAYOUTS, ...D4_LAYOUTS]);
    expect(UNIT_PROP_KEYS).toEqual([...Object.keys(d3PropsShape), ...Object.keys(d4PropsShape)]);
    expect(pickUnitProps({ layout: "table", title: "Not a unit prop" })).toEqual({});
    expect(pickUnitProps({ layout: "table", unknown: { kind: "bar" } })).toEqual({});
    expect(pickUnitProps(null)).toEqual({});
  });

  it("leaves the block's own layouts to the block", () => {
    const t = createLensT("en");
    for (const layout of BASE_VIEW_LAYOUTS) {
      expect(unitLayoutLabel(layout, t)).toBeNull();
      // D4 draws the gallery (with its cover); the other base layouts stay the block's.
      if (layout === "gallery") continue;
      expect(renderUnitLayout({ layout } as never)).toBeUndefined();
    }
  });

  it("never repeats a layout id", () => {
    expect(new Set(VIEW_LAYOUTS).size).toBe(VIEW_LAYOUTS.length);
  });
});
