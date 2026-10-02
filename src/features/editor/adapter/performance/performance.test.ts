import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ESTIMATED_HEIGHT_PX,
  HEIGHTS_STORAGE_KEY,
  REMEMBERED_HEIGHTS_MAX,
  findableText,
  isLazyBlockType,
  placeholderHeight,
  readHeights,
  rememberHeight,
  shouldWait,
  writeHeights,
  type HeightStorage,
} from "./lazy";
import { EDITOR_MARKS, markEditor, readEditorTimings, type MarkPerformance } from "./timings";
import { RESERVED_PX_PER_BLOCK, editorReserve } from "./reserve";
import { LazyBlock } from "@/features/editor/adapter/blocknote/units/e5-performance";
import { createEditorT } from "@/features/editor/i18n";

const viewSpec = (title?: string) => JSON.stringify({ version: 2, source: { type: "task" }, layout: "table", ...(title ? { title } : {}) });

describe("E5-2: which blocks wait until they are near the screen", () => {
  it("holds back view blocks and embeds with an address, nothing else", () => {
    expect(isLazyBlockType("query")).toBe(true);
    expect(isLazyBlockType("embed")).toBe(true);
    for (const type of ["paragraph", "heading", "tableOfContents", "bookmark", "callout", "task", "syncedBlock", "button"]) {
      expect(isLazyBlockType(type)).toBe(false);
      expect(shouldWait({ type, props: {} }, true)).toBe(false);
    }
    expect(shouldWait({ type: "query", props: { spec: viewSpec() } }, true)).toBe(true);
    expect(shouldWait({ type: "embed", props: { url: "https://youtu.be/dQw4w9WgXcQ" } }, true)).toBe(true);
  });

  it("shows an embed's address form at once, since there is nothing to load", () => {
    expect(shouldWait({ type: "embed", props: { url: "" } }, true)).toBe(false);
    expect(shouldWait({ type: "embed", props: { url: "   " } }, true)).toBe(false);
    expect(shouldWait({ type: "embed", props: {} }, true)).toBe(false);
  });

  it("renders everything at once where nothing can tell it when to appear", () => {
    expect(shouldWait({ type: "query", props: { spec: viewSpec() } }, false)).toBe(false);
    expect(shouldWait(null, true)).toBe(false);
  });

  it("keeps the last measured height, or an estimate per type", () => {
    expect(placeholderHeight("query", undefined)).toBe(ESTIMATED_HEIGHT_PX.query);
    expect(placeholderHeight("embed", undefined)).toBe(ESTIMATED_HEIGHT_PX.embed);
    expect(placeholderHeight("query", 412.6)).toBe(413);
    expect(placeholderHeight("embed", 0)).toBe(ESTIMATED_HEIGHT_PX.embed);
    expect(placeholderHeight("embed", Number.NaN)).toBe(ESTIMATED_HEIGHT_PX.embed);
  });
});

