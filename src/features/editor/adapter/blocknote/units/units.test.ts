import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { editorUnitBlockSpecs, mergeUnitOptions } from "./index";
import { BlockFallback, LazyBlockForTest } from "./test-exports";
import { BlockErrorBoundary, framed } from "../block-frame";
import { createEditorT } from "@/features/editor/i18n";

describe("wave 2 editor unit slots", () => {
  it("merges unit options in order, later units winning, and merges collaboration", () => {
    const merged = mergeUnitOptions([
      { pasteHandler: "a", collaboration: { user: { name: "x" } } },
      { pasteHandler: "b", other: 1 },
      { collaboration: { provider: "p" } },
    ]);
    expect(merged).toEqual({ pasteHandler: "b", other: 1, collaboration: { user: { name: "x" }, provider: "p" } });
  });

  it("merges nothing to nothing", () => {
    expect(mergeUnitOptions([{}, {}])).toEqual({});
  });

  it("adds no block specs until a unit does", () => {
    expect(editorUnitBlockSpecs(createEditorT("en"), "en")).toEqual({});
  });
});

describe("the block frame", () => {
  it("shows the fallback after an error and the block again after retry", () => {
    const fallback = vi.fn(() => "fallback");
    const boundary = new BlockErrorBoundary({ type: "embed", blockId: "b1", children: "block", fallback });
    expect(boundary.render()).toBe("block");
    boundary.state = { ...boundary.state, ...BlockErrorBoundary.getDerivedStateFromError() };
    expect(boundary.render()).toBe("fallback");
    const setState = vi.spyOn(boundary, "setState").mockImplementation((next) => {
      boundary.state = { ...boundary.state, ...(next as object) };
    });
    boundary.retry();
    expect(setState).toHaveBeenCalledWith({ failed: false });
    expect(boundary.render()).toBe("block");
  });

  it("reports a block's error instead of swallowing it", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    new BlockErrorBoundary({ type: "query", blockId: "b2", children: null, fallback: () => null }).componentDidCatch(new Error("boom"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("query (b2)"), expect.any(Error));
    log.mockRestore();
  });

  it("keeps the implementation's other keys and wraps its render", () => {
    const toExternalHTML = () => null;
    const impl = { render: () => React.createElement("span", null, "inner"), toExternalHTML };
    const wrapped = framed("bookmark", impl as never) as unknown as typeof impl;
    expect(wrapped.toExternalHTML).toBe(toExternalHTML);
    expect(wrapped.render).not.toBe(impl.render);
  });

  it("renders a readable fallback with a retry button", () => {
    const html = renderToStaticMarkup(
      React.createElement(BlockFallback, {
        type: "embed",
        blockId: "b1",
        labels: { message: "This block could not be shown.", retry: "Try again" },
        onRetry: () => {},
      }),
    );
    expect(html).toContain('role="note"');
    expect(html).toContain("This block could not be shown.");
    expect(html).toContain("<button");
    expect(html).toContain("Try again");
  });

  it("renders blocks at once until E5 says otherwise", () => {
    expect(renderToStaticMarkup(React.createElement(LazyBlockForTest as React.FC<{ type: string; blockId: string; children?: React.ReactNode }>, { type: "query", blockId: "b1" }, "inner"))).toBe("inner");
  });

  it("has the fallback words in both languages", () => {
    expect(createEditorT("en")("units.e3.fallback.retry")).toBe("Try again");
    expect(createEditorT("fr-CA")("units.e3.fallback.retry")).toBe("Réessayer");
  });
});
