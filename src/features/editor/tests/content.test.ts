import { describe, expect, it } from "vitest";
import {
  blockText,
  contentToPlainText,
  emptyContent,
  normalizeContent,
  plainTextToContent,
  walkBlocks,
} from "@/features/editor/adapter/content";

describe("plain text and editor content", () => {
  it("turns each line into a paragraph and keeps blank lines", () => {
    const content = plainTextToContent("First line\r\n\r\nThird line\n");
    expect(content.blocks.map((b) => b.content)).toEqual([
      [{ type: "text", text: "First line" }],
      [],
      [{ type: "text", text: "Third line" }],
    ]);
  });

  it("gives empty content for empty or missing text", () => {
    expect(plainTextToContent("")).toEqual(emptyContent());
    expect(plainTextToContent("   \n ")).toEqual(emptyContent());
    expect(plainTextToContent(null)).toEqual(emptyContent());
  });

  it("round-trips plain text", () => {
    const text = "Réviser le budget\n\n« Ça va? » — œuvre";
    expect(contentToPlainText(plainTextToContent(text))).toBe(text);
  });

  it("reads text from links, nested blocks, tables and URL blocks", () => {
    const content = normalizeContent({
      blocks: [
        {
          type: "bulletListItem",
          content: [
            { type: "text", text: "See " },
            { type: "link", href: "https://x.org", content: [{ type: "text", text: "the plan" }] },
          ],
          children: [{ type: "paragraph", content: [{ type: "text", text: "child" }] }],
        },
        {
          type: "table",
          content: {
            type: "tableContent",
            rows: [{ cells: [[{ type: "text", text: "a" }], { type: "tableCell", content: [{ type: "text", text: "b" }] }] }],
          },
        },
        { type: "bookmark", props: { url: "https://example.org" } },
      ],
    });
    expect(contentToPlainText(content)).toBe("See the plan\nchild\na\tb\nhttps://example.org");
    expect(walkBlocks(content.blocks).map((w) => w.depth)).toEqual([0, 1, 0, 0]);
    expect(blockText(content.blocks[0])).toBe("See the plan\nchild");
  });

  it("refuses malformed stored content rather than crashing", () => {
    expect(normalizeContent("nope")).toEqual(emptyContent());
    expect(normalizeContent({ blocks: "x" })).toEqual(emptyContent());
    expect(normalizeContent({ blocks: [null, 3, { type: "paragraph" }] }).blocks).toEqual([{ type: "paragraph" }]);
  });
});

describe("slash menu ranking", async () => {
  const { rankByTitle } = await import("@/features/editor/adapter/slash");
  it("puts titles that start with the query first, keeping order otherwise", () => {
    const items = [{ title: "Image" }, { title: "Video" }, { title: "File" }, { title: "Embed" }];
    expect(rankByTitle(items, "embed").map((i) => i.title)).toEqual(["Embed", "Image", "Video", "File"]);
    expect(rankByTitle(items, "").map((i) => i.title)).toEqual(["Image", "Video", "File", "Embed"]);
  });
});