describe("E5-2: remembered heights", () => {
  const memoryStorage = (): HeightStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
  };

  it("round-trips through storage", () => {
    const storage = memoryStorage();
    const heights = new Map<string, number>();
    expect(rememberHeight(heights, "a", 130.4)).toBe(true);
    expect(rememberHeight(heights, "b", 354)).toBe(true);
    writeHeights(storage, heights);
    expect(storage.data.has(HEIGHTS_STORAGE_KEY)).toBe(true);
    expect([...readHeights(storage)]).toEqual([
      ["a", 130],
      ["b", 354],
    ]);
  });

  it("ignores the same height, zero and nonsense", () => {
    const heights = new Map<string, number>([["a", 130]]);
    expect(rememberHeight(heights, "a", 130.2)).toBe(false);
    expect(rememberHeight(heights, "a", 0)).toBe(false);
    expect(rememberHeight(heights, "a", Number.POSITIVE_INFINITY)).toBe(false);
    expect(heights.get("a")).toBe(130);
  });

  it("keeps the newest heights only", () => {
    const heights = new Map<string, number>();
    for (let i = 0; i < REMEMBERED_HEIGHTS_MAX + 10; i++) rememberHeight(heights, `b${i}`, 100 + i);
    expect(heights.size).toBe(REMEMBERED_HEIGHTS_MAX);
    expect(heights.has("b0")).toBe(false);
    expect(heights.has(`b${REMEMBERED_HEIGHTS_MAX + 9}`)).toBe(true);
    // Measuring an old block again makes it the newest.
    rememberHeight(heights, "b10", 999);
    rememberHeight(heights, "new", 50);
    expect(heights.has("b10")).toBe(true);
    expect(heights.has("b11")).toBe(false);
  });

  it("survives refused, broken or foreign storage", () => {
    const refusing: HeightStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readHeights(refusing).size).toBe(0);
    expect(() => writeHeights(refusing, new Map([["a", 1]]))).not.toThrow();
    expect(readHeights(null).size).toBe(0);
    const storage = memoryStorage();
    storage.setItem(HEIGHTS_STORAGE_KEY, "{not json");
    expect(readHeights(storage).size).toBe(0);
    storage.setItem(HEIGHTS_STORAGE_KEY, JSON.stringify([["a", 120], ["b", "tall"], [3, 4], ["c", -5], "x"]));
    expect([...readHeights(storage)]).toEqual([["a", 120]]);
  });
});

