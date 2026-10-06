import { describe, expect, it } from "vitest";
import { headingAnchor, tocFromBlocks } from "@/features/editor/adapter/toc";
import type { EditorBlock } from "@/features/editor/adapter/content";

const heading = (id: string, level: number, text: string, children: EditorBlock[] = []): EditorBlock => ({
  id,
  type: "heading",
  props: { level },
  content: [{ type: "text", text }],
  children,
});

describe("tocFromBlocks", () => {
  it("nests headings by level", () => {
    const toc = tocFromBlocks([
      heading("a", 1, "Overview"),
      { id: "p", type: "paragraph", content: [{ type: "text", text: "Intro" }] },
      heading("b", 2, "Goals"),
      heading("c", 3, "This year"),
      heading("d", 3, "Next year"),
      heading("e", 2, "Budget"),
      heading("f", 1, "Appendix"),
    ]);
    expect(toc).toEqual([
      {
        id: "a",
        level: 1,
        text: "Overview",
        children: [
          {
            id: "b",
            level: 2,
            text: "Goals",
            children: [
              { id: "c", level: 3, text: "This year", children: [] },
              { id: "d", level: 3, text: "Next year", children: [] },
            ],
          },
          { id: "e", level: 2, text: "Budget", children: [] },
        ],
      },
      { id: "f", level: 1, text: "Appendix", children: [] },
    ]);
  });

  it("starts at any level and steps back up without a parent", () => {
    const toc = tocFromBlocks([heading("a", 3, "Deep"), heading("b", 2, "Mid"), heading("c", 3, "Deep again")]);
    expect(toc.map((e) => [e.id, e.children.map((c) => c.id)])).toEqual([
      ["a", []],
      ["b", ["c"]],
    ]);
  });

  it("includes headings inside columns and toggles, in document order", () => {
    const toc = tocFromBlocks([
      {
        id: "cols",
        type: "columnList",
        children: [
          { id: "c1", type: "column", props: { width: 1 }, children: [heading("left", 2, "Left")] },
          { id: "c2", type: "column", props: { width: 1 }, children: [heading("right", 2, "Right")] },
        ],
      },
      heading("toggle", 2, "Toggle", [{ id: "inside", type: "heading", props: { level: 3 }, content: [{ type: "text", text: "Inside" }] }]),
    ]);
    expect(toc.map((e) => e.id)).toEqual(["left", "right", "toggle"]);
    expect(toc[2].children.map((e) => e.id)).toEqual(["inside"]);
  });

  it("leaves out levels above 3, headings with no text, no id, and other blocks", () => {
    const toc = tocFromBlocks([
      heading("h4", 4, "Too deep"),
      heading("blank", 2, "   "),
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "No id" }] },
      { id: "q", type: "quote", content: [{ type: "text", text: "Not a heading" }] },
      heading("ok", 2, "Kept"),
    ]);
    expect(toc.map((e) => e.id)).toEqual(["ok"]);
  });

  it("reads a level stored as a string and joins styled runs and links", () => {
    const toc = tocFromBlocks([
      {
        id: "s",
        type: "heading",
        props: { level: "2" },
        content: [
          { type: "text", text: "See ", styles: { bold: true } },
          { type: "link", href: "https://x.org", content: [{ type: "text", text: "the plan" }] },
        ],
      },
    ]);
    expect(toc).toEqual([{ id: "s", level: 2, text: "See the plan", children: [] }]);
  });

  it("names the anchor a heading carries", () => {
    expect(headingAnchor("abc-123")).toBe("block-abc-123");
  });
});
