import { describe, expect, it } from "vitest";
import type { EditorBlock } from "@/features/editor/adapter/content";
import {
  cloneBlock,
  deleteSelection,
  duplicateSelection,
  movePlacement,
  moveSelection,
  selectRange,
  selectedSiblings,
} from "@/features/editor/adapter/selection";

const p = (id: string, text = id, children: EditorBlock[] = []): EditorBlock => ({
  id,
  type: "paragraph",
  props: { textColor: "default" },
  content: [{ type: "text", text }],
  children,
});

const ids = (blocks: EditorBlock[]): string[] => blocks.map((block) => block.id ?? "?");
const outline = (blocks: EditorBlock[]): string =>
  blocks.map((block) => (block.children?.length ? `${block.id}(${outline(block.children)})` : block.id)).join(" ");

const doc = () => [p("a"), p("b", "b", [p("b1"), p("b2")]), p("c"), p("d")];

describe("selectRange", () => {
  it("covers the blocks between the anchor and the focus, either way round", () => {
    expect(selectRange(doc(), "a", "c")).toEqual(["a", "b", "c"]);
    expect(selectRange(doc(), "c", "a")).toEqual(["a", "b", "c"]);
    expect(selectRange(doc(), "b", "b")).toEqual(["b"]);
  });

  it("works inside a nested list and treats a nested focus as its parent", () => {
    expect(selectRange(doc(), "b1", "b2")).toEqual(["b1", "b2"]);
    expect(selectRange(doc(), "a", "b2")).toEqual(["a", "b"]);
    expect(selectRange(doc(), "b1", "d")).toEqual(["b", "c", "d"]);
  });

  it("selects nothing for an unknown id", () => {
    expect(selectRange(doc(), "a", "nope")).toEqual([]);
    expect(selectRange([], "a", "b")).toEqual([]);
  });
});

describe("selectedSiblings", () => {
  it("keeps document order and drops ids outside the first block's level", () => {
    const { chosen, parentId } = selectedSiblings(doc(), ["c", "a", "b2"]);
    expect(ids(chosen)).toEqual(["a", "c"]);
    expect(parentId).toBeNull();
    expect(selectedSiblings(doc(), ["b2", "b1"]).parentId).toBe("b");
  });
});

describe("movePlacement", () => {
  it("steps past the neighbour, into its children when it has any", () => {
    expect(movePlacement(doc(), ["c"], "up")).toEqual({ referenceId: "b2", placement: "after" });
    expect(movePlacement(doc(), ["a"], "down")).toEqual({ referenceId: "b1", placement: "before" });
    expect(movePlacement(doc(), ["c"], "down")).toEqual({ referenceId: "d", placement: "after" });
    expect(movePlacement(doc(), ["b", "c"], "up")).toEqual({ referenceId: "a", placement: "before" });
  });

  it("leaves a nested list through its parent", () => {
    expect(movePlacement(doc(), ["b1"], "up")).toEqual({ referenceId: "b", placement: "before" });
    expect(movePlacement(doc(), ["b2"], "down")).toEqual({ referenceId: "b", placement: "after" });
  });

  it("has nowhere to go at either end of the document", () => {
    expect(movePlacement(doc(), ["a"], "up")).toBeNull();
    expect(movePlacement(doc(), ["d"], "down")).toBeNull();
    expect(movePlacement(doc(), ["c", "d"], "down")).toBeNull();
    expect(movePlacement(doc(), [], "down")).toBeNull();
  });
});

describe("moveSelection", () => {
  it("moves a run of siblings as one group", () => {
    expect(outline(moveSelection(doc(), ["c", "d"], "up"))).toBe("a b(b1 b2 c d)");
    expect(outline(moveSelection([p("a"), p("b"), p("c"), p("d")], ["b", "c"], "down"))).toBe("a d b c");
    expect(outline(moveSelection([p("a"), p("b"), p("c"), p("d")], ["b", "d"], "up"))).toBe("b d a c");
  });

  it("moves a nested block out past its parent and returns the same tree at an end", () => {
    expect(outline(moveSelection(doc(), ["b1"], "up"))).toBe("a b1 b(b2) c d");
    const start = doc();
    expect(moveSelection(start, ["a"], "up")).toBe(start);
  });

  it("does not change the input", () => {
    const start = doc();
    const snapshot = JSON.stringify(start);
    moveSelection(start, ["c"], "up");
    duplicateSelection(start, ["c"]);
    deleteSelection(start, ["c"]);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe("duplicateSelection", () => {
  it("places copies without ids right after the selection", () => {
    const next = duplicateSelection(doc(), ["a", "b"]);
    expect(next.map((block) => block.id)).toEqual(["a", "b", undefined, undefined, "c", "d"]);
    expect(next[3].children?.map((child) => child.id)).toEqual([undefined, undefined]);
    expect(next[3].content).toEqual([{ type: "text", text: "b" }]);
  });

  it("copies nothing for an empty or unknown selection", () => {
    const start = doc();
    expect(duplicateSelection(start, [])).toBe(start);
    expect(duplicateSelection(start, ["zz"])).toBe(start);
  });

  it("cloneBlock keeps props and content but never the id", () => {
    const copy = cloneBlock(p("x", "hello", [p("y")]));
    expect(copy.id).toBeUndefined();
    expect(copy.props).toEqual({ textColor: "default" });
    expect(copy.children?.[0].id).toBeUndefined();
  });
});

describe("deleteSelection", () => {
  it("removes blocks at any depth, with their children", () => {
    expect(outline(deleteSelection(doc(), ["b", "d"]))).toBe("a c");
    expect(outline(deleteSelection(doc(), ["b1"]))).toBe("a b(b2) c d");
  });
});
