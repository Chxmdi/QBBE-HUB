import { describe, expect, it } from "vitest";
import type { EditorContent } from "@/features/editor/adapter/content";
import { editorContentToSnapshot, snapshotToEditorContent } from "../adapters/editor-document-adapter";
import { isContentSnapshot } from "../content";
import { diffSnapshots, restoreBlockInto } from "../diff";

const document: EditorContent = {
  version: 1,
  blocks: [
    { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Agenda" }] },
    {
      id: "list",
      type: "bulletListItem",
      props: {},
      content: [{ type: "text", text: "Budget", styles: { bold: true } }],
      children: [{ id: "sub", type: "bulletListItem", props: {}, content: [{ type: "text", text: "Q3 figures" }] }],
    },
    { id: "img", type: "image", props: { url: "https://example.org/a.png" } },
    { id: "empty", type: "paragraph", props: {}, content: [] },
  ],
};

describe("editor documents as snapshots", () => {
  it("makes one block per editor block, in document order, with its own text", () => {
    const snapshot = editorContentToSnapshot(document, "AAAA");
    expect(isContentSnapshot(snapshot)).toBe(true);
    expect(snapshot.yjsState).toBe("AAAA");
    expect(snapshot.blocks.map((block) => [block.id, block.type, block.text])).toEqual([
      ["h", "heading", "Agenda"],
      ["list", "bulletListItem", "Budget"],
      ["sub", "bulletListItem", "Q3 figures"],
      ["img", "image", "https://example.org/a.png"],
      ["empty", "paragraph", ""],
    ]);
    expect(snapshot.blocks[2].props).toMatchObject({ parent: "list" });
    expect(snapshot.blocks[0].props).toMatchObject({ props: { level: 2 } });
    expect(editorContentToSnapshot(document).yjsState).toBeUndefined();
  });

  it("gives a block without an id a stable one", () => {
    const snapshot = editorContentToSnapshot({ version: 1, blocks: [{ type: "paragraph", content: [] }] });
    expect(snapshot.blocks[0].id).toBe("root-1");
  });

  it("rebuilds the document exactly, nesting and styles included", () => {
    const withChildren = (blocks: EditorContent["blocks"]): EditorContent["blocks"] =>
      blocks.map((block) => ({ ...block, children: withChildren(block.children ?? []) }));
    expect(snapshotToEditorContent(editorContentToSnapshot(document))).toEqual({
      version: 1,
      blocks: withChildren(document.blocks),
    });
  });

  it("rebuilds a block from its text when the text no longer matches the stored content", () => {
    const snapshot = editorContentToSnapshot(document);
    const edited = {
      ...snapshot,
      blocks: snapshot.blocks.map((block) => (block.id === "h" ? { ...block, text: "Order of business" } : block)),
    };
    const rebuilt = snapshotToEditorContent(edited);
    expect(rebuilt.blocks[0]).toEqual({
      id: "h",
      type: "heading",
      props: { level: 2 },
      content: [{ type: "text", text: "Order of business" }],
      children: [],
    });
    // A block whose text is derived from its props (an image) is left alone.
    expect(rebuilt.blocks[2]).toEqual({ id: "img", type: "image", props: { url: "https://example.org/a.png" }, children: [] });
  });

  it("accepts a hand-written snapshot with text only", () => {
    const rebuilt = snapshotToEditorContent({
      version: 1,
      blocks: [
        { id: "a", type: "paragraph", text: "First" },
        { id: "b", type: "paragraph", text: "" },
      ],
    });
    expect(rebuilt.blocks).toEqual([
      { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "First" }], children: [] },
      // An empty block carries no inline content; the editor gives it the default.
      { id: "b", type: "paragraph", props: {}, children: [] },
    ]);
  });

  it("compares and restores one block of a page like any other object", () => {
    const before = editorContentToSnapshot(document);
    const after = editorContentToSnapshot({
      ...document,
      blocks: document.blocks.map((block) =>
        block.id === "h" ? { ...block, content: [{ type: "text", text: "Agenda for October" }] } : block,
      ),
    });
    const diff = diffSnapshots({ content: before, properties: {} }, { content: after, properties: {} });
    expect(diff.blocks.find((block) => block.id === "h")?.kind).toBe("changed");
    const restored = snapshotToEditorContent(restoreBlockInto(after, before, "h"));
    expect(restored.blocks[0].content).toEqual([{ type: "text", text: "Agenda" }]);
    expect(restored.blocks[1].children?.[0].id).toBe("sub");
  });
});
