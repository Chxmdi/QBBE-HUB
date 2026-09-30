import { describe, expect, it } from "vitest";
import { parseQueryBlockProps } from "./schema";

describe("query block props", () => {
  it("accept a saved lens or an inline spec, with defaults", () => {
    expect(parseQueryBlockProps({ source: { lensId: "11111111-1111-4111-8111-111111111111" } })).toEqual({
      source: { lensId: "11111111-1111-4111-8111-111111111111" },
      view: "table",
      maxRows: 25,
    });
    const inline = parseQueryBlockProps({ source: { spec: { version: 1, type: "task" } }, view: "list", maxRows: 10, title: " Mine " });
    expect(inline?.title).toBe("Mine");
    expect(inline?.view).toBe("list");
  });

  it("refuse anything else instead of guessing", () => {
    expect(parseQueryBlockProps(null)).toBeNull();
    expect(parseQueryBlockProps({ source: { lensId: "not-an-id" } })).toBeNull();
    expect(parseQueryBlockProps({ source: { spec: { version: 1, type: "x'; drop" } } })).toBeNull();
    expect(parseQueryBlockProps({ source: { spec: { version: 1, type: "task" }, lensId: "11111111-1111-4111-8111-111111111111" } })).toBeNull();
    expect(parseQueryBlockProps({ source: { lensId: "11111111-1111-4111-8111-111111111111" }, maxRows: 5000 })).toBeNull();
    expect(parseQueryBlockProps({ source: { lensId: "11111111-1111-4111-8111-111111111111" }, view: "map" })).toBeNull();
    expect(parseQueryBlockProps({ source: { lensId: "11111111-1111-4111-8111-111111111111" }, extra: 1 })).toBeNull();
  });
});