describe("E5-5: the words a waiting block keeps findable", () => {
  it("is a view's title and an embed's address", () => {
    expect(findableText({ type: "query", props: { spec: viewSpec("  Open grants  ") } })).toBe("Open grants");
    expect(findableText({ type: "embed", props: { url: " https://youtu.be/dQw4w9WgXcQ " } })).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  it("is nothing when there is nothing to show", () => {
    expect(findableText({ type: "query", props: { spec: viewSpec() } })).toBe("");
    expect(findableText({ type: "query", props: { spec: "{broken" } })).toBe("");
    expect(findableText({ type: "query", props: { spec: JSON.stringify({ title: 3 }) } })).toBe("");
    expect(findableText({ type: "embed" })).toBe("");
  });
});

describe("E5-2: the lazy block frame", () => {
  afterEach(() => vi.unstubAllGlobals());

  const render = (type: string) =>
    renderToStaticMarkup(
      React.createElement(LazyBlock as React.FC<{ type: string; blockId: string; children?: React.ReactNode }>, { type, blockId: `block-${type}` }, "real block"),
    );

  it("shows a view block's placeholder, at its estimated height, until it is near the screen", () => {
    vi.stubGlobal("window", { IntersectionObserver: class {} });
    const html = render("query");
    expect(html).not.toContain("real block");
    expect(html).toContain('data-lazy-block="query"');
    expect(html).toContain(`min-height:${ESTIMATED_HEIGHT_PX.query}px`);
    expect(html).toContain(createEditorT("en")("units.e5.waiting.query"));
  });

  it("renders every other block at once", () => {
    vi.stubGlobal("window", { IntersectionObserver: class {} });
    expect(render("callout")).toBe("real block");
    expect(render("tableOfContents")).toBe("real block");
  });

  it("renders at once without an IntersectionObserver", () => {
    expect(render("query")).toBe("real block");
  });

  it("has its words in both languages, with the same keys", () => {
    const en = createEditorT("en");
    const fr = createEditorT("fr-CA");
    for (const type of ["query", "embed"] as const) {
      expect(en(`units.e5.waiting.${type}`)).toMatch(/scroll/);
      expect(fr(`units.e5.waiting.${type}`)).toMatch(/défilez/);
    }
  });
});

describe("E5-3: open and interactive marks", () => {
  const fakePerformance = () => {
    const entries: { name: string; startTime: number; detail?: unknown }[] = [];
    let now = 0;
    const perf: MarkPerformance & { at(ms: number): void } = {
      at: (ms) => {
        now = ms;
      },
      mark: (name, options) => entries.push({ name, startTime: now, detail: options?.detail }),
      getEntriesByName: (name) => entries.filter((entry) => entry.name === name),
    };
    return perf;
  };

  it("reads the open and interactive times separately", () => {
    const perf = fakePerformance();
    perf.at(812.4);
    markEditor(perf, EDITOR_MARKS.open, { objectPath: "/pages/a", blocks: 100 });
    expect(readEditorTimings(perf)).toEqual({ objectPath: "/pages/a", blocks: 100, openMs: 812, interactiveMs: null });
    perf.at(901.6);
    markEditor(perf, EDITOR_MARKS.interactive, { objectPath: "/pages/a", blocks: 100 });
    expect(readEditorTimings(perf)).toEqual({ objectPath: "/pages/a", blocks: 100, openMs: 812, interactiveMs: 902 });
  });

  it("keeps each editor's marks apart", () => {
    const perf = fakePerformance();
    perf.at(100);
    markEditor(perf, EDITOR_MARKS.open, { objectPath: "/pages/a", blocks: 3 });
    perf.at(200);
    markEditor(perf, EDITOR_MARKS.open, { objectPath: "", blocks: 1 });
    perf.at(300);
    markEditor(perf, EDITOR_MARKS.interactive, { objectPath: "/pages/a", blocks: 3 });
    expect(readEditorTimings(perf, "/pages/a")).toEqual({ objectPath: "/pages/a", blocks: 3, openMs: 100, interactiveMs: 300 });
    expect(readEditorTimings(perf, "")).toEqual({ objectPath: "", blocks: 1, openMs: 200, interactiveMs: null });
    expect(readEditorTimings(perf, "/pages/none")).toBeNull();
    // Without a path: the latest editor.
    expect(readEditorTimings(perf)?.openMs).toBe(200);
  });

  it("ignores an interactive mark from before the latest open, and marks without detail", () => {
    const perf = fakePerformance();
    perf.at(50);
    markEditor(perf, EDITOR_MARKS.interactive, { objectPath: "/pages/a", blocks: 1 });
    perf.at(60);
    perf.mark(EDITOR_MARKS.open, { detail: "not ours" });
    expect(readEditorTimings(perf)).toBeNull();
    perf.at(100);
    markEditor(perf, EDITOR_MARKS.open, { objectPath: "/pages/a", blocks: 1 });
    expect(readEditorTimings(perf)?.interactiveMs).toBeNull();
  });

  it("never breaks the editor when marks are refused or missing", () => {
    const refusing: MarkPerformance = {
      mark: () => {
        throw new TypeError("no detail support");
      },
      getEntriesByName: () => [],
    };
    expect(markEditor(refusing, EDITOR_MARKS.open, { objectPath: "", blocks: 1 })).toBe(false);
    expect(markEditor(undefined, EDITOR_MARKS.open, { objectPath: "", blocks: 1 })).toBe(false);
    expect(readEditorTimings(refusing)).toBeNull();
  });

  it("uses distinct, stable mark names", () => {
    expect(EDITOR_MARKS).toEqual({ open: "qbbe-editor:open", interactive: "qbbe-editor:interactive" });
  });
});

describe("E5-1: space kept while the editor loads", () => {
  it("is a low estimate per block, capped at the screen", () => {
    expect(editorReserve(0)).toBeUndefined();
    expect(editorReserve(Number.NaN)).toBeUndefined();
    expect(editorReserve(3)).toBe(`min(${3 * RESERVED_PX_PER_BLOCK}px, 100vh)`);
    expect(editorReserve(500)).toBe(`min(${500 * RESERVED_PX_PER_BLOCK}px, 100vh)`);
    expect(editorReserve(2.7)).toBe(`min(${2 * RESERVED_PX_PER_BLOCK}px, 100vh)`);
  });
});
